import type { HACondition } from '@flow/shared';
import { isRecord } from './values';

/** A condition inside a condition node: the node's own, or one nested in an and/or/not group. */
export interface ConditionRef {
  /** Indexes through `conditions` arrays from the node's own condition; empty for that one. */
  path: number[];
  condition: HACondition;
}

/** The members of an and/or/not group. Node data is user-editable, so anything odd counts as none. */
function groupMembers(condition: HACondition): HACondition[] {
  return Array.isArray(condition.conditions) ? condition.conditions : [];
}

/** The condition itself plus every condition nested in it, parents before children. */
export function listConditions(root: HACondition, path: number[] = []): ConditionRef[] {
  const nested = groupMembers(root).flatMap((child, index) =>
    isRecord(child) ? listConditions(child, [...path, index]) : []
  );
  return [{ path, condition: root }, ...nested];
}

/**
 * Returns `root` with the condition at `path` replaced by `update(condition)`; everything else is
 * shared with the original. A path that no longer leads anywhere returns `root` unchanged.
 */
export function updateConditionAt(
  root: HACondition,
  path: readonly number[],
  update: (condition: HACondition) => HACondition
): HACondition {
  const [index, ...rest] = path;
  if (index === undefined) return update(root);

  const members = groupMembers(root);
  const child = members[index];
  if (!isRecord(child)) return root;

  const nextChild = updateConditionAt(child, rest, update);
  if (nextChild === child) return root;
  return { ...root, conditions: members.map((member, i) => (i === index ? nextChild : member)) };
}
