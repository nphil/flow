import type { ConditionNode, HACondition } from '@flow/shared';
import { HAConditionSchema } from '@flow/shared';

/** A condition inside an `and` / `or` / `not` group, in the shape the graph stores it. */
export type NestedCondition = NonNullable<ConditionNode['data']['conditions']>[number];

/**
 * Transform an array of Home Assistant conditions to internal format
 */
export function transformConditions(conditions: HACondition[]): NestedCondition[] {
  return conditions.map((c) => transformToNestedCondition(c));
}

/**
 * Transform Home Assistant condition format to internal nested condition format
 * HA uses 'condition' field, internal schema uses 'condition'
 * Recursively handles nested conditions for and/or/not
 */
export function transformToNestedCondition(condition: HACondition): NestedCondition {
  // Use spread pattern to preserve unknown properties from custom integrations
  const { condition: conditionField, conditions, ...rest } = condition;
  const conditionType = conditionField || 'template';

  // Recursively transform nested conditions if present
  const nestedConditions = Array.isArray(conditions) ? transformConditions(conditions) : undefined;

  return {
    ...rest, // Preserve extra properties (including weekday, after, before, etc.)
    condition: conditionType,
    // This sub-condition is never overwritten by an enclosing step's alias
    // (only a top-level ConditionNode's `alias` is), so its own `alias` is
    // already unambiguous. Mirror it into `conditionAlias` too so the
    // generator's single "alias comes from conditionAlias" rule applies
    // uniformly at every nesting depth without special-casing.
    conditionAlias: typeof rest.alias === 'string' ? rest.alias : undefined,
    conditions: nestedConditions,
  };
}

/**
 * The `data` of a condition node: the condition as written (validated), with the members of a
 * group keeping their own alias. A condition the schema rejects becomes a template condition that
 * says so (and a warning), so one odd condition never stops an automation from opening.
 */
export function conditionNodeData(
  condition: HACondition,
  warnings: string[],
  label: string
): ConditionNode['data'] {
  const result = HAConditionSchema.safeParse(condition);
  if (!result.success) {
    warnings.push(`${label} failed schema validation: ${JSON.stringify(result.error.issues)}`);
    return {
      condition: 'template',
      alias: 'Unknown Condition',
      value_template: JSON.stringify(condition),
    };
  }
  const members = result.data.conditions;
  return Array.isArray(members)
    ? { ...result.data, conditions: transformConditions(members) }
    : result.data;
}
