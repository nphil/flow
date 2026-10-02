/**
 * True for a plain mapping (not null, not an array): what YAML `key: value` data parses to.
 * Several step fields (`target`, `data`) may be a mapping OR one template string, so callers
 * narrow with this before reading keys.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
