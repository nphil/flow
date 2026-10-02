import type { FlowGraph, FlowNode, HACondition } from '@flow/shared';
import { type ConditionRef, listConditions, updateConditionAt } from '../conditions';
import { mapNode } from '../nodes';
import {
  classifyTemplate,
  type ExactTemplate,
  matchExactTemplate,
  type NativeKind,
  templateCalls,
} from '../template';
import type { ReadabilityFinding, ReadabilityFix, ReadabilityRule } from '../types';
import { joinNames } from '../values';

type NumericTemplate = Extract<ExactTemplate, { kind: 'numeric-state' }>;

/** How each recognised kind reads in a sentence ("... could replace this template"). */
const NATIVE_PHRASES: Record<NativeKind, string> = {
  state: 'a State condition',
  'not-state': 'a Not condition around a State condition',
  'numeric-state': 'a Numeric state condition',
  trigger: 'a Trigger condition',
  time: 'a Time condition',
};

/** The condition written natively. Everything else on it (name, note, enabled...) is kept. */
function toNative(condition: HACondition, exact: ExactTemplate): HACondition {
  const { value_template: _template, ...rest } = condition;
  switch (exact.kind) {
    case 'state': {
      const state = { condition: 'state', entity_id: exact.entityId, state: exact.state };
      return exact.negated
        ? { ...rest, condition: 'not', conditions: [state] }
        : { ...rest, ...state };
    }
    case 'state-attribute':
      return {
        ...rest,
        condition: 'state',
        entity_id: exact.entityId,
        attribute: exact.attribute,
        state: exact.value,
      };
    case 'numeric-state':
      return {
        ...rest,
        condition: 'numeric_state',
        entity_id: exact.entityId,
        ...(exact.direction === 'above' ? { above: exact.threshold } : { below: exact.threshold }),
      };
    case 'trigger-id':
      return { ...rest, condition: 'trigger', id: exact.id };
  }
}

/** Replaces the template condition at `path` with its native form, if it is still convertible. */
function convertTemplate(nodeId: string, path: readonly number[]): (graph: FlowGraph) => FlowGraph {
  return (graph) =>
    mapNode(graph, nodeId, (node) => {
      if (node.type !== 'condition') return node;
      const data = updateConditionAt(node.data, path, (condition) => {
        const template = condition.value_template;
        if (condition.condition !== 'template' || typeof template !== 'string') return condition;
        const exact = matchExactTemplate(template);
        return exact ? toNative(condition, exact) : condition;
      });
      return data === node.data ? node : { ...node, data };
    });
}

/** Does the template give a different answer than the native condition when something is off? */
function numericCaveats(exact: NumericTemplate): { safe: boolean; note?: string } {
  const notes: string[] = [];
  let safe = true;

  if (exact.cast === 'int') {
    safe = false;
    notes.push(
      '“int” cuts off the decimals (25.7 counts as 25), but a Numeric state condition compares the exact number, so it can answer differently.'
    );
  }
  const { fallback, direction, threshold } = exact;
  const fallbackPasses =
    fallback !== null && (direction === 'above' ? fallback > threshold : fallback < threshold);
  if (fallback !== null && fallbackPasses) {
    notes.push(
      `When ${exact.entityId} is offline the template counts it as ${fallback}, which makes this condition true. A Numeric state condition counts an offline sensor as not matching.`
    );
  }
  return { safe, note: notes.length > 0 ? notes.join(' ') : undefined };
}

function exactFinding(
  node: FlowNode,
  ref: ConditionRef,
  exact: ExactTemplate
): Pick<ReadabilityFinding, 'message' | 'fixes'> {
  const fix = (label: string, safe = true, note?: string): ReadabilityFix => ({
    label,
    safe,
    note,
    apply: convertTemplate(node.id, ref.path),
  });

  switch (exact.kind) {
    case 'state':
      return exact.negated
        ? {
            message: `This template only checks that ${exact.entityId} is not “${exact.state}”. A Not condition around a State condition says the same without code.`,
            fixes: [fix('Change to Not + State')],
          }
        : {
            message: `This template only checks whether ${exact.entityId} is “${exact.state}”. A State condition says the same without code.`,
            fixes: [fix('Change to a State condition')],
          };
    case 'state-attribute':
      return {
        message: `This template only checks the “${exact.attribute}” of ${exact.entityId}. A State condition with an attribute says the same without code.`,
        fixes: [fix('Change to a State condition')],
      };
    case 'numeric-state': {
      const { safe, note } = numericCaveats(exact);
      return {
        message: `This template compares the number in ${exact.entityId} with ${exact.threshold}. A Numeric state condition (${exact.direction} ${exact.threshold}) says the same without code.`,
        fixes: [fix('Change to a Numeric state condition', safe, note)],
      };
    }
    case 'trigger-id':
      return {
        message: `This template only checks that the trigger “${exact.id}” started the automation. A Trigger condition says the same without code.`,
        fixes: [fix('Change to a Trigger condition')],
      };
  }
}

function hintMessage(kinds: readonly NativeKind[]): string {
  const phrases = kinds.map((kind) => NATIVE_PHRASES[kind]);
  const sentence = joinNames(phrases, phrases.length);
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} could replace this template.`;
}

function conditionFindings(node: FlowNode, ref: ConditionRef): ReadabilityFinding[] {
  const template = ref.condition.value_template;
  if (ref.condition.condition !== 'template' || typeof template !== 'string') return [];

  const base = {
    id: `template-native:${[node.id, ...ref.path].join(':')}`,
    ruleId: 'template-native',
    severity: 'info' as const,
    nodeId: node.id,
  };
  const exact = matchExactTemplate(template);
  if (exact) {
    return [
      {
        ...base,
        ...exactFinding(node, ref, exact),
        detail:
          'A template needs some code knowledge to read. A normal condition shows what it checks right on the canvas.',
      },
    ];
  }

  const kinds = classifyTemplate(template);
  if (!kinds) return [];
  return [
    {
      ...base,
      message: hintMessage(kinds),
      detail:
        'A template needs some code knowledge to read. A normal condition shows what it checks right on the canvas. Flow cannot convert this one for you.',
      fixes: [],
    },
  ];
}

function waitFindings(node: FlowNode): ReadabilityFinding[] {
  if (node.type !== 'wait') return [];
  const template = node.data.wait_template;
  if (typeof template !== 'string' || !templateCalls(template, 'is_state')) return [];
  if (classifyTemplate(template) === null) return [];
  return [
    {
      id: `template-native:${node.id}`,
      ruleId: 'template-native',
      severity: 'info',
      nodeId: node.id,
      message:
        'This step waits until a template is true, and carries on straight away if it already is.',
      detail:
        'To wait for the state to CHANGE to that value, use a “Wait for trigger” step with a State trigger instead. Keep the template if carrying on straight away is what you want.',
      fixes: [],
    },
  ];
}

/**
 * House rule 1/2: native conditions instead of clever templates. A template is converted for you
 * only when it is exactly one of a few simple shapes; anything else that a plain condition could
 * replace is reported without a fix.
 */
export const templateNativeRule: ReadabilityRule = {
  id: 'template-native',
  title: 'Template that a normal condition can replace',
  check: ({ graph }) =>
    graph.nodes.flatMap((node) => {
      if (node.type === 'condition') {
        return listConditions(node.data).flatMap((ref) => conditionFindings(node, ref));
      }
      return waitFindings(node);
    }),
};
