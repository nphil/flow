#!/usr/bin/env tsx
/**
 * Acceptance gate: every automation and script that works in Home Assistant
 * must open in Flow AND survive a round-trip without semantic change.
 *
 * Why this exists rather than a simple "does it re-parse" check: regenerated
 * YAML that re-parses can still be WRONG. A real defect shipped in this repo
 * moved an if-guard's conditions into a `repeat.until` list, turning a
 * guarded lock into an unconditional one. That output parsed perfectly. Only
 * comparing the regenerated config against the original catches that class.
 *
 * The comparison itself lives in packages/transpiler/src/semantic (see
 * canonicalize.ts for exactly which spellings are treated as identical). The
 * same code backs the offline regression fixtures, so this live gate and the
 * CI fixtures can never disagree about what "unchanged" means.
 *
 * Two readings are reported for every config: what it DOES (semantic) and the
 * SHAPE the author wrote (`choose` stays `choose`, `service:` stays `service:`).
 * Both must be unchanged: Flow saves what it opened without rewriting it.
 * Comment fidelity (alias / note / description) is reported separately: losing
 * an alias is a real regression but not a behavioral one.
 *
 * Read-only: it only GETs configs, nothing is saved or run.
 *
 * Usage:
 *   HA_URL=http://homeassistant.local:8123 HA_TOKEN=... yarn verify:ha
 *   (HA_TOKEN_FILE can point at a file holding the token instead;
 *    GATE_KINDS=automation,script picks what is checked, default: both)
 *
 * Exits non-zero when anything fails to open or differs.
 */
import { readFile } from 'node:fs/promises';
import {
  FlowTranspiler,
  isJson,
  type Json,
  roundTripConfig,
} from '../packages/transpiler/src/index.js';

type Kind = 'automation' | 'script';

const ALL_KINDS: Kind[] = ['automation', 'script'];

interface HaState {
  entity_id: string;
  attributes: { id?: string; friendly_name?: string };
}

interface Tally {
  openFailures: number;
  semanticFailures: number;
  shapeChanges: number;
  proseLosses: number;
  checked: number;
}

interface Connection {
  url: string;
  headers: { Authorization: string };
}

function isKind(value: string): value is Kind {
  return ALL_KINDS.some((kind) => kind === value);
}

/** The kinds to check: GATE_KINDS (comma separated), both by default. */
function selectedKinds(): Kind[] {
  const requested = (process.env.GATE_KINDS ?? ALL_KINDS.join(','))
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean);
  const unknown = requested.filter((kind) => !isKind(kind));
  if (unknown.length > 0) throw new Error(`GATE_KINDS: unknown kind ${unknown.join(', ')}`);
  return ALL_KINDS.filter((kind) => requested.includes(kind));
}

async function connect(): Promise<Connection> {
  const url = process.env.HA_URL?.replace(/\/+$/, '');
  if (!url) throw new Error('Set HA_URL (for example http://homeassistant.local:8123)');
  const tokenFile = process.env.HA_TOKEN_FILE;
  const token = (process.env.HA_TOKEN ?? (tokenFile ? await readFile(tokenFile, 'utf8') : '')).trim();
  if (!token) throw new Error('Set HA_TOKEN, or HA_TOKEN_FILE pointing at a file that holds it');
  return { url, headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Where Home Assistant exposes the stored config of one automation/script. A script is stored under
 * its key, which is its entity id without `script.` unless the entity was renamed afterwards (such
 * a script is reported as not found rather than guessed at).
 */
function configPath(kind: Kind, state: HaState): string | null {
  if (kind === 'automation') {
    // YAML-defined automations have no config id and are not editable via the API
    return state.attributes.id ? `/api/config/automation/config/${state.attributes.id}` : null;
  }
  return `/api/config/script/config/${state.entity_id.slice('script.'.length)}`;
}

async function checkOne(
  transpiler: FlowTranspiler,
  kind: Kind,
  state: HaState,
  connection: Connection,
  tally: Tally
): Promise<void> {
  const name = state.attributes.friendly_name ?? state.entity_id;
  const path = configPath(kind, state);
  if (!path) {
    console.log(`SKIP      ${name} (no config id: YAML-defined, not editable via API)`);
    return;
  }

  const cfgRes = await fetch(`${connection.url}${path}`, { headers: connection.headers });
  if (cfgRes.status === 404 && kind === 'script') {
    console.log(`SKIP      ${name} (no script of that key in scripts.yaml: renamed entity or not editable via API)`);
    return;
  }
  if (!cfgRes.ok) {
    console.log(`FETCH-FAIL ${name}: HTTP ${cfgRes.status}`);
    tally.openFailures++;
    return;
  }
  const original: unknown = await cfgRes.json();
  if (!isJson(original)) {
    console.log(`FETCH-FAIL ${name}: response is not plain JSON`);
    tally.openFailures++;
    return;
  }

  tally.checked++;
  const label = kind === 'script' ? `[script] ${name}` : name;
  const result = await roundTripConfig(transpiler, original, { kind });

  if (result.status === 'open-fail') {
    console.log(`OPEN-FAIL ${label}`);
    for (const e of result.errors) console.log(`            ${e}`);
    tally.openFailures++;
  } else if (result.status === 'emit-fail') {
    console.log(`EMIT-FAIL ${label}: ${result.errors.join('; ')}`);
    tally.semanticFailures++;
  } else if (result.status === 'diff') {
    tally.semanticFailures++;
    console.log(`SEMANTIC-DIFF ${label}  (${result.diffs.length} difference(s))`);
    for (const d of result.diffs) console.log(`            ${d}`);
  } else {
    const strict = await roundTripConfig(transpiler, original, { kind, strict: true });
    const shape = strict.status === 'ok' ? 'exact shape' : `SHAPE CHANGED (${strict.diffs.length})`;
    const lost = result.lostAliases.length + result.lostNotes.length;
    const proseNote = lost
      ? `  [prose lost: ${result.lostAliases.length} alias, ${result.lostNotes.length} note]`
      : '';
    if (lost) tally.proseLosses++;
    if (strict.status !== 'ok') tally.shapeChanges++;
    console.log(`SEMANTIC-OK ${label}  [${shape}]${proseNote}`);
    for (const d of strict.status === 'ok' ? [] : strict.diffs) console.log(`            ${d}`);
  }
  for (const w of result.warnings) console.log(`            warn: ${w}`);
}

async function main(): Promise<void> {
  const connection = await connect();
  const kinds = selectedKinds();

  const statesRes = await fetch(`${connection.url}/api/states`, { headers: connection.headers });
  if (!statesRes.ok) throw new Error(`GET /api/states -> HTTP ${statesRes.status}`);
  const states = (await statesRes.json()) as HaState[];

  const transpiler = new FlowTranspiler();
  const tally: Tally = {
    openFailures: 0,
    semanticFailures: 0,
    shapeChanges: 0,
    proseLosses: 0,
    checked: 0,
  };

  for (const kind of kinds) {
    const items = states.filter((s) => s.entity_id.startsWith(`${kind}.`));
    console.log(`Round-tripping ${items.length} ${kind}s from ${connection.url}\n`);
    for (const item of items) {
      await checkOne(transpiler, kind, item, connection, tally);
    }
    console.log('');
  }

  console.log(
    `checked: ${tally.checked}  open failures: ${tally.openFailures}  semantic diffs: ${tally.semanticFailures}  shape changes: ${tally.shapeChanges}  prose losses: ${tally.proseLosses}`
  );
  if (tally.openFailures > 0 || tally.semanticFailures > 0 || tally.shapeChanges > 0) {
    process.exit(1);
  }
  console.log('GATE PASS: everything opens and round-trips with the same meaning and shape.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
