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
 * get the rose 'flowctl' kind instead of plain green 'action', and
 * YamlParser's "can't represent this" placeholder (`service:
 * 'unknown.unknown'` — see YamlParser.ts's `getNextNodeId('unknown')` call
 * sites) gets 'unknown'.
 */
export type NodeKind = 'trigger' | 'condition' | 'action' | 'timing' | 'data' | 'flowctl' | 'unknown';

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
      if (data.service === 'unknown.unknown') return 'unknown';
      if (typeof data.stop === 'string' || data.repeat !== undefined || data.parallel !== undefined) {
        return 'flowctl';
      }
      return 'action';
    default:
      return 'unknown';
  }
}

export interface NodeSummary {
  title: string;
  subtitle: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  state: 'State Change',
  time: 'Time',
  time_pattern: 'Time Pattern',
  event: 'Event',
  mqtt: 'MQTT',
  webhook: 'Webhook',
  sun: 'Sun',
  zone: 'Zone',
  numeric_state: 'Numeric State',
  template: 'Template',
  homeassistant: 'Home Assistant',
  device: 'Device',
  geo_location: 'Geolocation',
  conversation: 'Conversation',
  persistent_notification: 'Notification',
  tag: 'Tag',
  calendar: 'Calendar',
};

const CONDITION_LABELS: Record<string, string> = {
  state: 'State',
  numeric_state: 'Numeric',
  template: 'Template',
  time: 'Time',
  zone: 'Zone',
  sun: 'Sun',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
  device: 'Device',
  trigger: 'Trigger',
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Single-line entity summary: bare id, or `"N entities"` for arrays. */
function joinEntityIds(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && value.length > 0) {
    return value.length === 1 ? String(value[0]) : `${value.length} entities`;
  }
  return null;
}

function summarizeTrigger(data: Record<string, unknown>): NodeSummary {
  const triggerType = str(data.trigger) ?? 'state';
  const label = TRIGGER_LABELS[triggerType] ?? triggerType;
  const title = str(data.alias) ?? label;
  const subtitle =
    joinEntityIds(data.entity_id) ??
    str(data.event_type) ??
    str(data.topic) ??
    str(data.webhook_id) ??
    str(data.zone) ??
    str(data.at) ??
    str(data.device_id) ??
    label;
  return { title, subtitle };
}

function summarizeCondition(data: Record<string, unknown>): NodeSummary {
  const conditionType = str(data.condition) ?? 'state';
  const label = CONDITION_LABELS[conditionType] ?? conditionType;
  const title = str(data.alias) ?? label;
  const subtitle =
    joinEntityIds(data.entity_id) ??
    str(data.value_template) ??
    str(data.template) ??
    str(data.zone) ??
    str(data.after) ??
    str(data.before) ??
    (typeof data.above === 'number' ? `> ${data.above}` : null) ??
    (typeof data.below === 'number' ? `< ${data.below}` : null) ??
    label;
  return { title, subtitle };
}

function summarizeAction(data: Record<string, unknown>): NodeSummary {
  if (data.service === 'unknown.unknown') {
    return { title: str(data.alias) ?? 'Unknown Node', subtitle: 'Unrecognized — preserved' };
  }
  const isStop = typeof data.stop === 'string';
  if (isStop) {
    const title = str(data.alias) ?? (data.error === true ? 'Stop (error)' : 'Stop');
    return { title, subtitle: (data.stop as string) || 'Halts the automation' };
  }
  const service = str(data.service);
  const event = str(data.event);
  if (service) {
    const [domain, name] = service.includes('.') ? service.split('.') : [null, service];
    const title = str(data.alias) ?? name ?? service;
    const target = data.target as { entity_id?: unknown } | undefined;
    const subtitle = joinEntityIds(target?.entity_id) ?? (domain ? `${domain}.${name}` : service);
    return { title, subtitle };
  }
  if (event) {
    return { title: str(data.alias) ?? event, subtitle: 'Fire event' };
  }
  return { title: str(data.alias) ?? 'Action', subtitle: 'Action' };
}

/**
 * Derives a canvas node's card title + single-line subtitle (design doc §5:
 * "mono title + truncated muted subtitle line"). Scoped to trigger/condition/
 * action — the three types whose subtitle is a genuinely-derived
 * entity/service/platform value; delay/wait/set_variables' subtitles are
 * trivial one-liners computed inline where they're used.
 */
export function getNodeSummary(type: string | undefined, data: Record<string, unknown>): NodeSummary {
  switch (type) {
    case 'trigger':
      return summarizeTrigger(data);
    case 'condition':
      return summarizeCondition(data);
    case 'action':
      return summarizeAction(data);
    default:
      return { title: str(data.alias) ?? type ?? 'Node', subtitle: '' };
  }
}
