import type { FlowGraph, FlowNode } from '@flow/shared';
import { entityIdsOf, isDisabled, mapNode } from '../nodes';
import type { ReadabilityFinding, ReadabilityFix, ReadabilityRule } from '../types';
import {
  type DataRecord,
  domainOf,
  hasValue,
  joinNames,
  nonEmptyString,
  toStringList,
} from '../values';

/** The two "no real reading" states: the device is offline, or has not reported yet. */
const OFFLINE_STATES: readonly string[] = ['unavailable', 'unknown'];

/**
 * Entity types whose very first state is `unknown` and whose first press or event moves them away
 * from it. For these a real event looks exactly like an "unknown" restore.
 */
const FIRST_STATE_UNKNOWN_DOMAINS: Record<string, true> = {
  button: true,
  input_button: true,
  event: true,
  scene: true,
  notify: true,
};

function quoted(states: readonly string[], conjunction = 'and'): string {
  return joinNames(
    states.map((state) => `“${state}”`),
    states.length,
    conjunction
  );
}

function offlineStatesIn(value: unknown): string[] {
  return toStringList(value).filter((state) => OFFLINE_STATES.includes(state));
}

/** A `from:` that names a real state, so a restore from `unavailable` can never match it. */
function isPinned(from: unknown): boolean {
  return toStringList(from).some((state) => state.trim() !== '');
}

type RestoreProblem =
  /** `to:` names unavailable/unknown: the automation starts when the entity goes offline. */
  | { kind: 'goes-offline'; states: string[] }
  /** `from:` names unavailable/unknown: the automation starts when the entity comes back. */
  | { kind: 'restore-trigger'; states: string[] }
  /** Watches an attribute, where `from`/`not_from` compare attribute values, not the state. */
  | { kind: 'attribute' }
  /** `not_from:` ignores some states but not `unavailable`. */
  | { kind: 'incomplete-guard'; ignored: string[] }
  /** Nothing stops a restore from `unavailable` from counting as a change. */
  | { kind: 'unguarded' };

/** Why (if at all) a state trigger starts the automation when its entity returns from offline. */
function diagnose(data: DataRecord): RestoreProblem | null {
  const to = offlineStatesIn(data.to);
  if (to.length > 0) return { kind: 'goes-offline', states: to };
  const from = offlineStatesIn(data.from);
  if (from.length > 0) return { kind: 'restore-trigger', states: from };
  if (isPinned(data.from)) return null;
  if (nonEmptyString(data.attribute) !== undefined) return { kind: 'attribute' };

  const ignored = toStringList(data.not_from);
  if (ignored.includes('unavailable')) return null;
  return ignored.length > 0 ? { kind: 'incomplete-guard', ignored } : { kind: 'unguarded' };
}

/**
 * Home Assistant fires a state trigger on attribute-only changes too, but only while none of
 * `from`/`not_from`/`to`/`not_to` is present. Adding `not_from` switches that off.
 */
function reactsToAttributeChanges(data: DataRecord): boolean {
  return !['from', 'not_from', 'to', 'not_to'].some((key) => hasValue(data, key));
}

function isFirstStateUnknown(entityId: string): boolean {
  return Object.hasOwn(FIRST_STATE_UNKNOWN_DOMAINS, domainOf(entityId));
}

/** Adds the states to the trigger's `not_from`; a no-op once the trigger no longer needs it. */
function ignoreStates(nodeId: string, states: readonly string[]): (graph: FlowGraph) => FlowGraph {
  return (graph) =>
    mapNode(graph, nodeId, (node: FlowNode) => {
      if (node.type !== 'trigger') return node;
      const diagnosed: DataRecord = node.data;
      const problem = diagnose(diagnosed);
      if (problem?.kind !== 'unguarded' && problem?.kind !== 'incomplete-guard') return node;

      // `from: null` may not sit next to `not_from` (Home Assistant rejects both keys together).
      const { from: _from, ...rest } = node.data;
      const already = toStringList(diagnosed.not_from);
      const merged = [...already, ...states.filter((state) => !already.includes(state))];
      const data = { ...rest, not_from: merged };
      return { ...node, data };
    });
}

const REACTS_TO_ATTRIBUTES_NOTE =
  'This trigger has no “to” or “from”, so it also reacts when only an attribute changes. Ignoring “unavailable” makes it react to real state changes only.';

/** Why ignoring “unknown” too could swallow a genuine event, or undefined when it cannot. */
function ignoreUnknownRisk(entities: readonly string[], matchAll: boolean): string | undefined {
  if (matchAll) return REACTS_TO_ATTRIBUTES_NOTE;
  if (entities.length === 0) {
    return 'Flow cannot tell which entity this is. Buttons and events start as “unknown”, so ignoring it would swallow their first press.';
  }
  const buttonLike = entities.filter(isFirstStateUnknown);
  if (buttonLike.length === 0) return undefined;
  return `${joinNames(buttonLike)} begins as “unknown”: the first press or event moves it away from that, so ignoring “unknown” would swallow that first one.`;
}

function unguardedFixes(nodeId: string, data: DataRecord): ReadabilityFix[] {
  const matchAll = reactsToAttributeChanges(data);
  const unknownRisk = ignoreUnknownRisk(entityIdsOf(data), matchAll);

  return [
    {
      label: 'Ignore restores from “unavailable”',
      safe: !matchAll,
      note: matchAll ? REACTS_TO_ATTRIBUTES_NOTE : undefined,
      apply: ignoreStates(nodeId, ['unavailable']),
    },
    {
      label: 'Ignore “unavailable” and “unknown”',
      safe: unknownRisk === undefined,
      note: unknownRisk,
      apply: ignoreStates(nodeId, ['unavailable', 'unknown']),
    },
  ];
}

function stateTriggerFinding(node: FlowNode, problem: RestoreProblem): ReadabilityFinding {
  const data: DataRecord = node.data;
  // A trigger on several entities starts when ANY of them changes, hence "or".
  const entities = joinNames(entityIdsOf(data), 2, 'or') || 'the entity';
  const base = {
    id: `unavailable-restore:${node.id}`,
    ruleId: 'unavailable-restore',
    severity: 'warning' as const,
    nodeId: node.id,
  };

  switch (problem.kind) {
    case 'goes-offline':
      return {
        ...base,
        message: `Starts when ${entities} goes ${quoted(problem.states, 'or')}, and then changes something.`,
        detail:
          'A device dropping offline is not a real event, so acting on it can switch things by mistake. Take it out of the trigger, unless this is a deliberate offline alert or failover.',
        fixes: [],
      };
    case 'restore-trigger':
      return {
        ...base,
        message: `Starts when ${entities} comes back from ${quoted(problem.states, 'or')}, and then changes something.`,
        detail:
          'Coming back online is not a real change. Take it out of the trigger, unless recovering from an outage is the whole point of this automation.',
        fixes: [],
      };
    case 'attribute':
      return {
        ...base,
        message: `When ${entities} comes back after being “unavailable”, this can start by mistake.`,
        detail:
          'This trigger watches an attribute, so it cannot ignore restores itself. Add a Template condition that skips them: {{ trigger.from_state.state not in ["unavailable", "unknown"] }}',
        fixes: [],
      };
    case 'incomplete-guard':
      return {
        ...base,
        message: `Ignores changes from ${quoted(problem.ignored)}, but still starts when ${entities} comes back from “unavailable”.`,
        detail:
          'Home Assistant treats a jump from “unavailable” to a normal state (such as “on”) as a real change, so a device that drops offline and reconnects starts this automation although nothing happened.',
        fixes: [
          {
            label: 'Also ignore “unavailable”',
            safe: true,
            apply: ignoreStates(node.id, ['unavailable']),
          },
        ],
      };
    case 'unguarded':
      return {
        ...base,
        message: `Starts when ${entities} comes back after being “unavailable”, not only on a real change.`,
        detail:
          'Home Assistant treats a jump from “unavailable” to a normal state (such as “on”) as a real change. If the device drops offline and reconnects, this automation runs although nothing happened. Ignoring changes that come from “unavailable” keeps only real changes.',
        fixes: unguardedFixes(node.id, data),
      };
  }
}

function numericTriggerFinding(node: FlowNode): ReadabilityFinding {
  const entities = joinNames(entityIdsOf(node.data), 2, 'or') || 'the sensor';
  return {
    id: `unavailable-restore:${node.id}`,
    ruleId: 'unavailable-restore',
    severity: 'info',
    nodeId: node.id,
    message: `If ${entities} drops to “unavailable” and comes back, this can start by mistake.`,
    detail:
      'Add a Template condition that skips changes coming from an offline sensor: {{ trigger.from_state.state not in ["unavailable", "unknown"] }}',
    fixes: [],
  };
}

/**
 * House rule 3: a sensor going unavailable must never make something happen, and neither may it
 * coming back. Only automations that change something are checked: one that merely sends a
 * notification can start by mistake without harm.
 */
export const unavailableRestoreRule: ReadabilityRule = {
  id: 'unavailable-restore',
  title: 'Starts when a device comes back online',
  check: ({ graph, actuates, hasRestoreGuard }) => {
    if (!actuates || hasRestoreGuard) return [];
    return graph.nodes.flatMap((node): ReadabilityFinding[] => {
      const data: DataRecord = node.data;
      if (node.type !== 'trigger' || isDisabled(data)) return [];
      const platform = nonEmptyString(data.trigger) ?? nonEmptyString(data.platform) ?? 'state';
      if (platform === 'numeric_state') return [numericTriggerFinding(node)];
      if (platform !== 'state') return [];
      const problem = diagnose(data);
      return problem ? [stateTriggerFinding(node, problem)] : [];
    });
  },
};
