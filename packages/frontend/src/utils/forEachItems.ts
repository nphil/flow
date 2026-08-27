import { dump, load } from 'js-yaml';

/**
 * Helpers for editing `repeat.for_each` (design doc §6: "list textarea/YAML foldout").
 * for_each is parsed into a single opaque ActionNode (`data.repeat = { for_each, sequence }`)
 * rather than exploded into a subgraph like count/while/until — see packages/transpiler's
 * YamlParser.ts for-each branch. `sequence` (the loop body) has no canvas representation; it's
 * only reachable via the node's own per-node YAML foldout, which dumps the whole `repeat` block
 * unchanged.
 */

/** True when a single item can't be represented as one line of plain YAML scalar text. */
function isComplexForEachItem(item: unknown): boolean {
  if (item !== null && typeof item === 'object') return true;
  if (typeof item === 'string' && item.includes('\n')) return true;
  return false;
}

/**
 * True when at least one item is a non-scalar (object/array) or a multi-line string. A
 * one-line-per-item textarea can't represent those safely, so the editor falls back to a YAML
 * block for the whole array once this is true.
 */
export function hasComplexForEachItems(items: unknown[]): boolean {
  return items.some(isComplexForEachItem);
}

/**
 * Renders scalar for_each items as one YAML scalar per line. Uses js-yaml's own scalar
 * formatting (not `String()`) so quoting stays correct for values that need it (e.g. a numeric-
 * looking string), matching ServiceDataFields' toYamlText convention elsewhere in this tree.
 */
export function forEachItemsToLines(items: unknown[]): string {
  return items.map((item) => dump(item).trim()).join('\n');
}

/**
 * Parses the one-item-per-line textarea back into an array. Each line is decoded as a YAML
 * scalar ("42" -> 42, "true" -> true) so round-tripping preserves the original type; a line that
 * fails to parse (rare for single-line scalars) falls back to its raw text rather than throwing.
 * Blank lines are dropped (visual spacing, not an empty-string item — an actual empty-string
 * item round-trips as the two-character line `''`).
 */
export function linesToForEachItems(text: string): unknown[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return load(line);
      } catch {
        return line;
      }
    });
}

/** Dumps the full for_each array as one YAML document, for the complex-items foldout. */
export function forEachItemsToYaml(items: unknown[]): string {
  try {
    return dump(items).trimEnd();
  } catch {
    return '';
  }
}

/**
 * Parses the complex-items YAML foldout back into an array. Returns `null` — never an empty
 * array — when the text doesn't currently parse to a usable array, so the caller can leave the
 * last good value in place instead of clobbering an in-progress edit; mirrors PropertyEditor's
 * "invalid JSON, don't update" convention for array-shaped properties.
 */
export function parseForEachYaml(text: string): unknown[] | null {
  try {
    const parsed = load(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed === undefined) return [];
    return null;
  } catch {
    return null;
  }
}
