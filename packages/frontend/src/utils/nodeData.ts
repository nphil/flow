import type { FlowNode } from '@flow/shared';

/**
 * Type-safe utility functions for working with node data.
 * Eliminates the repetitive pattern of: ((node.data as Record<string, unknown>).field as Type)
 */

/**
 * Get a value from node data with type safety and default value support
 */
export function getNodeData<T = unknown>(node: FlowNode, key: string, defaultValue?: T): T {
  const data = node.data as Record<string, unknown>;
  const value = data[key] as T;
  return value !== undefined && value !== null ? value : (defaultValue as T);
}

/**
 * Get a string value from node data.
 * Coerces legacy {value, label} option objects (stored by old code) to their `.value` string
 * to prevent React error #31 when such objects are rendered as children.
 */
export function getNodeDataString(node: FlowNode, key: string, defaultValue = ''): string {
  const raw = getNodeData<unknown>(node, key, defaultValue);
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.value === 'string') return obj.value;
  }
  return defaultValue;
}

/**
 * Get a number value from node data
 */
export function getNodeDataNumber(
  node: FlowNode,
  key: string,
  defaultValue?: number
): number | undefined {
  const value = getNodeData(node, key, defaultValue);
  return typeof value === 'number' ? value : defaultValue;
}

/**
 * Get a boolean value from node data
 */
export function getNodeDataBoolean(node: FlowNode, key: string, defaultValue = false): boolean {
  return getNodeData(node, key, defaultValue);
}

/**
 * Get an array value from node data
 */
export function getNodeDataArray<T = unknown>(
  node: FlowNode,
  key: string,
  defaultValue: T[] = []
): T[] {
  const value = getNodeData(node, key, defaultValue);
  return Array.isArray(value) ? value : defaultValue;
}

/**
 * Get an object value from node data
 */
export function getNodeDataObject<T = Record<string, unknown>>(
  node: FlowNode,
  key: string,
  defaultValue = {} as T
): T {
  const value = getNodeData(node, key, defaultValue);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as T)
    : defaultValue;
}

/**
 * Type-safe setter helper for node data updates
 */
export function setNodeData(
  updateFn: (id: string, data: Record<string, unknown>) => void,
  nodeId: string,
  key: string,
  value: unknown
) {
  updateFn(nodeId, { [key]: value });
}

/**
 * Helper for updating nested object properties in node data
 */
export function setNestedNodeData(
  updateFn: (id: string, data: Record<string, unknown>) => void,
  nodeId: string,
  parentKey: string,
  childKey: string,
  value: unknown,
  currentData: Record<string, unknown>
) {
  const parentData = (currentData[parentKey] as Record<string, unknown>) || {};
  updateFn(nodeId, {
    [parentKey]: { ...parentData, [childKey]: value },
  });
}

/**
 * Design-system color category for a canvas node (design doc §3). Six of the
 * seven map 1:1 from the schema `type`; `action` fans out further since HA
 * flow-control actions (stop / an opaque preserved `repeat`|`parallel` block)
 * get the rose 'flowctl' kind instead of plain green 'action', and a step Flow
 * cannot model (the parser keeps it as `verbatimStep`) gets 'unknown'.
 */
export type NodeKind =
  | 'trigger'
  | 'condition'
  | 'action'
  | 'timing'
  | 'data'
  | 'flowctl'
  | 'unknown';

export function getNodeKind(type: string | undefined, data: Record<string, unknown>): NodeKind {
  switch (type) {
    case 'trigger':
      return 'trigger';
    case 'condition':
      return 'condition';
    case 'delay':
    case 'wait':
      return 'timing';
    case 'set_variables':
      return 'data';
    case 'action':
      if (data.verbatimStep !== undefined) return 'unknown';
      if (
        typeof data.stop === 'string' ||
        data.repeat !== undefined ||
        data.parallel !== undefined
      ) {
        return 'flowctl';
      }
      return 'action';
    default:
      return 'unknown';
  }
}
