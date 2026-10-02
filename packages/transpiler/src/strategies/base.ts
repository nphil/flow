import type { FlowGraph } from '@flow/shared';
import type { TopologyAnalysis } from '../analyzer/topology';

/**
 * Output format from a transpiler strategy
 */
export interface HAYamlOutput {
  /**
   * Generated automation config (for native strategy)
   */
  automation?: Record<string, unknown>;
  /**
   * Generated script config (for state machine strategy)
   */
  script?: Record<string, unknown>;
  /**
   * Warnings generated during transpilation
   */
  warnings: string[];
  /**
   * The strategy used for transpilation
   */
  strategy: string;
  /**
   * True when some node the triggers lead to has no step in the output: the strategy could not
   * express this graph, and the caller should use a more general one.
   */
  incomplete?: boolean;
  /**
   * The node ids in the order the strategy wrote them out, when that is the order the parser meets
   * them again (nested steps). Canvas positions are saved in this order.
   */
  nodeOrder?: string[];
}

/**
 * Base interface for transpiler strategies
 */
export interface TranspilerStrategy {
  /**
   * Unique name for this strategy
   */
  readonly name: string;

  /**
   * Description of when this strategy should be used
   */
  readonly description: string;

  /**
   * Check if this strategy can handle the given topology
   */
  canHandle(analysis: TopologyAnalysis): boolean;

  /**
   * Generate Home Assistant YAML from a flow graph
   */
  generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput;
}

/**
 * Base class with common utility methods for strategies
 */
export abstract class BaseStrategy implements TranspilerStrategy {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract canHandle(analysis: TopologyAnalysis): boolean;
  abstract generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput;

  /**
   * Find the entry node(s) of a flow
   */
  protected findEntryNodes(flow: FlowGraph): string[] {
    const targetNodes = new Set(flow.edges.map((e) => e.target));
    return flow.nodes.filter((n) => !targetNodes.has(n.id)).map((n) => n.id);
  }

  /**
   * The settings an automation carries after its steps (mode, run limits, startup state, trace,
   * trigger variables). Only what is set is written.
   */
  protected automationSettings(flow: FlowGraph): Record<string, unknown> {
    const { metadata } = flow;
    const settings: Record<string, unknown> = { mode: metadata?.mode ?? 'single' };
    if (metadata?.max) settings.max = metadata.max;
    if (metadata?.max_exceeded) settings.max_exceeded = metadata.max_exceeded;
    if (typeof metadata?.initial_state === 'boolean')
      settings.initial_state = metadata.initial_state;
    if (typeof metadata?.hide_entity === 'boolean') settings.hide_entity = metadata.hide_entity;
    if (metadata?.trace) settings.trace = metadata.trace;
    if (flow.userTriggerVariables && Object.keys(flow.userTriggerVariables).length > 0) {
      settings.trigger_variables = flow.userTriggerVariables;
    }
    return settings;
  }

  /**
   * Everything a script says before its steps: name, description, icon, mode, run limits, trace and
   * the inputs it takes. Only what is set is written (a script without a description gets none).
   */
  protected scriptSettings(flow: FlowGraph): Record<string, unknown> {
    const { metadata } = flow;
    const settings: Record<string, unknown> = { alias: flow.name };
    if (flow.description) settings.description = flow.description;
    if (metadata?.icon) settings.icon = metadata.icon;
    settings.mode = metadata?.mode ?? 'single';
    if (metadata?.max) settings.max = metadata.max;
    if (metadata?.max_exceeded) settings.max_exceeded = metadata.max_exceeded;
    if (metadata?.trace) settings.trace = metadata.trace;
    if (metadata?.fields) settings.fields = metadata.fields;
    return settings;
  }

  /**
   * Get outgoing edges from a node
   */
  protected getOutgoingEdges(flow: FlowGraph, nodeId: string) {
    return flow.edges.filter((e) => e.source === nodeId);
  }

  /**
   * Get incoming edges to a node
   */
  protected getIncomingEdges(flow: FlowGraph, nodeId: string) {
    return flow.edges.filter((e) => e.target === nodeId);
  }

  /**
   * Get a node by ID
   */
  protected getNode(flow: FlowGraph, nodeId: string) {
    return flow.nodes.find((n) => n.id === nodeId);
  }
}
