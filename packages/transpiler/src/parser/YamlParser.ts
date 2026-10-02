import type {
  ActionNode,
  BlueprintInstance,
  CafeMetadata,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowGraph,
  FlowKind,
  FlowNode,
  TriggerNode,
  WaitNode,
} from '@flow/shared';
import {
  BlueprintInstanceSchema,
  CafeMetadataSchema,
  detectFlowKind,
  FlowGraphSchema,
  FlowMetadataSchema,
  HAConditionSchema,
  HATriggerSchema,
  isHACondition,
  isRecord,
  validateGraphStructure,
} from '@flow/shared';
import { load as yamlLoad } from 'js-yaml';
import { generateGraphId, generateNodeId } from '../utils/generateIds';
import { PathRecorder, type TracePathMap } from '../utils/tracePathMap';
import { transformConditions } from './condition-nodes';
import { normalizeConditionList } from './conditions';
import { applyHeuristicLayout } from './layout';
import { createEdge, type Exit, StepParser } from './steps';

/**
 * Matches the synthetic node id the state-machine strategy generates for a
 * trigger with multiple targets (see `generateParallelEntryBlocks`). These
 * ids never correspond to a real canvas node — they get expanded into the
 * real target nodes and removed from the node map before nodes are built.
 */
const PARALLEL_TRIGGER_ID_PATTERN = /^__parallel_trigger_\d+$/;

/**
 * Information about a node parsed from a state-machine choose block or inline parallel branch
 */
interface StateMachineNodeInfo {
  nodeId: string;
  nodeType: 'action' | 'condition' | 'delay' | 'wait';
  data: Record<string, unknown>;
  trueTarget: string | null;
  falseTarget: string | null;
  parallelItems?: unknown[];
  /** Index within the choose block's `sequence` array where `parallelItems` was found. */
  parallelItemsIndex?: number;
}

/**
 * Result of parsing YAML
 */
export interface ParseResult {
  success: boolean;
  graph?: FlowGraph;
  errors?: string[];
  warnings: string[];
  hadMetadata: boolean;
  /** Home Assistant trace path <-> canvas node id map. Present when `success` is true. */
  nodePathMap?: TracePathMap;
}

/**
 * Edge ids are made of the two node ids and a timestamp, so two edges between the same pair of
 * nodes (a condition that leaves through both handles to the same step) would share one. React
 * Flow needs every id to be unique.
 */
function makeEdgeIdsUnique(edges: FlowEdge[]): void {
  const seen: Record<string, number> = {};
  for (const edge of edges) {
    const count = seen[edge.id] ?? 0;
    seen[edge.id] = count + 1;
    if (count > 0) edge.id = `${edge.id}-${count}`;
  }
}

/**
 * The automation-level settings (mode, max, max_exceeded, initial_state, ...). One unusable key
 * must not wipe the others: a failed whole-object parse used to fall back to the defaults, which
 * silently turned a `queued` automation into `single` and dropped its `max`.
 */
function parseMetadataBlock(raw: Record<string, unknown>) {
  const whole = FlowMetadataSchema.safeParse(raw);
  if (whole.success) return whole.data;

  const singleKey = FlowMetadataSchema.partial();
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const one = singleKey.safeParse({ [key]: value });
    if (!one.success) continue;
    for (const [parsedKey, parsedValue] of Object.entries(one.data)) {
      if (parsedKey === key) kept[key] = parsedValue;
    }
  }
  return FlowMetadataSchema.parse(kept);
}

/**
 * Home Assistant lets a trigger list nest: an entry that holds only `triggers: [...]` is merged
 * into the main list. Flow shows (and saves) the flat list.
 */
function flattenTriggerList(items: unknown[]): unknown[] {
  return items.flatMap((item) =>
    isRecord(item) && Object.keys(item).length === 1 && Array.isArray(item.triggers)
      ? flattenTriggerList(item.triggers)
      : [item]
  );
}

/** The node types Flow numbers: `_cafe_metadata` lists the ids it saved, each prefixed by its type. */
const KNOWN_NODE_TYPES = ['set_variables', 'trigger', 'condition', 'action', 'delay', 'wait'];

/**
 * Hands out the node ids of a config that is being opened. The ids saved in `_cafe_metadata` come
 * first so every node gets its canvas position back: matched by node type (depth-first parsing
 * meets nodes of different types in another order than they were saved), then in saved order,
 * and new ids once those run out.
 */
function createNodeIdAllocator(metadataNodeIds: string[]): (type: string) => string {
  const metadataIdsByType = new Map<string, string[]>();
  const usedMetadataIds = new Set<string>();
  for (const id of metadataNodeIds) {
    const matchedType = KNOWN_NODE_TYPES.find((t) => id.startsWith(`${t}_`));
    if (matchedType) {
      if (!metadataIdsByType.has(matchedType)) metadataIdsByType.set(matchedType, []);
      metadataIdsByType.get(matchedType)?.push(id);
    }
  }
  const metadataTypeIndexes = new Map<string, number>();
  let sequentialFallbackIndex = 0;
  let nodeIdCounter = metadataNodeIds.length;

  return (type) => {
    // First: try type-matched metadata ID
    const ids = metadataIdsByType.get(type);
    const idx = metadataTypeIndexes.get(type) ?? 0;
    if (ids && idx < ids.length) {
      const id = ids[idx];
      metadataTypeIndexes.set(type, idx + 1);
      usedMetadataIds.add(id);
      return id;
    }
    // Second: fallback to next unused metadata ID (handles non-standard ID formats)
    while (sequentialFallbackIndex < metadataNodeIds.length) {
      const id = metadataNodeIds[sequentialFallbackIndex++];
      if (!usedMetadataIds.has(id)) {
        usedMetadataIds.add(id);
        return id;
      }
    }
    // Third: generate a new ID
    return generateNodeId(type, nodeIdCounter++);
  };
}

/** Keys a blueprint instance shares with every config; they are not overrides of the blueprint. */
const BLUEPRINT_OWN_KEYS: Record<string, true> = {
  id: true,
  alias: true,
  description: true,
  use_blueprint: true,
};

/**
 * The blueprint a config is made from, or undefined for a config that holds its own steps. Home
 * Assistant builds the triggers, conditions and actions from the blueprint and the inputs, so such
 * a config has none; whatever else it sets (mode, trace, ...) overrides the blueprint's own.
 */
function readBlueprintInstance(content: Record<string, unknown>): BlueprintInstance | undefined {
  const useBlueprint = BlueprintInstanceSchema.shape.use_blueprint.safeParse(content.use_blueprint);
  if (!useBlueprint.success) return undefined;
  const overrides = Object.fromEntries(
    Object.entries(content).filter(([key]) => !Object.hasOwn(BLUEPRINT_OWN_KEYS, key))
  );
  return {
    use_blueprint: useBlueprint.data,
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
  };
}

/** What the caller knows about the config it hands to `parse`. */
export interface ParseOptions {
  /**
   * What the config is saved as. Without it the shape decides (see `detectFlowKind`), which cannot
   * tell a script made from a blueprint from an automation made from one: say so when you know.
   */
  kind?: FlowKind;
}

/** The nodes and edges a config's steps make. */
interface StructureResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Where a config keeps its steps: a script's `sequence`, an automation's `actions` (or `action`). */
function stepListOf(content: Record<string, unknown>, kind: FlowKind): unknown {
  return kind === 'script' ? content.sequence : content.actions || content.action;
}

/**
 * The trace path Home Assistant gives the step list (`sequence/0`, `action/0`). Every path the
 * parser records starts with it, so the trace viewer finds the node a trace step belongs to.
 */
function stepsPathOf(kind: FlowKind): string {
  return kind === 'script' ? 'sequence' : 'action';
}

/**
 * Parser for converting Home Assistant YAML back to FlowGraph
 */
export class YamlParser {
  /**
   * Parse Home Assistant YAML string into FlowGraph
   */
  async parse(yamlString: string, options: ParseOptions = {}): Promise<ParseResult> {
    const warnings: string[] = [];
    const recorder = new PathRecorder();

    try {
      // Step 1: Parse YAML string
      let parsed = yamlLoad(yamlString) as Record<string, unknown> | unknown[];

      // Handle array format (list of automations) - use the first one
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          return {
            success: false,
            errors: ['Empty automation array'],
            warnings,
            hadMetadata: false,
          };
        }
        parsed = parsed[0] as Record<string, unknown>;
      }

      if (!parsed || typeof parsed !== 'object') {
        return {
          success: false,
          errors: ['Invalid YAML structure'],
          warnings,
          hadMetadata: false,
        };
      }

      // Step 2: Extract C.A.F.E. metadata if present
      const metadata = this.extractMetadata(parsed);
      const hadMetadata = metadata !== null;

      // Step 2b: Extract user-defined variables (excluding _cafe_metadata)
      const userVariables = this.extractUserVariables(parsed);

      // Step 3: What the config is saved as, and whether it is made from a blueprint
      const content = parsed;
      // Defensive: ensure content is Record<string, unknown>
      if (typeof content !== 'object' || content === null) {
        return {
          success: false,
          errors: ['Invalid YAML content structure'],
          warnings,
          hadMetadata,
        };
      }
      const kind = options.kind ?? detectFlowKind(content);
      const blueprint = readBlueprintInstance(content);

      // Step 4: Extract node IDs from metadata if available
      const metadataNodeIds = metadata ? Object.keys(metadata.nodes) : [];

      // Step 5-6: Parse nodes and edges from YAML structure (a blueprint instance has none)
      const { nodes, edges } =
        blueprint === undefined
          ? this.parseStructure(content, kind, warnings, metadataNodeIds, recorder, metadata)
          : { nodes: [], edges: [] };
      makeEdgeIdsUnique(edges);

      // Step 7: Apply positions from metadata or generate heuristic layout
      let nodesWithPositions: FlowNode[];
      if (hadMetadata && metadata) {
        nodesWithPositions = this.applyMetadataPositions(nodes, metadata);
      } else {
        // Use async heuristic layout if metadata is missing
        nodesWithPositions = await applyHeuristicLayout(nodes, edges);
      }

      // Step 8: Build FlowGraph object
      // Validate and parse metadata block using FlowMetadataSchema
      const rawMetadata =
        kind === 'script'
          ? {
              mode: content.mode,
              max: content.max,
              max_exceeded: content.max_exceeded,
              trace: content.trace,
              icon: content.icon,
              fields: content.fields,
            }
          : {
              mode: content.mode,
              max: content.max,
              max_exceeded: content.max_exceeded,
              initial_state: content.initial_state,
              hide_entity: content.hide_entity,
              trace: content.trace,
            };
      const metadataBlock = parseMetadataBlock(rawMetadata);

      const userTriggerVariables =
        kind === 'automation' &&
        typeof content.trigger_variables === 'object' &&
        content.trigger_variables !== null &&
        !Array.isArray(content.trigger_variables)
          ? (content.trigger_variables as Record<string, unknown>)
          : undefined;

      // A blueprint instance keeps every other key verbatim (see readBlueprintInstance), `variables`
      // included: none of it is a user variable of ours.
      const keepsUserVariables = blueprint === undefined && Object.keys(userVariables).length > 0;

      const graph: FlowGraph = {
        id: metadata?.graph_id || generateGraphId(),
        name:
          typeof content.alias === 'string'
            ? content.alias
            : kind === 'script'
              ? 'Imported Script'
              : 'Imported Automation',
        description: typeof content.description === 'string' ? content.description : '',
        nodes: nodesWithPositions,
        edges,
        metadata: metadataBlock,
        version: 1 as const,
        kind,
        blueprint,
        // Preserve user-defined variables for round-trip
        userVariables: keepsUserVariables ? userVariables : undefined,
        userTriggerVariables:
          userTriggerVariables && Object.keys(userTriggerVariables).length > 0
            ? userTriggerVariables
            : undefined,
      };

      // Safety net: an edge leaving a condition node without a boolean handle
      // would fail structure validation below and block the automation from
      // opening at all. Never hard-fail on this: label the edge (preferring
      // the vacant handle) and surface a warning instead.
      {
        const conditionIds = new Set(
          graph.nodes.filter((n) => n.type === 'condition').map((n) => n.id)
        );
        for (const edge of graph.edges) {
          if (!conditionIds.has(edge.source)) continue;
          if (edge.sourceHandle === 'true' || edge.sourceHandle === 'false') continue;
          const siblings = graph.edges.filter((e) => e.source === edge.source && e !== edge);
          const hasTrue = siblings.some((e) => e.sourceHandle === 'true');
          const hasFalse = siblings.some((e) => e.sourceHandle === 'false');
          edge.sourceHandle = hasTrue && !hasFalse ? 'false' : 'true';
          warnings.push(
            `Edge from condition node ${edge.source} had no true/false handle; assumed '${edge.sourceHandle}'.`
          );
        }
      }

      // Step 7: Validate with Zod schema
      const validation = FlowGraphSchema.safeParse(graph);

      if (!validation.success) {
        // Enhanced error logging: show node data and schema path
        // Zod v4 uses 'issues' instead of 'errors'
        const errorDetails = validation.error.issues.map((e) => {
          let nodeInfo = '';
          if (e.path && e.path.length > 0) {
            // Try to extract node id/type if error is in nodes array
            if (e.path[0] === 'nodes' && typeof e.path[1] === 'number') {
              const idx = e.path[1];
              const node = graph.nodes[idx];
              nodeInfo = `Node index ${idx} (id: ${node?.id}, type: ${
                node?.type
              })\nData: ${JSON.stringify(node?.data, null, 2)}`;
            }
          }
          return `Schema path: ${e.path.join('.')}\nMessage: ${e.message}${
            nodeInfo ? `\n${nodeInfo}` : ''
          }`;
        });
        // Also log to console for debugging
        console.error('Zod validation error details:', errorDetails);
        return {
          success: false,
          errors: errorDetails,
          warnings,
          hadMetadata,
        };
      }

      // Step 8: Validate graph structure (triggers, edges, etc.)
      const structureValidation = validateGraphStructure(validation.data);

      if (!structureValidation.valid) {
        return {
          success: false,
          errors: structureValidation.errors,
          warnings,
          hadMetadata,
        };
      }

      return {
        success: true,
        graph: validation.data,
        warnings,
        hadMetadata,
        nodePathMap: recorder.toTracePathMap(),
      };
    } catch (error) {
      // Enhanced catch block: log YAML and error
      console.error('YAML parsing error:', error);
      console.error('YAML string:', yamlString);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown parsing error'],
        warnings,
        hadMetadata: false,
      };
    }
  }

  /**
   * Extract C.A.F.E. metadata from variables section
   */
  /**
   * Extract and validate C.A.F.E. metadata from variables section using Zod schema.
   * Returns CafeMetadata if valid, otherwise null.
   */
  private extractMetadata(parsed: Record<string, unknown>): CafeMetadata | null {
    try {
      let variables: unknown;
      if (typeof parsed.variables === 'object' && parsed.variables !== null) {
        variables = parsed.variables;
      }
      if (
        variables &&
        typeof variables === 'object' &&
        '_cafe_metadata' in variables &&
        typeof (variables as Record<string, unknown>)._cafe_metadata === 'object' &&
        (variables as Record<string, unknown>)._cafe_metadata !== null
      ) {
        const metadata = (variables as Record<string, unknown>)._cafe_metadata;
        const result = CafeMetadataSchema.safeParse(metadata);
        if (result.success) {
          return result.data;
        }
      }
    } catch {
      // Metadata not present or malformed
    }
    return null;
  }

  /**
   * Extract user-defined variables from the root variables section.
   * Excludes _cafe_metadata which is handled separately.
   */
  private extractUserVariables(parsed: Record<string, unknown>): Record<string, unknown> {
    const userVariables: Record<string, unknown> = {};

    if (typeof parsed.variables === 'object' && parsed.variables !== null) {
      const variables = parsed.variables as Record<string, unknown>;
      for (const [key, value] of Object.entries(variables)) {
        // Skip _cafe_metadata - it's handled separately
        if (key !== '_cafe_metadata') {
          userVariables[key] = value;
        }
      }
    }

    return userVariables;
  }

  /**
   * Detect if a flow is in state-machine format
   * State-machine format has:
   * - A variables action with current_node and flow_context
   * - A repeat loop with choose blocks
   */
  private detectStateMachineFormat(content: Record<string, unknown>, kind: FlowKind): boolean {
    const actions = stepListOf(content, kind);
    if (!Array.isArray(actions)) return false;

    let hasCurrentNodeVar = false;
    let hasRepeatChoose = false;

    for (const action of actions) {
      const actionObj = action as Record<string, unknown>;

      // Check for variables with current_node
      if (actionObj.variables) {
        const vars = actionObj.variables as Record<string, unknown>;
        if ('current_node' in vars && 'flow_context' in vars) {
          hasCurrentNodeVar = true;
        }
      }

      // Check for repeat with choose
      if (actionObj.repeat) {
        const repeat = actionObj.repeat as Record<string, unknown>;
        const sequence = repeat.sequence as unknown[];
        if (Array.isArray(sequence)) {
          for (const seqItem of sequence) {
            const seqObj = seqItem as Record<string, unknown>;
            if (Array.isArray(seqObj.choose)) {
              hasRepeatChoose = true;
              break;
            }
          }
        }
      }
    }

    return hasCurrentNodeVar && hasRepeatChoose;
  }

  /**
   * Parse state-machine format flow into nodes and edges
   *
   * State-machine format structure:
   * - Triggers are parsed normally (a script has none)
   * - Actions contain: variables (current_node init) + repeat/choose blocks
   * - Each choose block represents a node:
   *   - condition: {{ current_node == "node-id" }}
   *   - sequence: [node action, variables: { current_node: "next-node" }]
   */
  private parseStateMachineStructure(
    content: Record<string, unknown>,
    kind: FlowKind,
    warnings: string[],
    metadataNodeIds: string[],
    recorder: PathRecorder
  ): StructureResult {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    // Find the entry node and parse the state machine
    const actions = stepListOf(content, kind);
    if (!Array.isArray(actions)) {
      warnings.push(`No ${kind === 'script' ? 'sequence' : 'actions'} found in ${kind}`);
      return { nodes, edges };
    }

    let entryNodeId: string | null = null;
    const nodeInfoMap = new Map<string, StateMachineNodeInfo>();
    // Trace path (`action/{dispatchIdx}/repeat/sequence/{chooseIdx}/choose/{b}`)
    // each choose-block-derived node was parsed from. Kept separately from
    // nodeInfoMap because `__parallel_trigger_*` entries are deleted below
    // once they've been expanded, but their base path is still needed to
    // compose paths for the real nodes inlined inside them.
    const chooseBlockPaths = new Map<string, string>();

    actions.forEach((action, dispatchIdx) => {
      const actionObj = action as Record<string, unknown>;

      // Find entry node from initial variables
      if (actionObj.variables) {
        const vars = actionObj.variables as Record<string, unknown>;
        if (typeof vars.current_node === 'string' && vars.current_node !== 'END') {
          entryNodeId = vars.current_node;
        }
      }

      // Parse repeat/choose structure
      if (actionObj.repeat) {
        const repeat = actionObj.repeat as Record<string, unknown>;
        const sequence = repeat.sequence as unknown[];

        if (Array.isArray(sequence)) {
          sequence.forEach((seqItem, chooseIdx) => {
            const seqObj = seqItem as Record<string, unknown>;

            if (Array.isArray(seqObj.choose)) {
              seqObj.choose.forEach((chooseBlock, b) => {
                const block = chooseBlock as Record<string, unknown>;
                const nodeInfo = this.parseStateMachineChooseBlock(block);
                if (nodeInfo) {
                  nodeInfoMap.set(nodeInfo.nodeId, nodeInfo);
                  const basePath = `${stepsPathOf(kind)}/${dispatchIdx}/repeat/sequence/${chooseIdx}/choose/${b}`;
                  chooseBlockPaths.set(nodeInfo.nodeId, basePath);

                  // `__parallel_trigger_*` dispatcher branches don't correspond to a
                  // single canvas node — they get resolved into real nodes below,
                  // which are recorded against their own deeper paths instead.
                  if (!PARALLEL_TRIGGER_ID_PATTERN.test(nodeInfo.nodeId)) {
                    const conditions = block.conditions;
                    const conditionsCount = Array.isArray(conditions) ? conditions.length : 0;
                    for (let k = 0; k < conditionsCount; k++) {
                      recorder.record(nodeInfo.nodeId, `${basePath}/conditions/${k}`);
                    }
                    const sequence2 = block.sequence;
                    const sequenceCount = Array.isArray(sequence2) ? sequence2.length : 0;
                    for (let j = 0; j < sequenceCount; j++) {
                      recorder.record(nodeInfo.nodeId, `${basePath}/sequence/${j}`);
                    }
                  }
                }
              });
            }
          });
        }
      }
    });

    // Resolve __parallel_trigger_* synthetic entries.
    // The transpiler generates these for triggers with multiple targets.
    // Expand them back into direct trigger→target edges instead of phantom nodes.
    const parallelTriggerTargets = new Map<string, string[]>();
    for (const [nodeId, info] of nodeInfoMap) {
      if (!PARALLEL_TRIGGER_ID_PATTERN.test(nodeId)) continue;

      const basePath = chooseBlockPaths.get(nodeId);
      const parallelPrefix =
        basePath !== undefined && info.parallelItemsIndex !== undefined
          ? `${basePath}/sequence/${info.parallelItemsIndex}/parallel`
          : null;

      const targetIds = this.parseInlineParallelBranches(
        info.parallelItems ?? [],
        nodeInfoMap,
        recorder,
        parallelPrefix
      );
      if (targetIds.length > 0) {
        parallelTriggerTargets.set(nodeId, targetIds);
      }
      nodeInfoMap.delete(nodeId);
    }

    // In state-machine strategy, action/condition/delay/wait node IDs are extracted
    // directly from the Jinja2 templates in the YAML choose blocks. Only trigger
    // node IDs need to be allocated via getNextNodeId, so we filter out IDs that
    // are already claimed by the choose blocks to avoid assigning them to triggers.
    const stateMachineNodeIds = new Set(nodeInfoMap.keys());
    const triggerMetadataIds = metadataNodeIds.filter((id) => !stateMachineNodeIds.has(id));
    let triggerIdIndex = 0;
    let nodeIdIndex = 0;

    const getNextNodeId = (type: string): string => {
      if (triggerIdIndex < triggerMetadataIds.length) {
        return triggerMetadataIds[triggerIdIndex++];
      }
      return generateNodeId(type, nodeIdIndex++);
    };

    // Parse triggers (a script has none)
    let triggerNodes: FlowNode[] = [];
    if (kind === 'automation') {
      const triggerData = content.triggers || content.trigger;
      if (!triggerData) {
        warnings.push('No triggers found in automation');
        return { nodes, edges };
      }
      const triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
      triggerNodes = this.parseTriggers(
        triggers as Record<string, unknown>[],
        warnings,
        getNextNodeId,
        recorder
      );
      nodes.push(...triggerNodes);
    }

    // Create nodes from parsed info
    for (const [nodeId, info] of nodeInfoMap) {
      const nodeType = info.nodeType;

      switch (nodeType) {
        case 'condition':
          nodes.push({
            id: nodeId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: info.data as ConditionNode['data'],
          });
          break;
        case 'action':
          nodes.push({
            id: nodeId,
            type: 'action',
            position: { x: 0, y: 0 },
            data: info.data as ActionNode['data'],
          });
          break;
        case 'delay':
          nodes.push({
            id: nodeId,
            type: 'delay',
            position: { x: 0, y: 0 },
            data: info.data as DelayNode['data'],
          });
          break;
        case 'wait':
          nodes.push({
            id: nodeId,
            type: 'wait',
            position: { x: 0, y: 0 },
            data: info.data as WaitNode['data'],
          });
          break;
      }
    }

    // Create edges
    // Connect triggers to entry node(s)
    if (entryNodeId) {
      // Check if entryNodeId is a Jinja2 template for trigger routing
      const triggerRouting = this.parseEntryNodeTemplate(entryNodeId);

      if (triggerRouting && triggerRouting.size > 0) {
        // Different triggers route to different nodes
        for (let i = 0; i < triggerNodes.length; i++) {
          const targetNodeId = triggerRouting.get(i);
          if (targetNodeId) {
            // Expand synthetic parallel trigger entries into direct edges
            const expandedTargets = parallelTriggerTargets.get(targetNodeId);
            if (expandedTargets) {
              for (const actualTarget of expandedTargets) {
                edges.push(createEdge(triggerNodes[i].id, actualTarget));
              }
            } else {
              edges.push(createEdge(triggerNodes[i].id, targetNodeId));
            }
          }
        }
      } else {
        // All triggers route to same node (simple case)
        for (const trigger of triggerNodes) {
          edges.push(createEdge(trigger.id, entryNodeId));
        }
      }
    }

    // Create edges between nodes based on transitions
    for (const [nodeId, info] of nodeInfoMap) {
      if (info.trueTarget && info.trueTarget !== 'END') {
        edges.push({
          id: `edge-${nodeId}-${info.trueTarget}`,
          source: nodeId,
          target: info.trueTarget,
          sourceHandle: info.nodeType === 'condition' || info.falseTarget ? 'true' : undefined,
        });
      }
      if (info.falseTarget && info.falseTarget !== 'END') {
        edges.push({
          id: `edge-${nodeId}-${info.falseTarget}`,
          source: nodeId,
          target: info.falseTarget,
          sourceHandle: 'false',
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Parse Jinja2 entry node template to extract trigger-to-node routing
   *
   * Template format: {% if trigger.idx == "0" %}action_0{% elif trigger.idx == "1" %}action_1{% else %}action_2{% endif %}
   * Note: trigger.idx is a string in HA, so comparisons use quoted values
   * Returns a Map where key = trigger index, value = target node ID
   */
  private parseEntryNodeTemplate(entryNodeId: string): Map<number, string> | null {
    // Check if it's a Jinja2 template
    if (!entryNodeId.includes('{%') || !entryNodeId.includes('trigger.idx')) {
      return null;
    }

    const routing = new Map<number, string>();

    // Match {% if trigger.idx == "N" %}nodeId or {% elif trigger.idx == "N" %}nodeId
    // trigger.idx is a string in HA, so index is quoted; node IDs are NOT quoted
    const ifPattern =
      /{%\s*(?:if|elif)\s+trigger\.idx\s*==\s*["'](\d+)["']\s*%}\s*([^{%]+?)(?={%|$)/g;
    const matches = entryNodeId.matchAll(ifPattern);

    for (const match of matches) {
      const triggerIdx = parseInt(match[1], 10);
      const nodeId = match[2].trim();
      routing.set(triggerIdx, nodeId);
    }

    // Match {% else %}nodeId for the default case (last trigger if not explicitly matched)
    const elseMatch = entryNodeId.match(/{%\s*else\s*%}\s*([^{%]+?)(?={%|$)/);
    if (elseMatch && routing.size > 0) {
      // The else branch is for the last trigger index not explicitly matched
      // Find the highest trigger index and add 1
      const maxIdx = Math.max(...routing.keys());
      routing.set(maxIdx + 1, elseMatch[1].trim());
    }

    return routing.size > 0 ? routing : null;
  }

  /**
   * Parse inline parallel branch items into nodes and edges.
   * Reconstructs the subgraph that was inlined by the transpiler's generateInlineBranch.
   * Returns the root node IDs of each branch (for trigger→target edge creation).
   */
  private parseInlineParallelBranches(
    parallelItems: unknown[],
    nodeInfoMap: Map<string, StateMachineNodeInfo>,
    recorder: PathRecorder,
    pathPrefix: string | null
  ): string[] {
    const targetIds: string[] = [];
    let idCounter = 0;

    const generateId = (type: string): string => `inline_${type}_${idCounter++}`;

    parallelItems.forEach((item, branchIndex) => {
      const pItem = item as Record<string, unknown>;
      const alias = pItem.alias as string | undefined;
      const branchPath = pathPrefix ? `${pathPrefix}/${branchIndex}/sequence` : null;

      // New format: { alias: "parallel_branch:<nodeId>", ... }
      const branchMatch = alias?.match(/^parallel_branch:(.+)$/);
      if (branchMatch) {
        const rootNodeId = branchMatch[1];
        targetIds.push(rootNodeId);

        // Parse the branch content into nodes
        if (Array.isArray(pItem.sequence)) {
          this.parseInlineActionList(
            pItem.sequence as Record<string, unknown>[],
            rootNodeId,
            nodeInfoMap,
            generateId,
            recorder,
            branchPath
          );
        } else {
          // Single-action branch — HA still traces it as sequence index 0.
          this.parseInlineActionItem(
            pItem,
            rootNodeId,
            nodeInfoMap,
            generateId,
            recorder,
            branchPath ? `${branchPath}/0` : null
          );
        }
        return;
      }

      // Legacy format: { action: "system_log.write", data: { message: "Node: <nodeId>" } }
      const action = (pItem.service ?? pItem.action) as string | undefined;
      if (action === 'system_log.write') {
        const data = pItem.data as Record<string, unknown> | undefined;
        const message = data?.message as string | undefined;
        if (message) {
          const nodeMatch = message.match(/^Node:\s*(.+)$/);
          if (nodeMatch) {
            const nodeId = nodeMatch[1];
            targetIds.push(nodeId);
            if (branchPath) recorder.record(nodeId, `${branchPath}/0`);
          }
        }
      }
    });

    return targetIds;
  }

  /**
   * Parse a list of inline HA actions, chaining them sequentially.
   * The first action uses firstNodeId; subsequent actions get generated IDs.
   */
  private parseInlineActionList(
    actions: Record<string, unknown>[],
    firstNodeId: string,
    nodeInfoMap: Map<string, StateMachineNodeInfo>,
    generateId: (type: string) => string,
    recorder: PathRecorder,
    pathPrefix: string | null
  ): void {
    let prevNodeId: string | null = null;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const { nodeId: embeddedId } = this.extractCafeNodeId(action.alias as string | undefined);
      const nodeId =
        i === 0 ? firstNodeId : (embeddedId ?? generateId(this.inferInlineNodeType(action)));

      // Chain previous non-condition node to this one
      if (prevNodeId) {
        const prevInfo = nodeInfoMap.get(prevNodeId);
        if (prevInfo && prevInfo.nodeType !== 'condition') {
          prevInfo.trueTarget = nodeId;
        }
      }

      this.parseInlineActionItem(
        action,
        nodeId,
        nodeInfoMap,
        generateId,
        recorder,
        pathPrefix ? `${pathPrefix}/${i}` : null
      );
      prevNodeId = nodeId;
    }
  }

  /**
   * Parse a single inline HA action item into a StateMachineNodeInfo entry.
   * Handles actions, conditions (if/then/else), delays, and waits.
   */
  private parseInlineActionItem(
    item: Record<string, unknown>,
    nodeId: string,
    nodeInfoMap: Map<string, StateMachineNodeInfo>,
    generateId: (type: string) => string,
    recorder: PathRecorder,
    pathPrefix: string | null
  ): void {
    // Strip parallel_branch: prefix from alias if present
    const rawAlias = item.alias as string | undefined;
    const { cleanAlias: cafeStripped } = this.extractCafeNodeId(rawAlias);
    const alias = cafeStripped?.startsWith('parallel_branch:') ? undefined : cafeStripped;

    if (pathPrefix) recorder.record(nodeId, pathPrefix);

    if (item.if && Array.isArray(item.if)) {
      // Condition node (if/then/else)
      const conditions = item.if as Record<string, unknown>[];
      const condition = conditions[0] ?? {};
      const data: Record<string, unknown> = { ...condition };
      if (alias) data.alias = alias;

      // The if action's own decision has no dedicated node; it maps to this
      // condition node, mirroring how a native if-action's `action/{i}` maps
      // to its own condition node too.
      if (pathPrefix) recorder.record(nodeId, `${pathPrefix}/if/condition/0`);

      let trueTarget: string | null = null;
      let falseTarget: string | null = null;

      const thenActions = item.then as Record<string, unknown>[] | undefined;
      if (thenActions && thenActions.length > 0) {
        const { nodeId: thenEmbeddedId } = this.extractCafeNodeId(
          thenActions[0].alias as string | undefined
        );
        const thenNodeId = thenEmbeddedId ?? generateId(this.inferInlineNodeType(thenActions[0]));
        trueTarget = thenNodeId;
        this.parseInlineActionList(
          thenActions,
          thenNodeId,
          nodeInfoMap,
          generateId,
          recorder,
          pathPrefix ? `${pathPrefix}/then` : null
        );
      }

      const elseActions = item.else as Record<string, unknown>[] | undefined;
      if (elseActions && elseActions.length > 0) {
        const { nodeId: elseEmbeddedId } = this.extractCafeNodeId(
          elseActions[0].alias as string | undefined
        );
        const elseNodeId = elseEmbeddedId ?? generateId(this.inferInlineNodeType(elseActions[0]));
        falseTarget = elseNodeId;
        this.parseInlineActionList(
          elseActions,
          elseNodeId,
          nodeInfoMap,
          generateId,
          recorder,
          pathPrefix ? `${pathPrefix}/else` : null
        );
      }

      nodeInfoMap.set(nodeId, { nodeId, nodeType: 'condition', data, trueTarget, falseTarget });
    } else if (item.service || item.action) {
      // Action node
      const data: Record<string, unknown> = {};
      data.service = (item.service ?? item.action) as string;
      if (item.target) data.target = item.target;
      if (item.data) data.data = item.data;
      if (alias) data.alias = alias;

      nodeInfoMap.set(nodeId, {
        nodeId,
        nodeType: 'action',
        data,
        trueTarget: null,
        falseTarget: null,
      });
    } else if (item.delay !== undefined) {
      // Delay node
      const data: Record<string, unknown> = { delay: item.delay };
      if (alias) data.alias = alias;

      nodeInfoMap.set(nodeId, {
        nodeId,
        nodeType: 'delay',
        data,
        trueTarget: null,
        falseTarget: null,
      });
    } else if (item.wait_template !== undefined || item.wait_for_trigger !== undefined) {
      // Wait node
      const data: Record<string, unknown> = {};
      if (item.wait_template) data.wait_template = item.wait_template;
      if (item.wait_for_trigger) data.wait_for_trigger = item.wait_for_trigger;
      if (item.timeout) data.timeout = item.timeout;
      if (item.continue_on_timeout !== undefined)
        data.continue_on_timeout = item.continue_on_timeout;
      if (alias) data.alias = alias;

      nodeInfoMap.set(nodeId, {
        nodeId,
        nodeType: 'wait',
        data,
        trueTarget: null,
        falseTarget: null,
      });
    }
  }

  /**
   * Extract a C.A.F.E. node ID encoded in an alias field.
   * Handles format: "cafe_node:<nodeId>" or "cafe_node:<nodeId>:<userAlias>"
   */
  private extractCafeNodeId(alias: string | undefined): {
    nodeId: string | null;
    cleanAlias: string | undefined;
  } {
    if (!alias) return { nodeId: null, cleanAlias: undefined };
    const match = alias.match(/^cafe_node:([^:]+)(?::(.+))?$/);
    if (match) {
      return { nodeId: match[1], cleanAlias: match[2] || undefined };
    }
    return { nodeId: null, cleanAlias: alias };
  }

  /**
   * Infer the node type from an inline HA action item.
   */
  private inferInlineNodeType(item: Record<string, unknown>): string {
    if (item.if) return 'condition';
    if (item.delay !== undefined) return 'delay';
    if (item.wait_template !== undefined || item.wait_for_trigger !== undefined) return 'wait';
    return 'action';
  }

  /**
   * Parse a single choose block from state-machine format
   */
  private parseStateMachineChooseBlock(
    chooseBlock: Record<string, unknown>
  ): StateMachineNodeInfo | null {
    const conditions = chooseBlock.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return null;
    }

    // Extract node ID from condition: {{ current_node == "node-id" }}
    const firstCondition = conditions[0] as Record<string, unknown>;
    const valueTemplate = firstCondition.value_template as string;
    if (!valueTemplate) return null;

    const match = valueTemplate.match(/current_node\s*==\s*["']([^"']+)["']/);
    if (!match) return null;

    const nodeId = match[1];
    const sequence = chooseBlock.sequence;
    if (!Array.isArray(sequence) || sequence.length === 0) {
      return null;
    }

    // Parse sequence to determine node type and data
    let nodeType: 'action' | 'condition' | 'delay' | 'wait' = 'action';
    const data: Record<string, unknown> = {};
    let trueTarget: string | null = null;
    let falseTarget: string | null = null;
    let parallelItems: unknown[] | undefined;
    let parallelItemsIndex: number | undefined;

    for (let seqIdx = 0; seqIdx < sequence.length; seqIdx++) {
      const item = sequence[seqIdx];
      const seqItem = item as Record<string, unknown>;

      // Check for variables action (sets next node / edge)
      if (seqItem.variables) {
        const vars = seqItem.variables as Record<string, unknown>;
        const currentNodeValue = vars.current_node;

        if (typeof currentNodeValue === 'string') {
          // Check if it's a Jinja conditional (condition node)
          if (currentNodeValue.includes('{%') && currentNodeValue.includes('%}')) {
            nodeType = 'condition';

            // Extract true and false targets
            const trueMatch = currentNodeValue.match(/{%\s*if[^%]*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);
            const falseMatch = currentNodeValue.match(/{%\s*else\s*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);

            trueTarget = trueMatch ? trueMatch[1] : null;
            falseTarget = falseMatch ? falseMatch[1] : null;

            // Extract condition expression from Jinja template
            const conditionMatch = currentNodeValue.match(/{%\s*if\s+(.+?)\s*%}/);
            if (conditionMatch) {
              const conditionExpr = conditionMatch[1];
              Object.assign(data, this.parseJinjaCondition(conditionExpr));
            }
          } else {
            // Simple transition
            trueTarget = currentNodeValue === 'END' ? null : currentNodeValue;
          }
        }
      }
      // Check for delay action
      else if (seqItem.delay !== undefined) {
        nodeType = 'delay';
        data.delay = seqItem.delay;
        if (seqItem.alias) data.alias = seqItem.alias;
      }
      // Check for wait action
      else if (seqItem.wait_template !== undefined) {
        nodeType = 'wait';
        data.wait_template = seqItem.wait_template;
        if (seqItem.timeout) data.timeout = seqItem.timeout;
        if (seqItem.continue_on_timeout !== undefined) {
          data.continue_on_timeout = seqItem.continue_on_timeout;
        }
        if (seqItem.alias) data.alias = seqItem.alias;
      }
      // Check for parallel block (synthetic __parallel_trigger_* entries)
      else if (Array.isArray(seqItem.parallel)) {
        parallelItems = seqItem.parallel;
        parallelItemsIndex = seqIdx;
      }
      // Check for service call action
      else if (seqItem.service || seqItem.action) {
        nodeType = 'action';
        data.service = seqItem.service || seqItem.action;
        if (seqItem.target) data.target = seqItem.target;
        if (seqItem.data) data.data = seqItem.data;
        if (seqItem.alias) data.alias = seqItem.alias;
      }
    }

    return { nodeId, nodeType, data, trueTarget, falseTarget, parallelItems, parallelItemsIndex };
  }

  /**
   * Parse Jinja condition expression to extract condition data
   */
  private parseJinjaCondition(expr: string): Record<string, unknown> {
    // is_state('entity', 'state')
    const isStateMatch = expr.match(/is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (isStateMatch) {
      const entityId = isStateMatch[1];
      const state = isStateMatch[2];

      // Check for sun entity
      if (entityId === 'sun.sun') {
        if (state === 'above_horizon') {
          return { condition: 'sun', after: 'sunrise', before: 'sunset' };
        } else if (state === 'below_horizon') {
          return { condition: 'sun', after: 'sunset', before: 'sunrise' };
        }
      }

      return { condition: 'state', entity_id: entityId, state };
    }

    // states('entity') | float > number
    const numericMatch = expr.match(
      /states\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\|\s*float\s*([<>=]+)\s*(\d+(?:\.\d+)?)/
    );
    if (numericMatch) {
      const entityId = numericMatch[1];
      const operator = numericMatch[2];
      const value = parseFloat(numericMatch[3]);

      const result: Record<string, unknown> = {
        condition: 'numeric_state',
        entity_id: entityId,
      };
      if (operator.includes('>')) result.above = value;
      if (operator.includes('<')) result.below = value;
      return result;
    }

    // Fallback to template condition
    return { condition: 'template', value_template: `{{ ${expr} }}` };
  }

  /**
   * Parse the steps of a flow into nodes and edges: a state machine written by Flow's own fallback
   * strategy, a script's `sequence`, or an automation's triggers, conditions and actions.
   */
  private parseStructure(
    content: Record<string, unknown>,
    kind: FlowKind,
    warnings: string[],
    metadataNodeIds: string[],
    recorder: PathRecorder,
    metadata: CafeMetadata | null
  ): StructureResult {
    const isStateMachine =
      metadata?.strategy === 'state-machine' || this.detectStateMachineFormat(content, kind);
    if (isStateMachine) {
      return this.parseStateMachineStructure(content, kind, warnings, metadataNodeIds, recorder);
    }
    return kind === 'script'
      ? this.parseScriptStructure(content, warnings, metadataNodeIds, recorder)
      : this.parseAutomationStructure(content, warnings, metadataNodeIds, recorder);
  }

  /**
   * Parse a script's `sequence` into nodes and edges (native format). There are no triggers: the
   * first step is the start, and a script that opens with a `parallel` block starts with several
   * nodes that nothing leads to.
   */
  private parseScriptStructure(
    content: Record<string, unknown>,
    warnings: string[],
    metadataNodeIds: string[],
    recorder: PathRecorder
  ): StructureResult {
    const sequence = content.sequence;
    if (sequence === undefined || sequence === null) {
      warnings.push('No sequence found in script');
      return { nodes: [], edges: [] };
    }
    const steps = Array.isArray(sequence) ? sequence : [sequence];
    const { nodes, edges } = new StepParser({
      warnings,
      getNextNodeId: createNodeIdAllocator(metadataNodeIds),
      recorder,
    }).parseActions(steps, { previous: [], depth: 0, pathPrefix: stepsPathOf('script') });
    return { nodes, edges };
  }

  /**
   * Parse automation structure into nodes and edges (native format)
   */
  private parseAutomationStructure(
    content: Record<string, unknown>,
    warnings: string[],
    metadataNodeIds: string[],
    recorder: PathRecorder
  ): StructureResult {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    // Hands out the saved ids by node type: without type-aware grouping, depth-first parsing of
    // parallel branches would assign IDs in the wrong order (e.g., an action gets a condition's ID).
    const getNextNodeId = createNodeIdAllocator(metadataNodeIds);

    // Parse triggers (support both 'trigger' and 'triggers')
    const triggerData = content.triggers || content.trigger;
    if (!triggerData) {
      warnings.push('No triggers found in automation');
      return { nodes, edges };
    }
    const triggers = flattenTriggerList(Array.isArray(triggerData) ? triggerData : [triggerData]);
    const triggerNodes = this.parseTriggers(triggers, warnings, getNextNodeId, recorder);
    nodes.push(...triggerNodes);

    // Build a map from trigger node ID → trigger's `id` field (for trigger-id condition routing)
    const triggerNodeMap = new Map<string, string>();
    for (let i = 0; i < triggerNodes.length; i++) {
      const triggerId = (triggers[i] as Record<string, unknown>)?.id;
      if (typeof triggerId === 'string') {
        triggerNodeMap.set(triggerNodes[i].id, triggerId);
      }
    }

    // Parse conditions (if present at top level - support both 'condition' and 'conditions')
    // The last of them hands control to the first action through its true handle.
    let firstActions: Exit[] = triggerNodes.map((t) => ({ id: t.id }));
    const conditions = normalizeConditionList(content.conditions ?? content.condition);

    if (conditions.length > 0) {
      const conditionResults = this.parseConditions(conditions, warnings, getNextNodeId, recorder);
      // Root-level conditions are implicitly AND-ed together: trigger → cond1 → cond2 → actions,
      // each condition's TRUE path leading to the next. They sit above the action steps.
      const conditionNodes = conditionResults.nodes;
      for (const node of conditionNodes) Object.assign(node.data, { stepDepth: -1 });
      nodes.push(...conditionNodes);
      edges.push(...conditionResults.edges);

      if (conditionNodes.length > 0) {
        for (const trigger of triggerNodes) {
          edges.push(createEdge(trigger.id, conditionNodes[0].id));
        }
        for (let i = 0; i < conditionNodes.length - 1; i++) {
          edges.push(createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
        }
        firstActions = [{ id: conditionNodes[conditionNodes.length - 1].id, handle: 'true' }];
      }
    }

    // Parse actions (support both 'action' and 'actions')
    const actionData = stepListOf(content, 'automation');
    if (!actionData) {
      warnings.push('No actions found in automation');
      return { nodes, edges };
    }
    const actions = Array.isArray(actionData) ? actionData : [actionData];
    const actionResults = new StepParser({ warnings, getNextNodeId, recorder }).parseActions(
      actions,
      { previous: firstActions, depth: 0, pathPrefix: stepsPathOf('automation'), triggerNodeMap }
    );
    nodes.push(...actionResults.nodes);
    edges.push(...actionResults.edges);

    return { nodes, edges };
  }

  /**
   * Parse trigger configurations
   */
  private parseTriggers(
    triggers: unknown[],
    warnings: string[],
    getNextNodeId: (type: string) => string,
    recorder: PathRecorder
  ): FlowNode[] {
    // Home Assistant trace paths (`trigger/{i}`) are indexed against the
    // original triggers array, not the object-filtered one below — precompute
    // the mapping so recorded paths still line up once non-object entries
    // (which never happen in practice, but are tolerated) are dropped.
    const originalIndices: number[] = [];
    triggers.forEach((t, i) => {
      if (typeof t === 'object' && t !== null) originalIndices.push(i);
    });

    // Process all object-type trigger items — do NOT filter with isHATrigger here,
    // because modern HA may use formats (e.g. dict-keyed or novel trigger types)
    // that don't have 'platform', 'trigger', or 'entity_id' at the top level.
    return triggers
      .filter((t) => typeof t === 'object' && t !== null)
      .map((trigger, index) => {
        const nodeId = getNextNodeId('trigger');
        const tracePath = `trigger/${originalIndices[index]}`;
        try {
          // Validate and parse trigger using HATriggerSchema
          const result = HATriggerSchema.safeParse(trigger);
          if (!result.success) {
            warnings.push(
              `Trigger ${index} failed schema validation: ${JSON.stringify(result.error.issues)}`
            );
            // Return a fallback TRIGGER node (not an action node) so the graph
            // always has at least one trigger — allowing the import to succeed.
            const fallbackNode = this.createFallbackTriggerNode(nodeId, trigger);
            recorder.record(fallbackNode.id, tracePath);
            return fallbackNode;
          }
          // Use platform directly from validated schema
          const node: TriggerNode = {
            id: nodeId,
            type: 'trigger',
            position: { x: 0, y: 0 },
            data: result.data,
          };
          recorder.record(node.id, tracePath);
          return node;
        } catch (error) {
          warnings.push(`Failed to parse trigger ${index}: ${error}`);
          const fallbackNode = this.createFallbackTriggerNode(nodeId, trigger);
          recorder.record(fallbackNode.id, tracePath);
          return fallbackNode;
        }
      });
  }

  /**
   * Build a best-effort trigger node when HATriggerSchema validation fails.
   * Always returns type:'trigger' so validateGraphStructure does not fail.
   */
  private createFallbackTriggerNode(nodeId: string, originalData: unknown): TriggerNode {
    const data: Record<string, unknown> =
      typeof originalData === 'object' && originalData !== null
        ? (originalData as Record<string, unknown>)
        : {};

    // Determine trigger type from various formats:
    // 1. Modern HA: { trigger: 'state', ... }
    // 2. Legacy HA: { platform: 'state', ... }
    // 3. Dict-keyed: { state: { entity_id: '...' } }
    let triggerType: string;
    let nestedFields: Record<string, unknown> = {};

    if (typeof data.trigger === 'string') {
      triggerType = data.trigger;
      const { platform: _p, trigger: _t, ...rest } = data;
      nestedFields = rest;
    } else if (typeof data.platform === 'string') {
      triggerType = data.platform;
      const { platform: _p, ...rest } = data;
      nestedFields = rest;
    } else {
      // Dict-keyed format: first key is the trigger type, value contains fields
      const firstKey = Object.keys(data).find(
        (k) => !['alias', 'id', 'enabled', 'variables'].includes(k)
      );
      if (firstKey && typeof data[firstKey] === 'object' && data[firstKey] !== null) {
        triggerType = firstKey;
        nestedFields = data[firstKey] as Record<string, unknown>;
      } else {
        triggerType = 'state';
      }
    }

    return {
      id: nodeId,
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: {
        trigger: triggerType,
        ...nestedFields,
      } as TriggerNode['data'],
    };
  }

  /**
   * Parse condition configurations
   */
  private parseConditions(
    conditions: unknown[],
    warnings: string[],
    getNextNodeId: (type: string) => string,
    recorder: PathRecorder
  ): { nodes: ConditionNode[]; edges: FlowEdge[]; outputNodeIds: string[] } {
    const nodes: ConditionNode[] = [];
    const edges: FlowEdge[] = [];
    const outputNodeIds: string[] = [];

    // Home Assistant trace paths (`condition/{i}`) are indexed against the
    // original conditions array, not the isHACondition-filtered one below.
    const originalIndices: number[] = [];
    conditions.forEach((c, i) => {
      if (isHACondition(c)) originalIndices.push(i);
    });

    conditions.filter(isHACondition).forEach((condition, index) => {
      const nodeId = getNextNodeId('condition');
      const tracePath = `condition/${originalIndices[index]}`;
      try {
        const result = HAConditionSchema.safeParse(condition);
        if (!result.success) {
          warnings.push(
            `Condition ${index} failed schema validation: ${JSON.stringify(result.error.issues)}`
          );
          nodes.push({
            id: nodeId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: {
              condition: 'template',
              alias: 'Unknown Condition',
              value_template: JSON.stringify(condition),
            },
          });
          recorder.record(nodeId, tracePath);
          return;
        }

        const members = result.data.conditions;
        const node: ConditionNode = {
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          // Group members keep their own alias/note like every nested condition (see
          // transformToNestedCondition); without this the members' aliases are lost on save.
          data: Array.isArray(members)
            ? { ...result.data, conditions: transformConditions(members) }
            : result.data,
        };
        nodes.push(node);
        outputNodeIds.push(nodeId);
        recorder.record(nodeId, tracePath);
      } catch (error) {
        warnings.push(`Failed to parse condition ${index}: ${error}`);
        // Create a minimal valid unknown condition node
        nodes.push({
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            condition: 'template',
            alias: 'Unknown Condition',
            value_template: JSON.stringify(condition),
          },
        });
        recorder.record(nodeId, tracePath);
      }
    });
    return { nodes, edges, outputNodeIds };
  }

  /**
   * Apply positions from metadata
   */
  private applyMetadataPositions(nodes: FlowNode[], metadata: CafeMetadata): FlowNode[] {
    return nodes.map((node) => ({
      ...node,
      position: metadata.nodes[node.id] || node.position,
    }));
  }
}

// Export singleton instance
export const yamlParser = new YamlParser();
