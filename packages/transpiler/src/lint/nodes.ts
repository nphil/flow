import type { FlowGraph, FlowNode } from '@flow/shared';
import { type DataRecord, isRecord, toStringList } from './values';

/** What a node is called in a sentence ("This trigger has no name"). */
export const NODE_KIND_WORD: Record<FlowNode['type'], string> = {
  trigger: 'trigger',
  condition: 'condition',
  action: 'action',
  delay: 'delay',
  wait: 'wait step',
  set_variables: 'variables step',
};

/**
 * Returns a graph where `update` replaced the node with this id. Returns the SAME graph object
 * when `update` handed the node back untouched, so callers can tell "nothing to do" cheaply.
 */
export function mapNode(
  graph: FlowGraph,
  nodeId: string,
  update: (node: FlowNode) => FlowNode
): FlowGraph {
  let changed = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const next = update(node);
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...graph, nodes } : graph;
}

/** Entity ids a step points at: `entity_id` plus `target.entity_id`, without repeats. */
export function entityIdsOf(data: DataRecord): string[] {
  const target = isRecord(data.target) ? toStringList(data.target.entity_id) : [];
  return [...new Set([...toStringList(data.entity_id), ...target])];
}

/** A node whose `enabled: false` switch is off never runs, so it can neither cause nor suffer problems. */
export function isDisabled(data: DataRecord): boolean {
  return data.enabled === false;
}
