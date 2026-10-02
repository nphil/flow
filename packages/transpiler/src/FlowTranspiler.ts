import {
  type BlueprintInstance,
  type FlowGraph,
  INTERNAL_NODE_KEYS,
  isRecord,
} from '@flow/shared';
import { dump as yamlDump } from 'js-yaml';
import { analyzeTopology, type TopologyAnalysis } from './analyzer/topology';
import { type ValidationResult, validateFlowGraph } from './analyzer/validator';
import { type ParseOptions, type ParseResult, YamlParser } from './parser/YamlParser';
import type { HAYamlOutput, TranspilerStrategy } from './strategies/base';
import { NativeStrategy } from './strategies/native';
import { StateMachineStrategy } from './strategies/state-machine';

/**
 * Options for YAML generation
 */
export interface YamlOptions {
  /**
   * Indentation level (default: 2)
   */
  indent?: number;
  /**
   * Line width for wrapping (-1 for no wrapping)
   */
  lineWidth?: number;
  /**
   * Force a specific strategy instead of auto-selecting
   */
  forceStrategy?: 'native' | 'state-machine';
}

/**
 * Result of transpilation
 */
export interface TranspileResult {
  /**
   * Whether transpilation succeeded
   */
  success: boolean;
  /**
   * Generated YAML string
   */
  yaml?: string;
  /**
   * The complete config to store in Home Assistant: what the strategy generated plus the user's
   * own `variables` and Flow's canvas layout (`_cafe_metadata`). Store this, not `output`.
   */
  config?: Record<string, unknown>;
  /**
   * What the strategy generated (the automation or script config before variables are added)
   */
  output?: HAYamlOutput;
  /**
   * Topology analysis results
   */
  analysis?: TopologyAnalysis;
  /**
   * Validation errors (if any)
   */
  errors?: string[];
  /**
   * Warnings from transpilation
   */
  warnings: string[];
}

/** The graph without the parser's node hints, for a strategy that does not read them. */
function withoutHints(flow: FlowGraph): FlowGraph {
  const copy = structuredClone(flow);
  for (const node of copy.nodes) {
    for (const key of INTERNAL_NODE_KEYS) Reflect.deleteProperty(node.data, key);
  }
  return copy;
}

/**
 * A config made from a blueprint, as it was read: name, description, `use_blueprint`, and whatever
 * else the instance sets (those keys override the blueprint's own, so they stay).
 */
function blueprintConfig(flow: FlowGraph, blueprint: BlueprintInstance): Record<string, unknown> {
  return {
    alias: flow.name,
    ...(flow.description ? { description: flow.description } : {}),
    use_blueprint: blueprint.use_blueprint,
    ...blueprint.overrides,
  };
}

/**
 * Main transpiler class for converting React Flow graphs to Home Assistant YAML
 */
export class FlowTranspiler {
  private strategies: TranspilerStrategy[] = [new NativeStrategy(), new StateMachineStrategy()];

  /**
   * Validate a flow graph input
   */
  validate(input: unknown): ValidationResult {
    return validateFlowGraph(input);
  }

  /**
   * Analyze the topology of a validated flow graph
   */
  analyzeTopology(flow: FlowGraph): TopologyAnalysis {
    return analyzeTopology(flow);
  }

  /**
   * Transpile a flow graph to Home Assistant YAML
   */
  transpile(input: unknown, options: YamlOptions = {}): TranspileResult {
    const warnings: string[] = [];

    // Step 1: Validate the input
    const validation = this.validate(input);
    if (!validation.success || !validation.graph) {
      return {
        success: false,
        errors: validation.errors.map((e) => e.message),
        warnings,
      };
    }

    const flow = validation.graph;

    // Step 2: Analyze topology
    const analysis = this.analyzeTopology(flow);

    // Step 3: Select strategy
    let strategy: TranspilerStrategy;

    if (options.forceStrategy) {
      const forced = this.strategies.find((s) => s.name === options.forceStrategy);
      if (!forced) {
        return {
          success: false,
          errors: [`Unknown strategy: ${options.forceStrategy}`],
          warnings,
        };
      }
      strategy = forced;

      if (!strategy.canHandle(analysis)) {
        warnings.push(
          `Strategy "${strategy.name}" may not be optimal for this flow topology. ` +
            `Recommended: ${analysis.recommendedStrategy}`
        );
      }
    } else {
      // Auto-select based on topology
      const suitable = this.strategies.find((s) => s.canHandle(analysis));
      if (!suitable) {
        // Fall back to state-machine which handles everything
        strategy = new StateMachineStrategy();
      } else {
        strategy = suitable;
      }
    }

    // A config made from a blueprint holds none of the steps: it is written back as it was read.
    if (flow.blueprint) {
      const config = blueprintConfig(flow, flow.blueprint);
      const output: HAYamlOutput = {
        ...(flow.kind === 'script' ? { script: config } : { automation: config }),
        warnings,
        strategy: 'native',
      };
      return { success: true, yaml: this.dump(config, options), config, output, warnings };
    }

    // Step 4: Generate YAML output. A native build that could not place every node (a graph that
    // is not nested after all) is redone by the general strategy.
    let output = strategy.generate(flow, analysis);
    if (output.incomplete && !options.forceStrategy) {
      strategy = new StateMachineStrategy();
    }
    if (strategy instanceof StateMachineStrategy) {
      output = strategy.generate(withoutHints(flow), analysis);
    }
    warnings.push(...output.warnings);

    // Step 5: Add the user's variables and the node positions (_cafe_metadata)
    const generated = output.automation ?? output.script;
    if (!generated) {
      return { success: false, errors: ['The strategy generated no config'], warnings };
    }
    const config = this.withVariables(flow, strategy, generated, output.nodeOrder);

    // Step 6: Serialize to YAML string with metadata
    return {
      success: true,
      yaml: this.dump(config, options),
      config,
      output,
      analysis,
      warnings,
    };
  }

  /**
   * Transpile to YAML string directly
   */
  toYaml(input: unknown, options: YamlOptions = {}): string {
    const result = this.transpile(input, options);

    if (!result.success) {
      throw new Error(`Transpilation failed: ${result.errors?.join(', ')}`);
    }

    return result.yaml!;
  }

  /**
   * Force native strategy (for tree-shaped flows)
   */
  toNativeYaml(input: unknown, options: YamlOptions = {}): string {
    return this.toYaml(input, { ...options, forceStrategy: 'native' });
  }

  /**
   * Force state machine strategy (for complex flows)
   */
  toStateMachineYaml(input: unknown, options: YamlOptions = {}): string {
    return this.toYaml(input, { ...options, forceStrategy: 'state-machine' });
  }

  /**
   * Parse Home Assistant YAML back into FlowGraph. Say what it is (`options.kind`) when you know:
   * the shape alone cannot tell a script made from a blueprint from an automation made from one.
   */
  fromYaml(yamlString: string, options: ParseOptions = {}): Promise<ParseResult> {
    const parser = new YamlParser();
    return parser.parse(yamlString, options);
  }

  /**
   * Get available strategies
   */
  getStrategies(): Array<{ name: string; description: string }> {
    return this.strategies.map((s) => ({
      name: s.name,
      description: s.description,
    }));
  }

  /**
   * Add a custom strategy
   */
  addStrategy(strategy: TranspilerStrategy): void {
    this.strategies.unshift(strategy); // Add at beginning for priority
  }

  private dump(config: Record<string, unknown>, options: YamlOptions): string {
    return yamlDump(config, {
      indent: options.indent ?? 2,
      lineWidth: options.lineWidth ?? -1,
      quotingType: '"',
      forceQuotes: false,
    });
  }

  /**
   * The generated config with the user's own variables and the canvas layout (`_cafe_metadata`).
   * A script sets its variables before its steps run, so they are written above the sequence.
   */
  private withVariables(
    flow: FlowGraph,
    strategy: TranspilerStrategy,
    generated: Record<string, unknown>,
    nodeOrder: string[] = []
  ): Record<string, unknown> {
    const variables = {
      // First, include user-defined variables from the flow graph
      ...(flow.userVariables || {}),
      // Then include any variables from the generated YAML (e.g., state machine vars)
      ...(isRecord(generated.variables) ? generated.variables : {}),
      // Finally, add _cafe_metadata
      _cafe_metadata: this.generateCafeMetadata(flow, strategy, nodeOrder),
    };
    if (flow.kind !== 'script') return { ...generated, variables };
    const { sequence, ...head } = generated;
    return { ...head, variables, sequence };
  }

  /**
   * Generate C.A.F.E. metadata for position persistence
   *
   * Note: We only store node positions in metadata. Node data and edges are already
   * encoded in the YAML structure itself:
   * - Node data is in each choose block's sequence
   * - Edges are in the variables transitions (current_node assignments)
   * - Node IDs are in the choose block conditions
   */
  private generateCafeMetadata(
    flow: FlowGraph,
    strategy: TranspilerStrategy,
    nodeOrder: string[]
  ): Record<string, unknown> {
    const nodePositions: Record<string, { x: number; y: number }> = {};

    // Write positions in the order the strategy wrote the nodes into the YAML, which is the order
    // YamlParser re-assigns IDs to nodes in on import, not `flow.nodes` array order — otherwise
    // positions get attached to the wrong node once a flow has multiple same-type nodes across
    // parallel/condition branches (cafe-hass#225). A node the strategy did not report (the state
    // machine keeps its ids in the YAML itself) follows in `flow.nodes` order.
    const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
    for (const nodeId of new Set([...nodeOrder, ...nodesById.keys()])) {
      const node = nodesById.get(nodeId);
      if (!node) continue;
      nodePositions[node.id] = {
        x: node.position.x,
        y: node.position.y,
      };
    }

    return {
      version: 1,
      nodes: nodePositions,
      graph_id: flow.id,
      graph_version: flow.version,
      strategy: strategy.name,
    };
  }
}

// Export singleton instance
export const transpiler = new FlowTranspiler();
