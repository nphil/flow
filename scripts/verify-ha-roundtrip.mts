#!/usr/bin/env tsx
/**
 * Acceptance gate: every automation that works in Home Assistant must open in
 * Flow AND survive a round-trip without semantic change.
 *
 * Why this exists rather than a simple "does it re-parse" check: regenerated
 * YAML that re-parses can still be WRONG. A real defect shipped in this repo
 * moved an if-guard's conditions into a `repeat.until` list, turning a guarded
 * lock into an unconditional one. That output parsed perfectly. Only comparing
 * the regenerated automation against the original catches that class.
 *
 * The comparison is semantic, not textual. Representations that Home Assistant
 * treats as identical are canonicalized on BOTH sides before diffing:
 *   - singular/plural keys (trigger/triggers, condition/conditions, action/actions)
 *   - `service:` and `action:` (renamed upstream, both accepted)
 *   - `choose` + `default` and nested `if/then/else` chains, which are the same
 *     decision ladder written two ways (Flow canonically emits if/else)
 *   - empty `else: []` / `default: []`, `enabled: true` (the default)
 *   - mapping key order (unordered in YAML) while sequence order is preserved,
 *     because step order IS behavior
 *   - equivalent delay spellings ("00:00:30" vs {seconds: 30})
 *   - Flow's own `_cafe_metadata` canvas positions
 *
 * Everything else counts. Loop condition lists are compared structurally and
 * are deliberately NOT normalized against surrounding guards: `until: [a, b]`
 * followed by `if c` behaves differently from `until: [a, b, c]` (the first
 * stops waiting, the second spins), so that difference must surface.
 *
 * Comment fidelity (alias / note / description) is reported separately: losing
 * an alias is a real regression but not a behavioral one.
 *
 * Usage:
 *   HA_URL=http://192.168.1.146 HA_TOKEN=... yarn tsx scripts/verify-ha-roundtrip.mts
 *   (falls back to /data/home/tmp/ha-token when HA_TOKEN is unset)
 *
 * Exits non-zero when any automation fails to open or differs semantically.
 */
import { readFile } from 'node:fs/promises';
import { load as yamlLoad } from 'js-yaml';
import { FlowTranspiler } from '../packages/transpiler/src/index.js';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const HA_URL = process.env.HA_URL ?? 'http://192.168.1.146';
const TOKEN_FILE = process.env.HA_TOKEN_FILE ?? '/data/home/tmp/ha-token';

/** Keys that carry human prose, not behavior. Tracked, not diffed. */
const PROSE_KEYS = new Set(['alias', 'note', 'description']);

function isObj(v: Json): v is { [k: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** "00:05:00" | {minutes: 5} | 30 -> seconds, or null when not a fixed duration. */
function durationSeconds(v: Json): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return null; // templated or unparseable: compare verbatim
  }
  if (isObj(v)) {
    const parts = ['hours', 'minutes', 'seconds', 'milliseconds'] as const;
    const mult: Record<string, number> = {
      hours: 3600,
      minutes: 60,
      seconds: 1,
      milliseconds: 0.001,
    };
    let total = 0;
    for (const k of Object.keys(v)) {
      if (!parts.includes(k as (typeof parts)[number])) return null;
      const n = v[k];
      if (typeof n !== 'number') return null;
      total += n * mult[k];
    }
    return total;
  }
  return null;
}

function firstArray(o: { [k: string]: Json }, ...keys: string[]): Json[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
    if (v !== undefined && v !== null) return [v];
  }
  return [];
}

type Prose = { aliases: string[]; notes: string[] };

/** Collect prose fields from any node so both spellings account identically. */
function harvestProse(obj: { [k: string]: Json }, prose: Prose): void {
  for (const k of PROSE_KEYS) {
    const v = obj[k];
    if (typeof v !== 'string' || v.length === 0) continue;
    if (k === 'alias') prose.aliases.push(v);
    if (k === 'note') prose.notes.push(v);
  }
}

/**
 * Canonicalize one action step. Returns null for steps that carry no behavior
 * once normalized (e.g. an empty branch container).
 */
function canonStep(step: Json, prose: Prose): Json {
  if (!isObj(step)) return step;

  harvestProse(step, prose);

  // ---- decision ladder: `if/then/else` and `choose/default` unify here ----
  if ('if' in step || 'choose' in step) {
    const branches: Json[] = [];
    let otherwise: Json[] = [];

    if ('choose' in step) {
      const choices = Array.isArray(step.choose) ? step.choose : [];
      for (const c of choices) {
        if (!isObj(c)) continue;
        // A choose branch carries its own alias; the equivalent if/then/else
        // spelling carries it on the step. Harvest both or the conversion
        // looks like prose loss when nothing was lost.
        harvestProse(c, prose);
        branches.push({
          when: canonConditions(firstArray(c, 'conditions', 'condition'), prose),
          do: canonSequence(firstArray(c, 'sequence'), prose),
        });
      }
      otherwise = canonSequence(firstArray(step, 'default'), prose);
    } else {
      branches.push({
        when: canonConditions(firstArray(step, 'if'), prose),
        do: canonSequence(firstArray(step, 'then'), prose),
      });
      otherwise = canonSequence(firstArray(step, 'else'), prose);
    }

    // Flatten `else: [ <decision> ]` into sibling branches. `if A then X else
    // (if B then Y)` is exactly the ladder `choose [A->X, B->Y]`, so the two
    // spellings must compare equal.
    while (otherwise.length === 1 && isObj(otherwise[0]) && '__decision' in otherwise[0]) {
      const inner = otherwise[0];
      const innerBranches = inner.__decision;
      if (!Array.isArray(innerBranches)) break;
      branches.push(...innerBranches);
      const innerElse = inner.__otherwise;
      otherwise = Array.isArray(innerElse) ? innerElse : [];
    }

    const out: { [k: string]: Json } = { __decision: branches };
    if (otherwise.length > 0) out.__otherwise = otherwise;
    if (step.enabled === false) out.enabled = false;
    return out;
  }

  // ---- loops: condition lists stay structural on purpose ----
  if ('repeat' in step && isObj(step.repeat)) {
    const r = step.repeat;
    const out: { [k: string]: Json } = {};
    if (r.until !== undefined) out.until = canonConditions(firstArray(r, 'until'), prose);
    if (r.while !== undefined) out.while = canonConditions(firstArray(r, 'while'), prose);
    if (r.count !== undefined) out.count = r.count;
    if (r.for_each !== undefined) out.for_each = canonValue(r.for_each);
    out.sequence = canonSequence(firstArray(r, 'sequence'), prose);
    const wrapped: { [k: string]: Json } = { __repeat: out };
    if (step.enabled === false) wrapped.enabled = false;
    return wrapped;
  }

  // ---- bare condition step (gates everything after it in its sequence) ----
  if ('condition' in step && !('action' in step) && !('service' in step)) {
    return { __condition: canonCondition(step, prose) };
  }

  // ---- plain action ----
  const out: { [k: string]: Json } = {};
  for (const k of Object.keys(step)) {
    if (PROSE_KEYS.has(k)) continue;
    if (k === 'enabled' && step[k] === true) continue;
    // upstream renamed `service` to `action`; both are accepted
    const key = k === 'service' ? 'action' : k;
    if (k === 'delay') {
      const secs = durationSeconds(step[k]);
      out.delay = secs === null ? canonValue(step[k]) : secs;
      continue;
    }
    if (k === 'sequence' || k === 'parallel') {
      out[key] = canonSequence(firstArray(step, k), prose);
      continue;
    }
    out[key] = canonValue(step[k]);
  }
  return out;
}

function canonSequence(seq: Json[], prose: Prose): Json[] {
  return seq.map((s) => canonStep(s, prose)).filter((s) => {
    if (isObj(s) && Object.keys(s).length === 0) return false;
    return s !== null && s !== undefined;
  });
}

function canonCondition(cond: Json, prose: Prose): Json {
  if (!isObj(cond)) return cond;
  harvestProse(cond, prose);
  const out: { [k: string]: Json } = {};
  for (const k of Object.keys(cond)) {
    if (PROSE_KEYS.has(k)) continue;
    if (k === 'enabled' && cond[k] === true) continue;
    if (k === 'for') {
      const secs = durationSeconds(cond[k]);
      out.for = secs === null ? canonValue(cond[k]) : secs;
      continue;
    }
    if (k === 'conditions') {
      out.conditions = canonConditions(firstArray(cond, 'conditions'), prose);
      continue;
    }
    out[k] = canonValue(cond[k]);
  }
  return out;
}

function canonConditions(conds: Json[], prose: Prose): Json[] {
  return conds.map((c) => canonCondition(c, prose));
}

/** Sort mapping keys (unordered in YAML); preserve sequence order (behavior). */
function canonValue(v: Json): Json {
  if (Array.isArray(v)) return v.map(canonValue);
  if (isObj(v)) {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) out[k] = canonValue(v[k]);
    return out;
  }
  return v;
}

function canonAutomation(raw: Json): { canon: Json; prose: Prose } {
  const prose: Prose = { aliases: [], notes: [] };
  if (!isObj(raw)) return { canon: raw, prose };

  const triggers = firstArray(raw, 'triggers', 'trigger').map((t) => {
    if (!isObj(t)) return t;
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(t)) {
      if (PROSE_KEYS.has(k)) {
        const v = t[k];
        if (k === 'alias' && typeof v === 'string') prose.aliases.push(v);
        if (k === 'note' && typeof v === 'string') prose.notes.push(v);
        continue;
      }
      // `platform` was renamed to `trigger`
      out[k === 'platform' ? 'trigger' : k] = canonValue(t[k]);
    }
    return canonValue(out);
  });

  const conditions = canonConditions(firstArray(raw, 'conditions', 'condition'), prose);
  const actions = canonSequence(firstArray(raw, 'actions', 'action'), prose);

  // Flow's canvas positions live in variables._cafe_metadata
  let variables: Json = raw.variables ?? null;
  if (isObj(variables)) {
    const copy: { [k: string]: Json } = {};
    for (const k of Object.keys(variables)) {
      if (k === '_cafe_metadata') continue;
      copy[k] = canonValue(variables[k]);
    }
    variables = Object.keys(copy).length > 0 ? canonValue(copy) : null;
  }

  if (typeof raw.description === 'string' && raw.description.length > 0) {
    prose.notes.push(raw.description);
  }

  const canon: { [k: string]: Json } = {
    triggers,
    actions,
    mode: raw.mode ?? 'single',
  };
  if (conditions.length > 0) canon.conditions = conditions;
  if (variables !== null) canon.variables = variables;
  if (raw.max !== undefined) canon.max = raw.max;
  if (raw.max_exceeded !== undefined) canon.max_exceeded = raw.max_exceeded;
  if (raw.trigger_variables !== undefined) {
    canon.trigger_variables = canonValue(raw.trigger_variables);
  }
  return { canon, prose };
}

/** Structural diff; returns human-readable paths that differ. */
function diff(a: Json, b: Json, path = '', out: string[] = []): string[] {
  if (out.length >= 25) return out;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) {
    out.push(`${path || '(root)'}: type ${ta} -> ${tb}`);
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${path}: length ${a.length} -> ${b.length}`);
    }
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff(a[i] ?? null, b[i] ?? null, `${path}[${i}]`, out);
    }
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) {
        out.push(`${path}.${k}: added (${JSON.stringify(b[k]).slice(0, 90)})`);
        continue;
      }
      if (!(k in b)) {
        out.push(`${path}.${k}: REMOVED (${JSON.stringify(a[k]).slice(0, 90)})`);
        continue;
      }
      diff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  if (a !== b) {
    out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  return out;
}

async function main(): Promise<void> {
  const token = (process.env.HA_TOKEN ?? (await readFile(TOKEN_FILE, 'utf8'))).trim();
  const headers = { Authorization: `Bearer ${token}` };

  const statesRes = await fetch(`${HA_URL}/api/states`, { headers });
  if (!statesRes.ok) throw new Error(`GET /api/states -> HTTP ${statesRes.status}`);
  const states = (await statesRes.json()) as Array<{
    entity_id: string;
    attributes: { id?: string; friendly_name?: string };
  }>;
  const automations = states.filter((s) => s.entity_id.startsWith('automation.'));

  const transpiler = new FlowTranspiler();
  let openFailures = 0;
  let semanticFailures = 0;
  let proseLosses = 0;

  console.log(`Round-tripping ${automations.length} automations from ${HA_URL}\n`);

  for (const auto of automations) {
    const name = auto.attributes.friendly_name ?? auto.entity_id;
    const id = auto.attributes.id;
    if (!id) {
      console.log(`SKIP      ${name} (no config id: YAML-defined, not editable via API)`);
      continue;
    }

    const cfgRes = await fetch(`${HA_URL}/api/config/automation/config/${id}`, { headers });
    if (!cfgRes.ok) {
      console.log(`FETCH-FAIL ${name}: HTTP ${cfgRes.status}`);
      openFailures++;
      continue;
    }
    const original = (await cfgRes.json()) as Json;

    const parsed = await transpiler.fromYaml(JSON.stringify(original));
    if (!parsed.success || !parsed.graph) {
      console.log(`OPEN-FAIL ${name}`);
      for (const e of parsed.errors ?? []) console.log(`            ${e}`);
      openFailures++;
      continue;
    }

    let regenerated: Json;
    try {
      regenerated = yamlLoad(transpiler.toYaml(parsed.graph)) as Json;
    } catch (e) {
      console.log(`EMIT-FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`);
      semanticFailures++;
      continue;
    }

    const before = canonAutomation(original);
    const after = canonAutomation(regenerated);
    const diffs = diff(before.canon, after.canon);

    const lostAliases = before.prose.aliases.filter((a) => !after.prose.aliases.includes(a));
    const lostNotes = before.prose.notes.filter((n) => !after.prose.notes.includes(n));

    if (diffs.length === 0) {
      const proseNote =
        lostAliases.length + lostNotes.length > 0
          ? `  [prose lost: ${lostAliases.length} alias, ${lostNotes.length} note]`
          : '';
      if (proseNote) proseLosses++;
      console.log(`SEMANTIC-OK ${name}${proseNote}`);
    } else {
      semanticFailures++;
      console.log(`SEMANTIC-DIFF ${name}  (${diffs.length} difference(s))`);
      for (const d of diffs) console.log(`            ${d}`);
    }

    for (const w of parsed.warnings ?? []) console.log(`            warn: ${w}`);
  }

  console.log(
    `\nopen failures: ${openFailures}  semantic diffs: ${semanticFailures}  prose losses: ${proseLosses}`
  );
  if (openFailures > 0 || semanticFailures > 0) process.exit(1);
  console.log('GATE PASS: every automation opens and round-trips without semantic change.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
