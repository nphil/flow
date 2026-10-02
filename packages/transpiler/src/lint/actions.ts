import type { FlowGraph } from '@flow/shared';
import { isDisabled } from './nodes';
import { type DataRecord, domainOf, isRecord, isTemplateText } from './values';

/**
 * Services that only tell a human something. An automation whose every call is one of these does
 * not change anything in the house, so a spurious start is harmless. Add a domain here to widen it.
 */
const INFORMATIONAL_DOMAINS: Record<string, true> = {
  notify: true,
  persistent_notification: true,
  logbook: true,
  system_log: true,
  tts: true,
};

/** Parser placeholder for a step Flow could not read; it says nothing about what the step does. */
const UNKNOWN_SERVICE = 'unknown.unknown';

/** Keys whose value holds more steps (`then`/`else`/`default`/`sequence` lists, `choose`, `parallel`, `repeat`). */
const NESTED_STEP_KEYS = ['then', 'else', 'default', 'sequence', 'parallel', 'choose'];

/**
 * Names of the services a step calls, including steps nested in `if`/`choose`/`repeat`/`parallel`
 * blocks. Disabled steps are skipped. A device action (`domain` + `type`) counts as `domain.type`.
 */
export function collectServiceNames(step: unknown, into: string[] = [], depth = 0): string[] {
  if (depth > 12) return into;
  if (Array.isArray(step)) {
    for (const item of step) collectServiceNames(item, into, depth + 1);
    return into;
  }
  if (!isRecord(step) || isDisabled(step)) return into;

  const called = step.service ?? step.action;
  if (typeof called === 'string' && called !== UNKNOWN_SERVICE) into.push(called);
  if (typeof step.scene === 'string') into.push('scene.turn_on');
  if (typeof step.domain === 'string' && typeof step.type === 'string' && 'device_id' in step) {
    into.push(`${step.domain}.${step.type}`);
  }

  for (const key of NESTED_STEP_KEYS) collectServiceNames(step[key], into, depth + 1);
  if (isRecord(step.repeat)) collectServiceNames(step.repeat.sequence, into, depth + 1);
  return into;
}

/** True when calling this service does not change anything besides informing someone. */
export function isInformationalService(service: string): boolean {
  if (isTemplateText(service)) return false;
  return Object.hasOwn(INFORMATIONAL_DOMAINS, domainOf(service));
}

/** HOUSE RULE 3 "actuates": an enabled action step calls something that is not purely informational. */
export function automationActuates(graph: FlowGraph): boolean {
  return graph.nodes.some((node) => {
    if (node.type !== 'action') return false;
    const data: DataRecord = node.data;
    return collectServiceNames(data).some((service) => !isInformationalService(service));
  });
}
