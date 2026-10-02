import { z } from 'zod';
import { AutomationModeSchema, FlowKindSchema, MaxExceededSchema } from './base';
import { EdgeSchema } from './edges';
import { NodeSchema } from './nodes';

/**
 * Metadata for the flow graph
 */
export const FlowMetadataSchema = z.object({
  /**
   * Automation mode - controls behavior when triggered while running
   */
  mode: AutomationModeSchema.default('single'),
  /**
   * Behavior when max runs exceeded (for queued/parallel modes)
   */
  max_exceeded: MaxExceededSchema.optional(),
  /**
   * Maximum concurrent runs (for queued/parallel modes)
   */
  max: z.number().positive().optional(),
  /**
   * Initial state of the automation (enabled/disabled)
   */
  initial_state: z.boolean().optional(),
  /**
   * Hide from UI
   */
  hide_entity: z.boolean().optional(),
  /**
   * Trace configuration
   */
  trace: z
    .looseObject({
      stored_traces: z.number().optional(),
    })
    .optional(),
  /**
   * Script only: the icon shown for the script (`mdi:...`)
   */
  icon: z.string().optional(),
  /**
   * Script only: the inputs the script takes when it is called, as Home Assistant stores them
   * (per field: name, description, required, example, default, selector)
   */
  fields: z.record(z.string(), z.unknown()).optional(),
});
export type FlowMetadata = z.infer<typeof FlowMetadataSchema>;

/**
 * A config made from a blueprint. Home Assistant fills in the blueprint's own triggers, conditions
 * and actions from the inputs, so the config itself holds none of them. Flow shows it read-only and
 * writes it back exactly as it was read.
 */
export const BlueprintInstanceSchema = z.object({
  /**
   * `use_blueprint` as written: the blueprint's path and the values given for its inputs
   */
  use_blueprint: z.looseObject({
    path: z.string(),
    input: z.record(z.string(), z.unknown()).optional(),
  }),
  /**
   * Every other top-level key the instance sets (mode, trace, ...): they override the blueprint's
   * own, so they are kept verbatim
   */
  overrides: z.record(z.string(), z.unknown()).optional(),
});
export type BlueprintInstance = z.infer<typeof BlueprintInstanceSchema>;

/**
 * Workspace metadata for merged automations
 */
export const FlowWorkspaceSourceSchema = z.object({
  automation_id: z.string(),
  entity_id: z.string(),
  alias: z.string(),
  node_prefix: z.string(),
  imported_at: z.string(),
});
export type FlowWorkspaceSource = z.infer<typeof FlowWorkspaceSourceSchema>;

export const FlowWorkspaceSchema = z.object({
  mode: z.literal('merged'),
  sources: z.array(FlowWorkspaceSourceSchema),
});
export type FlowWorkspace = z.infer<typeof FlowWorkspaceSchema>;

/**
 * Complete flow graph schema
 * Represents the entire automation as a graph of nodes and edges
 */
export const FlowGraphSchema = z.object({
  /**
   * Unique identifier for this flow
   */
  id: z.string().uuid(),
  /**
   * Human-readable name (becomes the automation alias)
   */
  name: z.string().min(1),
  /**
   * Optional description
   */
  description: z.string().optional(),
  /**
   * What the flow is saved as: an automation (starts from triggers) or a script (starts when
   * called). Absent means automation, which is what every graph made before scripts is.
   */
  kind: FlowKindSchema.optional(),
  /**
   * Array of nodes (triggers, conditions, actions)
   */
  nodes: z.array(NodeSchema),
  /**
   * Array of edges connecting nodes
   */
  edges: z.array(EdgeSchema),
  /**
   * Optional metadata for automation configuration
   */
  metadata: FlowMetadataSchema.optional(),
  /**
   * Version for schema migrations
   */
  version: z.literal(1).default(1),
  /**
   * User-defined variables at the root level (preserved during round-trip)
   * These are variables defined in the automation's variables: section,
   * excluding _cafe_metadata which is handled separately.
   */
  userVariables: z.record(z.string(), z.unknown()).optional(),
  /**
   * User-defined trigger_variables at the root level (preserved during round-trip)
   */
  userTriggerVariables: z.record(z.string(), z.unknown()).optional(),
  /**
   * Workspace metadata for merged automations
   */
  workspace: FlowWorkspaceSchema.optional(),
  /**
   * Set when the config is made from a blueprint: the graph has no nodes and is read-only
   */
  blueprint: BlueprintInstanceSchema.optional(),
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

/**
 * Validate graph structure beyond schema validation
 * - All edge sources/targets must reference existing nodes
 * - Trigger nodes should have no incoming edges
 * - An automation must have at least one trigger node (unless it is made from a blueprint);
 *   a script must have none
 */
export function validateGraphStructure(graph: FlowGraph): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // Check for duplicate node IDs
  if (nodeIds.size !== graph.nodes.length) {
    errors.push('Duplicate node IDs detected');
  }

  // Check that all edge references are valid
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references non-existent source node: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references non-existent target node: ${edge.target}`);
    }
  }

  // An automation starts from its triggers (a blueprint instance brings its own); a script has none.
  const triggerNodes = graph.nodes.filter((n) => n.type === 'trigger');
  if (graph.kind === 'script') {
    if (triggerNodes.length > 0) {
      errors.push('A script has no triggers: it starts when it is called');
    }
  } else if (triggerNodes.length === 0 && graph.blueprint === undefined) {
    errors.push('Graph must have at least one trigger node');
  }

  // Check that trigger nodes have no incoming edges
  const nodesWithIncoming = new Set(graph.edges.map((e) => e.target));
  for (const trigger of triggerNodes) {
    if (nodesWithIncoming.has(trigger.id)) {
      errors.push(`Trigger node ${trigger.id} should not have incoming edges`);
    }
  }

  // Check condition node edges have valid handles
  const conditionNodes = new Set(
    graph.nodes.filter((n) => n.type === 'condition').map((n) => n.id)
  );
  for (const edge of graph.edges) {
    if (conditionNodes.has(edge.source)) {
      if (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
        errors.push(
          `Edge ${edge.id} from condition node must have sourceHandle 'true' or 'false', got: ${edge.sourceHandle}`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
