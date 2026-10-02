#!/usr/bin/env tsx
/**
 * Acceptance gate: every automation (and script) that works in Home Assistant
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
 * Comment fidelity (alias / note / description) is reported separately: losing
 * an alias is a real regression but not a behavioral one.
 *
 * Usage:
 *   HA_URL=http://homeassistant.local:8123 HA_TOKEN=... yarn verify:ha
 *   (HA_TOKEN_FILE can point at a file holding the token instead;
 *    GATE_KINDS=automation,script picks what is checked, default: automation)
 *
 * Exits non-zero when anything fails to open or differs semantically.
 */
import { readFile } from 'node:fs/promises';
import { FlowTranspiler, isJson, type Json, roundTripConfig } from '../packages/transpiler/src/index.js';

const HA_URL = process.env.HA_URL ?? 'http://192.168.1.146';
const TOKEN_FILE = process.env.HA_TOKEN_FILE ?? '/data/home/tmp/ha-token';
const KINDS = (process.env.GATE_KINDS ?? 'automation').split(',').map((k) => k.trim());

type Kind = 'automation' | 'script';

interface HaState {
  entity_id: string;
  attributes: { id?: string; friendly_name?: string };
}

interface Tally {
  openFailures: number;
  semanticFailures: number;
  proseLosses: number;
  checked: number;
}

/** Where Home Assistant exposes the stored config of one automation/script. */
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
  headers: { Authorization: string },
  tally: Tally
): Promise<void> {
  const name = state.attributes.friendly_name ?? state.entity_id;
  const path = configPath(kind, state);
  if (!path) {
    console.log(`SKIP      ${name} (no config id: YAML-defined, not editable via API)`);
    return;
  }

  const cfgRes = await fetch(`${HA_URL}${path}`, { headers });
  if (cfgRes.status === 404 && kind === 'script') {
    console.log(`SKIP      ${name} (script not stored in scripts.yaml, not editable via API)`);
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
  const result = await roundTripConfig(transpiler, original as Json);

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
    const lost = result.lostAliases.length + result.lostNotes.length;
    const proseNote = lost
      ? `  [prose lost: ${result.lostAliases.length} alias, ${result.lostNotes.length} note]`
      : '';
    if (lost) tally.proseLosses++;
    console.log(`SEMANTIC-OK ${label}${proseNote}`);
  }
  for (const w of result.warnings) console.log(`            warn: ${w}`);
}

async function main(): Promise<void> {
  const token = (process.env.HA_TOKEN ?? (await readFile(TOKEN_FILE, 'utf8'))).trim();
  const headers = { Authorization: `Bearer ${token}` };

  const statesRes = await fetch(`${HA_URL}/api/states`, { headers });
  if (!statesRes.ok) throw new Error(`GET /api/states -> HTTP ${statesRes.status}`);
  const states = (await statesRes.json()) as HaState[];

  const transpiler = new FlowTranspiler();
  const tally: Tally = { openFailures: 0, semanticFailures: 0, proseLosses: 0, checked: 0 };

  for (const kind of ['automation', 'script'] as const) {
    if (!KINDS.includes(kind)) continue;
    const items = states.filter((s) => s.entity_id.startsWith(`${kind}.`));
    console.log(`Round-tripping ${items.length} ${kind}s from ${HA_URL}\n`);
    for (const item of items) await checkOne(transpiler, kind, item, headers, tally);
    console.log('');
  }

  console.log(
    `checked: ${tally.checked}  open failures: ${tally.openFailures}  semantic diffs: ${tally.semanticFailures}  prose losses: ${tally.proseLosses}`
  );
  if (tally.openFailures > 0 || tally.semanticFailures > 0) process.exit(1);
  console.log('GATE PASS: everything opens and round-trips without semantic change.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
