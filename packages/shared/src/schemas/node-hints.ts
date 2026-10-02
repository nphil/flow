import { z } from 'zod';

/**
 * Node hints.
 *
 * A Home Assistant automation is a tree of nested steps; a Flow graph is flat. Several different
 * trees draw the SAME graph (a `choose` and an `if/else` ladder, a gate step and an `if` wrapping
 * the rest of the sequence, a guard followed by steps and an `if/else`, where a loop condition list
 * ends, ...). The parser therefore writes a few small facts into the `data` of the nodes it creates,
 * and the generator reads them to write the same tree back.
 *
 * Hints are LOCAL and are checked against the graph before they are used: a hint that no longer
 * fits the graph (the user rewired or copied a node) is ignored and the generator falls back to
 * working the structure out from the edges alone. They never reach the saved YAML and are never
 * shown as editable properties: this file is the one list of such keys.
 */

/** A `repeat` loop is spread over several nodes; each one says which part of the loop it is. */
export const LoopRoleSchema = z.enum(['while', 'until', 'count-init', 'count-step', 'count-check']);
export type LoopRole = z.infer<typeof LoopRoleSchema>;

/** The `enabled` of a block: `false`, or a template Home Assistant renders when the config loads. */
export const BlockEnabledSchema = z.union([z.literal(false), z.string()]);

/** What a `parallel` block carries that has no node of its own. */
export const ParallelBlockPropsSchema = z.object({
  alias: z.string().optional(),
  note: z.string().optional(),
  enabled: BlockEnabledSchema.optional(),
});
export type ParallelBlockProps = z.infer<typeof ParallelBlockPropsSchema>;

/**
 * How a node takes part in a `parallel` block, written on the FIRST node of each branch. A branch
 * that starts with another parallel block lists both, outermost first.
 */
export const ParallelBranchHintSchema = z.object({
  /** Position of the branch inside its block. */
  branch: z.number().int().nonnegative(),
  /** How many branches the block had. */
  count: z.number().int().positive(),
  /** The branch's own alias / note (a `{alias, note, sequence}` wrapper). */
  alias: z.string().optional(),
  note: z.string().optional(),
  /** The block's own alias / note / enabled; carried by branch 0 only. */
  block: ParallelBlockPropsSchema.optional(),
});
export type ParallelBranchHint = z.infer<typeof ParallelBranchHintSchema>;

/** One hint, tolerating a bad value: a malformed field is simply absent. */
function hint<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

export const NodeHintsSchema = z.object({
  /**
   * Nesting level of the YAML list the step sits in: -1 for the automation's own `conditions:`,
   * 0 for the top-level actions, one more inside every `then`, `else`, `default`, choose branch,
   * loop body and parallel branch. It tells a block's own steps from the steps that follow it.
   */
  stepDepth: hint(z.number().int()),
  /** An inline `- condition:` step: it ends the sequence it is in when it fails. */
  gateStep: hint(z.literal(true)),
  /** Position inside the condition list of an `if`, a choose branch, a `repeat.while/until`. */
  conditionIndex: hint(z.number().int().nonnegative()),
  /** On the first condition of each `choose` branch: the branch's position in the choose. */
  chooseBranch: hint(z.number().int().nonnegative()),
  loopRole: hint(LoopRoleSchema),
  /** On the `count-init` node: `repeat.count` exactly as written (a number or a template). */
  loopCount: hint(z.union([z.number(), z.string()])),
  parallelPath: hint(z.array(ParallelBranchHintSchema)),
  /** On the first node of a block (`if`, `choose`, `repeat`): the block's own `enabled`. */
  blockEnabled: hint(BlockEnabledSchema),
  /** The alias / note of an `if` step or of a `choose` branch, carried by its first condition. */
  stepAlias: hint(z.string()),
  stepNote: hint(z.string()),
  /** The alias / note of a `choose`, `repeat` or `parallel` step. */
  blockAlias: hint(z.string()),
  blockNote: hint(z.string()),
  /** A condition's own alias, kept apart from the alias the canvas shows for the node. */
  conditionAlias: hint(z.string()),
  /** The step was written `service:` rather than `action:`. */
  legacyServiceKey: hint(z.literal(true)),
  /** A step Flow cannot model, kept exactly as written and saved back unchanged. */
  verbatimStep: hint(z.unknown()),
});
export type NodeHints = z.infer<typeof NodeHintsSchema>;

/** Every `data` key that is a hint, not Home Assistant configuration. */
export const INTERNAL_NODE_KEYS: readonly string[] = Object.keys(NodeHintsSchema.shape);

/** The node's own data without the hint keys: what belongs in the YAML. */
export function stripInternalKeys<T extends Record<string, unknown>>(data: T): T {
  const copy = { ...data };
  for (const key of INTERNAL_NODE_KEYS) Reflect.deleteProperty(copy, key);
  return copy;
}

/** The hints a node carries; a malformed hint reads as absent. */
export function readNodeHints(data: Record<string, unknown>): NodeHints {
  return NodeHintsSchema.parse(
    Object.fromEntries(INTERNAL_NODE_KEYS.map((key) => [key, data[key]]))
  );
}
