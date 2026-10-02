/** Small, strictly-typed readers for loosely-typed node data (raw Home Assistant step objects). */

export type DataRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is DataRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trimmed, non-empty string, or undefined. */
export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A string or a list of strings as a list of strings; anything else is ignored. */
export function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

/** True when the key holds a value (`null` counts: in Home Assistant YAML `to: null` is a choice). */
export function hasValue(data: DataRecord, key: string): boolean {
  return data[key] !== undefined;
}

/** `light.kitchen` -> `light`. */
export function domainOf(entityId: string): string {
  const dot = entityId.indexOf('.');
  return dot === -1 ? entityId : entityId.slice(0, dot);
}

/** True for values that are Jinja templates rather than literal text. */
export function isTemplateText(value: string): boolean {
  return value.includes('{{') || value.includes('{%');
}

/** `a`, `a and b`, `a, b and 2 more` -- for naming things in a sentence. */
export function joinNames(names: readonly string[], limit = 2, conjunction = 'and'): string {
  if (names.length <= limit) {
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`;
  }
  const more = names.length - limit;
  return `${names.slice(0, limit).join(', ')} ${conjunction} ${more} more`;
}
