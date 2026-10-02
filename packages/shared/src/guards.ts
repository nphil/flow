import type { FlowKind } from './schemas/base';

/**
 * True for a plain mapping (not null, not an array): what YAML `key: value` data parses to.
 * Several step fields (`target`, `data`) may be a mapping OR one template string, so callers
 * narrow with this before reading keys.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys only an automation has; a script keeps its steps under `sequence` instead. */
const AUTOMATION_KEYS = ['triggers', 'trigger', 'actions', 'action'] as const;

/**
 * What a stored Home Assistant config is, judging by its shape: a script has a `sequence` and none
 * of the automation keys. A config made from a blueprint has neither, so it reads as an
 * automation; callers that know where the config came from (the scripts list, say) say so instead.
 */
export function detectFlowKind(config: Record<string, unknown>): FlowKind {
  const hasAutomationKeys = AUTOMATION_KEYS.some((key) => key in config);
  return 'sequence' in config && !hasAutomationKeys ? 'script' : 'automation';
}
