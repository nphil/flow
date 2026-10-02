import { isJsonObject, type Json, type JsonObject } from './json';

/**
 * Semantic canonicalization of Home Assistant automation and script configs.
 *
 * Two configs are "semantically identical" when their canonical forms are
 * deeply equal. Representations that Home Assistant treats as the same thing
 * are normalized on BOTH sides before comparing:
 *   - singular/plural keys (trigger/triggers, condition/conditions, action/actions)
 *   - `platform:` and `trigger:` on triggers, `service:` and `action:` on steps
 *   - `choose` + `default` and nested `if/then/else` chains, which are the same
 *     decision ladder written two ways
 *   - empty `else: []` / `default: []`, `enabled: true` (the default)
 *   - shorthand conditions (a bare template string, `and:`/`or:`/`not:` keys)
 *   - mapping key order (unordered in YAML) while sequence order is preserved,
 *     because step order IS behavior
 *   - equivalent duration spellings ("00:00:30" vs {seconds: 30}) for delay,
 *     timeout and `for`
 *   - a `parallel` branch written as `{sequence: [...]}` or as a bare list
 *   - `continue_on_timeout: true` (the default) and a single
 *     `wait_for_trigger` mapping vs a one-item list
 *   - Flow's own `_cafe_metadata` canvas positions
 *
 * Everything else counts. Loop condition lists are compared structurally and
 * are deliberately NOT normalized against surrounding guards: `until: [a, b]`
 * followed by `if c` behaves differently from `until: [a, b, c]`.
 *
 * Human prose (alias / note / description) never counts as behavior, but it is
 * collected so that losing it is reported separately.
 */

/** Keys that carry human prose, not behavior. Tracked, not diffed. */
const PROSE_KEYS: Record<string, true> = { alias: true, note: true, description: true };

const DURATION_UNITS: Record<string, number> = {
  days: 86400,
  hours: 3600,
  minutes: 60,
  seconds: 1,
  milliseconds: 0.001,
};

export interface Prose {
  aliases: string[];
  notes: string[];
}

export type ConfigKind = 'automation' | 'script';

export interface CanonicalConfig {
  kind: ConfigKind;
  canon: JsonObject;
  prose: Prose;
}

/** "00:05:00" | {minutes: 5} | 30 -> seconds, or null when not a fixed duration. */
function durationSeconds(v: Json): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(v.trim());
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return null; // templated or unparseable: compare verbatim
  }
  if (isJsonObject(v)) {
    let total = 0;
    for (const k of Object.keys(v)) {
      const mult = DURATION_UNITS[k];
      const n = v[k];
      if (mult === undefined || typeof n !== 'number') return null;
      total += n * mult;
    }
    return total;
  }
  return null;
}

function canonDuration(v: Json): Json {
  const secs = durationSeconds(v);
  return secs === null ? canonValue(v) : secs;
}

/** Wrap a scalar/mapping in a list; null/undefined become the empty list. */
function toList(v: Json | undefined): Json[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function firstList(o: JsonObject, ...keys: string[]): Json[] {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null) return toList(v);
  }
  return [];
}

/** Collect prose fields from any node so both spellings account identically. */
function harvestProse(obj: JsonObject, prose: Prose): void {
  for (const k of Object.keys(PROSE_KEYS)) {
    const v = obj[k];
    if (typeof v !== 'string' || v.length === 0) continue;
    if (k === 'alias') prose.aliases.push(v);
    // an automation/script `description` is documentation, tracked like a step `note`
    if (k === 'note' || k === 'description') prose.notes.push(v);
  }
}

/** Sort mapping keys (unordered in YAML); preserve sequence order (behavior). */
export function canonValue(v: Json): Json {
  if (Array.isArray(v)) return v.map(canonValue);
  if (isJsonObject(v)) {
    const out: JsonObject = {};
    for (const k of Object.keys(v).sort()) out[k] = canonValue(v[k]);
    return out;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const SHORTHAND_GROUP_KEYS = ['and', 'or', 'not'] as const;

/** Expand the documented condition shorthands into their long form. */
function expandConditionShorthand(cond: Json): Json {
  if (typeof cond === 'string') {
    return { condition: 'template', value_template: cond };
  }
  if (isJsonObject(cond) && cond.condition === undefined) {
    for (const key of SHORTHAND_GROUP_KEYS) {
      if (key in cond) {
        const { [key]: group, ...rest } = cond;
        return { ...rest, condition: key, conditions: toList(group) };
      }
    }
  }
  return cond;
}

function canonCondition(rawCond: Json, prose: Prose): Json {
  const cond = expandConditionShorthand(rawCond);
  if (!isJsonObject(cond)) return cond;
  harvestProse(cond, prose);
  const out: JsonObject = {};
  for (const k of Object.keys(cond)) {
    if (Object.hasOwn(PROSE_KEYS, k)) continue;
    if (k === 'enabled' && cond[k] === true) continue;
    if (k === 'for') {
      out.for = canonDuration(cond[k]);
      continue;
    }
    if (k === 'conditions') {
      out.conditions = canonConditions(firstList(cond, 'conditions'), prose);
      continue;
    }
    if (k === 'id' && cond.condition === 'trigger') {
      out.id = toList(cond[k]);
      continue;
    }
    out[k] = canonValue(cond[k]);
  }
  return out;
}

function canonConditions(conds: Json[], prose: Prose): Json[] {
  return conds.map((c) => canonCondition(c, prose));
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function canonTrigger(t: Json, prose: Prose): Json {
  if (!isJsonObject(t)) return t;
  harvestProse(t, prose);
  const out: JsonObject = {};
  for (const k of Object.keys(t)) {
    if (Object.hasOwn(PROSE_KEYS, k)) continue;
    if (k === 'enabled' && t[k] === true) continue;
    if (k === 'for') {
      out.for = canonDuration(t[k]);
      continue;
    }
    // `platform` was renamed to `trigger`
    out[k === 'platform' ? 'trigger' : k] = canonValue(t[k]);
  }
  return canonValue(out);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function canonSequence(seq: Json[], prose: Prose): Json[] {
  const steps = seq
    .map((s) => canonStep(s, prose))
    .filter((s) => {
      if (isJsonObject(s) && Object.keys(s).length === 0) return false;
      return s !== null && s !== undefined;
    });
  return absorbContinuations(steps);
}

type Decision = JsonObject & { __decision: Json[] };

function isEnabledDecision(step: Json | undefined): step is Decision {
  return isJsonObject(step) && Array.isArray(step.__decision) && step.enabled !== false;
}

/**
 * Build the canonical decision ladder `__decision: [{when, do}, ...]` plus an
 * optional `__otherwise`.
 *
 * `else: [ <decision> ]` is flattened into sibling branches: `if A then X else
 * (if B then Y)` is exactly the ladder `choose [A->X, B->Y]`, so the two
 * spellings must compare equal.
 */
function makeDecision(branches: Json[], elseSteps: Json[], disabled: boolean): JsonObject {
  const ladder = [...branches];
  let otherwise = elseSteps;
  while (otherwise.length === 1) {
    const only = otherwise[0];
    if (!isEnabledDecision(only)) break;
    ladder.push(...only.__decision);
    const innerElse = only.__otherwise;
    otherwise = Array.isArray(innerElse) ? innerElse : [];
  }
  const out: JsonObject = { __decision: ladder };
  if (otherwise.length > 0) out.__otherwise = otherwise;
  if (disabled) out.enabled = false;
  return out;
}

function canonDecision(step: JsonObject, prose: Prose): JsonObject {
  const branches: Json[] = [];
  let otherwise: Json[] = [];

  if ('choose' in step) {
    for (const c of toList(step.choose)) {
      if (!isJsonObject(c)) continue;
      // A choose branch carries its own alias; the equivalent if/then/else
      // spelling carries it on the step. Harvest both or the conversion
      // looks like prose loss when nothing was lost.
      harvestProse(c, prose);
      branches.push({
        when: canonConditions(firstList(c, 'conditions', 'condition'), prose),
        do: canonSequence(firstList(c, 'sequence'), prose),
      });
    }
    otherwise = canonSequence(firstList(step, 'default'), prose);
  } else {
    branches.push({
      when: canonConditions(firstList(step, 'if'), prose),
      do: canonSequence(firstList(step, 'then'), prose),
    });
    otherwise = canonSequence(firstList(step, 'else'), prose);
  }

  return makeDecision(branches, otherwise, step.enabled === false);
}

/** True when control can never run off the end of this sequence: it always ends in a `stop`. */
function alwaysStops(seq: Json[]): boolean {
  const last = seq[seq.length - 1];
  if (!isJsonObject(last) || last.enabled === false) return false;
  if ('stop' in last) return true;
  return isEnabledDecision(last) && decisionSlots(last).every(alwaysStops);
}

/** Every sequence a decision can run: each branch, then the (possibly empty) else. */
function decisionSlots(decision: Decision): Json[][] {
  const slots = decision.__decision.map((b) => (isJsonObject(b) ? toList(b.do) : []));
  slots.push(toList(decision.__otherwise));
  return slots;
}

/**
 * `if A then [..., stop]` followed by more steps means the same as
 * `if A then [..., stop] else [more steps]`: whatever follows a decision that
 * has a branch that always stops can only run through its OTHER branch. Fold
 * the following steps into that branch so both spellings compare equal.
 */
function absorbContinuations(steps: Json[]): Json[] {
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i];
    if (!isEnabledDecision(step)) continue;

    const slots = decisionSlots(step);
    const open = slots.flatMap((slot, index) => (alwaysStops(slot) ? [] : [index]));
    if (open.length !== 1) continue; // every slot stops (rest is dead code) or several stay open

    const rest = steps.slice(i + 1);
    const merged = slots.map((slot, index) =>
      index === open[0] ? absorbContinuations([...slot, ...rest]) : slot
    );
    const branchCount = step.__decision.length;
    const branches = step.__decision.map((b, index) =>
      isJsonObject(b) ? { ...b, do: merged[index] } : b
    );
    return [...steps.slice(0, i), makeDecision(branches, merged[branchCount], false)];
  }
  return steps;
}

/** Loop condition lists stay structural on purpose. */
function canonRepeat(step: JsonObject, repeat: JsonObject, prose: Prose): JsonObject {
  const out: JsonObject = {};
  if (repeat.until !== undefined) out.until = canonConditions(firstList(repeat, 'until'), prose);
  if (repeat.while !== undefined) out.while = canonConditions(firstList(repeat, 'while'), prose);
  if (repeat.count !== undefined) out.count = repeat.count;
  if (repeat.for_each !== undefined) out.for_each = canonValue(repeat.for_each);
  out.sequence = canonSequence(firstList(repeat, 'sequence'), prose);
  const wrapped: JsonObject = { __repeat: out };
  if (step.enabled === false) wrapped.enabled = false;
  return wrapped;
}

/** A `parallel` branch is a `{sequence: [...]}`, a bare list, or a single step. */
function canonParallelBranch(branch: Json, prose: Prose): Json {
  if (Array.isArray(branch)) return canonSequence(branch, prose);
  if (isJsonObject(branch) && Array.isArray(branch.sequence)) {
    const { sequence, ...rest } = branch;
    const onlySequence = Object.keys(rest).every((k) => Object.hasOwn(PROSE_KEYS, k));
    if (onlySequence) {
      harvestProse(branch, prose);
      return canonSequence(sequence, prose);
    }
  }
  return canonSequence([branch], prose);
}

function canonWaitFields(step: JsonObject, out: JsonObject, prose: Prose): void {
  if ('wait_for_trigger' in step) {
    out.wait_for_trigger = toList(step.wait_for_trigger).map((t) => canonTrigger(t, prose));
  }
  if ('timeout' in step) out.timeout = canonDuration(step.timeout);
  // `continue_on_timeout` defaults to true
  if ('continue_on_timeout' in step && step.continue_on_timeout !== true) {
    out.continue_on_timeout = step.continue_on_timeout;
  }
}

/**
 * Canonicalize one action step. Returns an empty object for steps that carry
 * no behavior once normalized (e.g. an empty branch container).
 */
function canonStep(step: Json, prose: Prose): Json {
  if (!isJsonObject(step)) return step;

  harvestProse(step, prose);

  if ('if' in step || 'choose' in step) return canonDecision(step, prose);

  if ('repeat' in step && isJsonObject(step.repeat)) {
    return canonRepeat(step, step.repeat, prose);
  }

  // bare condition step (gates everything after it in its sequence)
  if ('condition' in step && !('action' in step) && !('service' in step)) {
    return { __condition: canonCondition(step, prose) };
  }

  const out: JsonObject = {};
  for (const k of Object.keys(step)) {
    if (Object.hasOwn(PROSE_KEYS, k)) continue;
    if (k === 'enabled' && step[k] === true) continue;
    if (k === 'wait_for_trigger' || k === 'timeout' || k === 'continue_on_timeout') continue;
    // upstream renamed `service` to `action`; both are accepted
    const key = k === 'service' ? 'action' : k;
    if (k === 'delay') {
      out.delay = canonDuration(step[k]);
    } else if (k === 'sequence') {
      out[key] = canonSequence(firstList(step, k), prose);
    } else if (k === 'parallel') {
      out[key] = toList(step[k]).map((b) => canonParallelBranch(b, prose));
    } else {
      out[key] = canonValue(step[k]);
    }
  }
  canonWaitFields(step, out, prose);
  return out;
}

// ---------------------------------------------------------------------------
// Whole configs
// ---------------------------------------------------------------------------

/** Flow keeps its canvas layout in `variables._cafe_metadata`; it is not behavior. */
function canonVariables(variables: Json | undefined): Json | null {
  if (!isJsonObject(variables)) return variables === undefined ? null : canonValue(variables);
  const copy: JsonObject = {};
  for (const k of Object.keys(variables)) {
    if (k === '_cafe_metadata') continue;
    copy[k] = canonValue(variables[k]);
  }
  return Object.keys(copy).length > 0 ? canonValue(copy) : null;
}

/** Scripts have a `sequence` and no triggers; everything else is an automation. */
export function detectConfigKind(raw: Json): ConfigKind {
  if (!isJsonObject(raw)) return 'automation';
  const hasAutomationKeys =
    'triggers' in raw || 'trigger' in raw || 'actions' in raw || 'action' in raw;
  return 'sequence' in raw && !hasAutomationKeys ? 'script' : 'automation';
}

const PASSTHROUGH_KEYS = [
  'max',
  'max_exceeded',
  'trigger_variables',
  'initial_state',
  'hide_entity',
  'trace',
  'use_blueprint',
  'fields',
  'icon',
] as const;

export function canonicalizeConfig(raw: Json): CanonicalConfig {
  const prose: Prose = { aliases: [], notes: [] };
  const kind = detectConfigKind(raw);
  if (!isJsonObject(raw)) return { kind, canon: { value: raw }, prose };

  harvestProse(raw, prose);

  const canon: JsonObject = { mode: raw.mode ?? 'single' };

  if (kind === 'script') {
    canon.sequence = canonSequence(firstList(raw, 'sequence'), prose);
  } else {
    canon.triggers = firstList(raw, 'triggers', 'trigger').map((t) => canonTrigger(t, prose));
    canon.actions = canonSequence(firstList(raw, 'actions', 'action'), prose);
    const conditions = canonConditions(firstList(raw, 'conditions', 'condition'), prose);
    if (conditions.length > 0) canon.conditions = conditions;
  }

  const variables = canonVariables(raw.variables);
  if (variables !== null) canon.variables = variables;
  for (const key of PASSTHROUGH_KEYS) {
    if (raw[key] !== undefined) canon[key] = canonValue(raw[key]);
  }
  return { kind, canon, prose };
}
