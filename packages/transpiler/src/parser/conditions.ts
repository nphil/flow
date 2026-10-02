import { type HACondition, isRecord } from '@flow/shared';

/**
 * Home Assistant accepts several ways to write a condition. Flow keeps ONE shape in the graph (the
 * documented long form: a mapping with a `condition:` type), so everything that reads a condition
 * list goes through here first:
 *
 * - a bare template string: `"{{ is_state('light.a', 'on') }}"`
 * - `condition: "{{ ... }}"` (the template written in the type slot)
 * - boolean shorthand groups: `and: [...]`, `or: [...]`, `not: [...]` with no `condition:` key
 * - a list under the `condition:` key (an implicit `and`): `condition: [ {...}, {...} ]`
 * - a single mapping or string instead of a list
 *
 * Extra keys (alias, note, enabled, id) stay on the condition they were written on. Nested groups
 * are normalised recursively. The result means exactly what the input meant to Home Assistant.
 */

const GROUP_SHORTHAND_KEYS = ['and', 'or', 'not'] as const;

/** True when a string holds a Jinja template rather than a plain value. */
const TEMPLATE_MARKER = /\{[{%]/;

/** One condition in any accepted spelling, as a long-form mapping. Null when it is not a condition. */
export function normalizeCondition(raw: unknown): HACondition | null {
  if (typeof raw === 'string') return { condition: 'template', value_template: raw };
  if (!isRecord(raw)) return null;

  if (raw.condition === undefined) {
    for (const key of GROUP_SHORTHAND_KEYS) {
      if (key in raw) {
        const { [key]: members, ...rest } = raw;
        return { ...rest, condition: key, conditions: normalizeConditionList(members) };
      }
    }
  }

  if (Array.isArray(raw.condition)) {
    const { condition: members, ...rest } = raw;
    return { ...rest, condition: 'and', conditions: normalizeConditionList(members) };
  }

  if (typeof raw.condition === 'string' && TEMPLATE_MARKER.test(raw.condition)) {
    const { condition: template, ...rest } = raw;
    return { ...rest, condition: 'template', value_template: template };
  }

  if (Array.isArray(raw.conditions)) {
    return { ...raw, conditions: normalizeConditionList(raw.conditions) };
  }
  return raw;
}

/** A list of conditions (or one condition, or nothing) as long-form mappings, order kept. */
export function normalizeConditionList(raw: unknown): HACondition[] {
  if (raw === undefined || raw === null) return [];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  return items.flatMap((item) => {
    const condition = normalizeCondition(item);
    return condition ? [condition] : [];
  });
}
