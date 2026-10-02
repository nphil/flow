import { type FlowGraph, type FlowNode, NodeSchema } from '@flow/shared';
import { lintFlowGraph, type ReadabilityFinding, type ReadabilityFix } from '../lint';

/** A node built through the schema, so tests use exactly the typed shapes the app does. */
export function node(type: FlowNode['type'], id: string, data: Record<string, unknown>): FlowNode {
  return NodeSchema.parse({ id, type, position: { x: 0, y: 0 }, data });
}

export function graphOf(nodes: FlowNode[], overrides: Partial<FlowGraph> = {}): FlowGraph {
  return {
    id: '8d3c0f1e-5b7a-4a52-9c1d-6e2b7f0a4d90',
    name: 'Test automation',
    description: 'Used by the readability tests.',
    nodes,
    edges: [],
    version: 1,
    ...overrides,
  };
}

/** An action that actually switches something (so house rule 3 applies to the automation). */
export function lightAction(id = 'action_1'): FlowNode {
  return node('action', id, {
    alias: 'Turn the light on',
    service: 'light.turn_on',
    target: { entity_id: 'light.kitchen' },
  });
}

/** A named state trigger plus a light action: the smallest automation rule (b) looks at. */
export function stateTriggerGraph(trigger: Record<string, unknown>): FlowGraph {
  return graphOf([
    node('trigger', 'trigger_1', {
      alias: 'Door changes',
      trigger: 'state',
      entity_id: 'binary_sensor.front_door',
      ...trigger,
    }),
    lightAction(),
  ]);
}

/** A named condition node, so a test about conditions is not cluttered with missing-name findings. */
export function conditionNode(data: Record<string, unknown>, id = 'condition_1'): FlowNode {
  return node('condition', id, { alias: 'Check', ...data });
}

/** Freezes a value deeply, so any code that tries to mutate it throws instead of silently working. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** The findings of one rule only, so a test is not disturbed by unrelated findings. */
export function findingsOf(graph: FlowGraph, ruleId: string): ReadabilityFinding[] {
  return lintFlowGraph(graph).filter((finding) => finding.ruleId === ruleId);
}

/** The single finding of a rule; fails loudly when there is not exactly one. */
export function onlyFinding(graph: FlowGraph, ruleId: string): ReadabilityFinding {
  const found = findingsOf(graph, ruleId);
  const [finding] = found;
  if (found.length !== 1 || !finding) {
    const messages = JSON.stringify(found.map((f) => f.message));
    throw new Error(`expected one ${ruleId} finding, got ${found.length}: ${messages}`);
  }
  return finding;
}

/** The fix at this position of a finding's (preference-ordered) fix list. */
export function fixAt(finding: ReadabilityFinding, index: number): ReadabilityFix {
  const fix = finding.fixes[index];
  if (!fix) throw new Error(`finding ${finding.id} has no fix #${index}`);
  return fix;
}

/** Data of the node with this id, as a plain record. */
export function dataOf(graph: FlowGraph, nodeId: string): Record<string, unknown> {
  const found = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return { ...found.data };
}
