import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowGraph,
  FlowNode,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@flow/shared';
import { isDeviceAction } from '@flow/shared';
import { computePostDominators, type PostDominators } from '../analyzer/structure';
import type { TopologyAnalysis } from '../analyzer/topology';
import { findBackEdges } from '../analyzer/topology';
import { BaseStrategy, type HAYamlOutput } from './base';

/**
 * Describes a detected repeat pattern in the flow graph
 */
interface RepeatPattern {
  type: 'while' | 'until' | 'count';
  /** The node ID that serves as the entry point to this repeat pattern */
  entryNodeId: string;
  /** Condition node IDs in the repeat (for while/until) */
  conditionNodeIds: string[];
  /** Body node IDs (the sequence inside the loop) */
  bodyNodeIds: string[];
  /** The source node of the back-edge */
  backEdgeSourceId: string;
  /** For count: the init set_vars node ID */
  initNodeId?: string;
  /** For count: the increment set_vars node ID */
  incrementNodeId?: string;
  /** For count: the count value */
  count?: number | string;
  /** The node ID where flow continues after the loop */
  exitNodeId: string | null;
}

/** Step keys whose value is (or holds) a nested list of steps. */
const NESTED_STEP_KEYS = ['then', 'else', 'default', 'sequence', 'parallel', 'choose', 'repeat'];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An empty `else: []` / `default: []` means the same as no else/default, but
 * clutters the YAML and shows up as an empty section in Home Assistant's own
 * editor. Remove them, recursively, from a generated step tree.
 */
function pruneEmptyBranches(step: unknown): void {
  if (Array.isArray(step)) {
    for (const child of step) pruneEmptyBranches(child);
    return;
  }
  if (!isPlainRecord(step)) return;
  for (const key of ['else', 'default']) {
    const branch = step[key];
    if (Array.isArray(branch) && branch.length === 0) delete step[key];
  }
  for (const key of NESTED_STEP_KEYS) pruneEmptyBranches(step[key]);
}

/**
 * Native strategy for simple tree-shaped automations
 * Generates standard nested Home Assistant YAML with choose blocks
 */
export class NativeStrategy extends BaseStrategy {
  readonly name = 'native';
  readonly description = 'Generates nested HA YAML for simple tree-shaped automations';

  canHandle(analysis: TopologyAnalysis): boolean {
    return analysis.isTree;
  }

  /** Repeat patterns detected in the current flow */
  private repeatPatterns: Map<string, RepeatPattern> = new Map();
  /** Set of all node IDs that are internal to a repeat pattern */
  private repeatInternalNodeIds: Set<string> = new Set();
  /** Set of back-edge IDs detected via DFS */
  private backEdgeIds: Set<string> = new Set();
  /** Where branches of the current flow meet again (nested block joins) */
  private postDominators: PostDominators = { ipdom: new Map(), joinOf: () => null };

  generate(flow: FlowGraph, analysis: TopologyAnalysis): HAYamlOutput {
    const warnings: string[] = [];

    // Structurally detect back-edges using DFS
    this.backEdgeIds = findBackEdges(flow);
    this.postDominators = computePostDominators(flow, this.backEdgeIds);

    // Pre-detect repeat patterns from structural back-edges
    this.repeatPatterns = this.detectRepeatPatterns(flow);
    this.repeatInternalNodeIds = new Set();
    for (const pattern of this.repeatPatterns.values()) {
      for (const id of pattern.bodyNodeIds) this.repeatInternalNodeIds.add(id);
      for (const id of pattern.conditionNodeIds) this.repeatInternalNodeIds.add(id);
      if (pattern.initNodeId) this.repeatInternalNodeIds.add(pattern.initNodeId);
      if (pattern.incrementNodeId) this.repeatInternalNodeIds.add(pattern.incrementNodeId);
    }

    // Extract triggers from the flow
    const triggers = this.extractTriggers(flow);

    // Build action sequence starting from first node after triggers
    const entryNodes = analysis.entryNodes;
    const firstActions = entryNodes.flatMap((entryId) => {
      const outgoing = this.getOutgoingEdges(flow, entryId);
      return outgoing.map((e) => e.target);
    });

    // Remove duplicates
    const uniqueFirstActions = [...new Set(firstActions)];

    // Check if leading conditions can be promoted to root conditions block.
    // Conditions directly after triggers with no else/false paths can be placed
    // in the root "conditions:" block so HA properly tracks "Last triggered at".
    let rootConditions: unknown[] | null = null;
    let actionsStartNodeIds: string[] = [];
    let promotedVisited: Set<string> | null = null;

    if (uniqueFirstActions.length === 1) {
      const promoted = this.extractLeadingConditions(flow, uniqueFirstActions[0]);
      if (promoted.conditions.length > 0) {
        rootConditions = promoted.conditions;
        actionsStartNodeIds = promoted.nextNodeIds;
        promotedVisited = promoted.visitedIds;
      }
    }

    // Build the action sequence
    let actions: unknown[];
    if (rootConditions) {
      // Leading conditions promoted to root - build actions from continuation point(s)
      // If there are multiple starting points (fan-out), build sequences from all of them
      if (actionsStartNodeIds.length > 0) {
        actions = actionsStartNodeIds.flatMap((nodeId) =>
          this.buildSequenceFromNode(flow, nodeId, new Set(promotedVisited!))
        );
      } else {
        actions = [];
      }
    } else if (uniqueFirstActions.length === 1) {
      actions = this.buildSequenceFromNode(flow, uniqueFirstActions[0], new Set());
    } else if (uniqueFirstActions.length > 1) {
      // Check if this is an OR pattern: all first actions are conditions
      // whose true/false paths converge to the same target
      const orPattern = this.detectOrPattern(flow, uniqueFirstActions);

      if (orPattern) {
        // Build OR condition block
        const orConditions = orPattern.conditions.map((c) => this.buildCondition(c));
        const visited = new Set(orPattern.conditions.map((c) => c.id));

        const thenSequence = this.buildSequenceFromNode(flow, orPattern.convergenceNode, visited);

        actions = [
          {
            if: [{ condition: 'or', conditions: orConditions }],
            then: thenSequence,
            else: orPattern.isFromFalsePaths ? [] : [], // OR conditions from true paths have empty else
          },
        ];
      } else {
        // Check if all first-action nodes are `condition: trigger` nodes.
        // In that case, each branch is an exclusive trigger-id route and should
        // be emitted as sequential `if:` blocks, not a parallel block.
        const allAreTriggerConditions = uniqueFirstActions.every((nodeId) => {
          const node = flow.nodes.find((n) => n.id === nodeId);
          return (
            node?.type === 'condition' &&
            (node.data as Record<string, unknown>)?.condition === 'trigger'
          );
        });

        if (allAreTriggerConditions) {
          // Emit each as a sequential if block
          actions = uniqueFirstActions.flatMap((nodeId) =>
            this.buildSequenceFromNode(flow, nodeId, new Set())
          );
        } else {
          // Multiple paths from triggers - use parallel
          const parallelBranches = uniqueFirstActions.map((nodeId) =>
            this.buildSequenceFromNode(flow, nodeId, new Set())
          );
          // Flatten single-action branches to avoid double-nesting (- - service:)
          const flattenedBranches = parallelBranches
            .filter((branch) => branch.length > 0)
            .map((branch) => (branch.length === 1 ? branch[0] : branch));
          actions = [
            {
              parallel: flattenedBranches,
            },
          ];
        }
      }
    } else {
      actions = [];
      warnings.push('No actions found after trigger nodes');
    }

    const automation: Record<string, unknown> = {
      alias: flow.name,
      description: flow.description || '',
      triggers: triggers,
    };

    if (rootConditions && rootConditions.length > 0) {
      automation.conditions = rootConditions;
    }

    pruneEmptyBranches(actions);
    automation.actions = actions;
    automation.mode = flow.metadata?.mode ?? 'single';

    // Add optional metadata
    if (flow.metadata?.max) {
      automation.max = flow.metadata.max;
    }
    if (flow.metadata?.max_exceeded) {
      automation.max_exceeded = flow.metadata.max_exceeded;
    }
    if (flow.metadata?.initial_state === false) {
      automation.initial_state = false;
    }
    if (flow.metadata?.trace) {
      automation.trace = flow.metadata.trace;
    }
    if (flow.userTriggerVariables && Object.keys(flow.userTriggerVariables).length > 0) {
      automation.trigger_variables = flow.userTriggerVariables;
    }

    return {
      automation,
      warnings,
      strategy: this.name,
    };
  }

  /**
   * Detect repeat patterns by structurally analyzing back-edges in the graph.
   * Classification rules:
   * - Back-edge target is a condition, source is NOT a condition → while
   * - Back-edge source is a condition with sourceHandle='false' → until
   * - Back-edge source is a condition with sourceHandle='true' → count
   */
  private detectRepeatPatterns(flow: FlowGraph): Map<string, RepeatPattern> {
    const patterns = new Map<string, RepeatPattern>();

    for (const edge of flow.edges) {
      if (!this.backEdgeIds.has(edge.id)) continue;

      const sourceNode = this.getNode(flow, edge.source);
      const targetNode = this.getNode(flow, edge.target);
      if (!sourceNode || !targetNode) continue;

      if (targetNode.type === 'condition' && sourceNode.type !== 'condition') {
        // ── while pattern ──
        // Back-edge: last body node → first condition node
        const firstCondId = edge.target;
        const backEdgeSourceId = edge.source;

        // Collect condition chain: follow true edges from condition to condition
        const conditionNodeIds: string[] = [];
        let currentId = firstCondId;
        while (currentId) {
          const node = this.getNode(flow, currentId);
          if (node?.type !== 'condition') break;
          conditionNodeIds.push(currentId);
          const trueEdge = flow.edges.find(
            (e) =>
              e.source === currentId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
          );
          if (!trueEdge) break;
          const nextNode = this.getNode(flow, trueEdge.target);
          if (nextNode?.type === 'condition' && conditionNodeIds.indexOf(trueEdge.target) === -1) {
            currentId = trueEdge.target;
          } else {
            break;
          }
        }

        // Body nodes: everything between last condition's true target and back-edge source
        const lastCondId = conditionNodeIds[conditionNodeIds.length - 1];
        const bodyNodeIds = this.collectBodyNodes(
          flow,
          lastCondId,
          'true',
          new Set(conditionNodeIds),
          backEdgeSourceId
        );

        // Exit: first condition's false path
        const falseEdge = flow.edges.find(
          (e) =>
            e.source === firstCondId && e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
        );

        patterns.set(firstCondId, {
          type: 'while',
          entryNodeId: firstCondId,
          conditionNodeIds,
          bodyNodeIds,
          backEdgeSourceId,
          exitNodeId: falseEdge?.target ?? null,
        });
      } else if (sourceNode.type === 'condition' && edge.sourceHandle === 'false') {
        // ── until pattern ──
        // Back-edge: condition →(false)→ first body node. The parser emits one
        // false back-edge per until condition, so loop membership is exactly
        // "has a false back-edge to this loop's entry" — conditions that merely
        // FOLLOW the loop (a trailing if/guard) lack one and stay outside.
        const firstBodyId = edge.target;

        // All conditions that loop back to this entry.
        const untilSourceIds = new Set(
          flow.edges
            .filter(
              (e) =>
                this.backEdgeIds.has(e.id) && e.sourceHandle === 'false' && e.target === firstBodyId
            )
            .map((e) => e.source)
        );

        // Anchor at the chain head: the member no other member reaches via a
        // true edge (multiple back-edges make us visit this loop more than
        // once; anchoring makes every visit compute the identical pattern).
        let headId = edge.source;
        let moved = true;
        while (moved) {
          moved = false;
          for (const e of flow.edges) {
            if (
              e.target === headId &&
              e.sourceHandle === 'true' &&
              untilSourceIds.has(e.source) &&
              !this.backEdgeIds.has(e.id)
            ) {
              headId = e.source;
              moved = true;
              break;
            }
          }
        }

        // Walk the true-edge chain, keeping only loop members.
        const conditionNodeIds: string[] = [];
        let condId: string | null = headId;
        while (condId) {
          const node = this.getNode(flow, condId);
          if (node?.type !== 'condition' || !untilSourceIds.has(condId)) break;
          conditionNodeIds.push(condId);
          const trueEdge = flow.edges.find(
            (e) => e.source === condId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
          );
          if (!trueEdge) break;
          if (
            untilSourceIds.has(trueEdge.target) &&
            conditionNodeIds.indexOf(trueEdge.target) === -1
          ) {
            condId = trueEdge.target;
          } else {
            break;
          }
        }

        // Body nodes: traverse forward from firstBodyId until we hit the condition
        const bodyNodeIds = this.collectNodesUntil(flow, firstBodyId, new Set(conditionNodeIds));

        // Exit: last condition's true path
        const lastCondId = conditionNodeIds[conditionNodeIds.length - 1];
        const trueEdge = flow.edges.find(
          (e) => e.source === lastCondId && e.sourceHandle === 'true' && !this.backEdgeIds.has(e.id)
        );

        patterns.set(firstBodyId, {
          type: 'until',
          entryNodeId: firstBodyId,
          conditionNodeIds,
          bodyNodeIds,
          backEdgeSourceId: headId,
          exitNodeId: trueEdge?.target ?? null,
        });
      } else if (sourceNode.type === 'condition' && edge.sourceHandle === 'true') {
        // ── count pattern ──
        // Back-edge: condition →(true)→ first body node
        const loopTargetId = edge.target;
        const condId = edge.source;

        const conditionNodeIds = [condId];

        // Find the increment node: it's a set_variables predecessor of the condition
        const condPredEdges = flow.edges.filter(
          (e) => e.target === condId && !this.backEdgeIds.has(e.id)
        );
        const incrementNodeId = condPredEdges.length > 0 ? condPredEdges[0].source : undefined;

        // Body nodes: from loopTargetId to incrementNodeId
        const stopSet = new Set<string>([condId]);
        if (incrementNodeId) stopSet.add(incrementNodeId);
        const bodyNodeIds = this.collectNodesUntil(flow, loopTargetId, stopSet);

        // Find the init node: predecessor of the first body node that is set_variables
        const initCandidates = flow.edges
          .filter((e) => e.target === loopTargetId && !this.backEdgeIds.has(e.id))
          .map((e) => e.source);
        const initNodeId = initCandidates.find((id) => {
          const n = this.getNode(flow, id);
          return n?.type === 'set_variables';
        });

        // Extract count from the condition's value_template
        const condNode = this.getNode(flow, condId);
        let countValue: number | string | undefined;
        if (condNode?.type === 'condition' && condNode.data.condition === 'template') {
          const tmpl = condNode.data.value_template;
          if (typeof tmpl === 'string') {
            // Extract N from "{{ _repeat_counter_xxx < N }}"
            const match = tmpl.match(/<\s*(\d+)\s*\}\}/);
            if (match) {
              countValue = Number.parseInt(match[1], 10);
            }
          }
        }

        // Exit: condition's false path
        const falseEdge = flow.edges.find(
          (e) => e.source === condId && e.sourceHandle === 'false' && !this.backEdgeIds.has(e.id)
        );

        // Entry is the init node if it exists, otherwise the first body node
        const entryNodeId = initNodeId ?? loopTargetId;

        patterns.set(entryNodeId, {
          type: 'count',
          entryNodeId,
          conditionNodeIds,
          bodyNodeIds,
          backEdgeSourceId: condId,
          initNodeId,
          incrementNodeId,
          count: countValue,
          exitNodeId: falseEdge?.target ?? null,
        });
      }
    }

    return patterns;
  }

  /**
   * Collect body node IDs starting from a condition's specified handle path
   * until reaching the backEdgeSource (inclusive)
   */
  private collectBodyNodes(
    flow: FlowGraph,
    condNodeId: string,
    handle: 'true' | 'false',
    excludeIds: Set<string>,
    backEdgeSourceId: string
  ): string[] {
    const startEdge = flow.edges.find(
      (e) => e.source === condNodeId && e.sourceHandle === handle && !this.backEdgeIds.has(e.id)
    );
    if (!startEdge) return [];

    const bodyIds: string[] = [];
    const queue = [startEdge.target];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id) || excludeIds.has(id)) continue;
      visited.add(id);
      bodyIds.push(id);

      if (id === backEdgeSourceId) continue; // Don't traverse beyond back-edge source

      const outgoing = flow.edges.filter((e) => e.source === id && !this.backEdgeIds.has(e.id));
      for (const e of outgoing) {
        if (!visited.has(e.target) && !excludeIds.has(e.target)) {
          queue.push(e.target);
        }
      }
    }

    return bodyIds;
  }

  /**
   * Collect node IDs by traversing forward until hitting any node in stopIds
   */
  private collectNodesUntil(flow: FlowGraph, startId: string, stopIds: Set<string>): string[] {
    const bodyIds: string[] = [];
    const queue = [startId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id) || stopIds.has(id)) continue;
      visited.add(id);
      bodyIds.push(id);

      const outgoing = flow.edges.filter((e) => e.source === id && !this.backEdgeIds.has(e.id));
      for (const e of outgoing) {
        if (!visited.has(e.target) && !stopIds.has(e.target)) {
          queue.push(e.target);
        }
      }
    }

    return bodyIds;
  }

  /**
   * Build a repeat: YAML block from a detected repeat pattern
   */
  private buildRepeatBlock(
    flow: FlowGraph,
    pattern: RepeatPattern,
    visited: Set<string>
  ): Record<string, unknown> | null {
    // Mark all pattern nodes as visited
    for (const id of pattern.conditionNodeIds) visited.add(id);
    for (const id of pattern.bodyNodeIds) visited.add(id);
    if (pattern.initNodeId) visited.add(pattern.initNodeId);
    if (pattern.incrementNodeId) visited.add(pattern.incrementNodeId);
    visited.add(pattern.entryNodeId);

    // Build the body sequence
    const bodySequence: unknown[] = [];
    for (const bodyNodeId of pattern.bodyNodeIds) {
      const bodyNode = this.getNode(flow, bodyNodeId);
      if (!bodyNode) continue;

      if (bodyNode.type === 'condition') {
        // Check if this condition has branching within the loop body
        const outgoing = flow.edges.filter(
          (e) => e.source === bodyNodeId && !this.backEdgeIds.has(e.id)
        );
        const truePath = outgoing.find((e) => e.sourceHandle === 'true');
        const falsePath = outgoing.find((e) => e.sourceHandle === 'false');

        if (truePath || falsePath) {
          // Build as if/then/else within the loop body
          const condAction: Record<string, unknown> = {
            if: [this.buildCondition(bodyNode as ConditionNode)],
            then: [],
            else: [],
          };
          if (truePath && pattern.bodyNodeIds.includes(truePath.target)) {
            condAction.then = this.buildBodySubsequence(flow, truePath.target, pattern, visited);
          }
          if (falsePath && pattern.bodyNodeIds.includes(falsePath.target)) {
            condAction.else = this.buildBodySubsequence(flow, falsePath.target, pattern, visited);
          }
          bodySequence.push(condAction);
        } else {
          // Inline condition guard
          bodySequence.push(this.buildCondition(bodyNode as ConditionNode));
        }
      } else {
        const action = this.buildNodeAction(bodyNode);
        if (action) {
          bodySequence.push(action);
        }
      }
    }

    // The repeat block's own alias/note ride on the first condition node
    // (while/until, via the dedicated `blockAlias`/`blockNote` fields — the
    // block's own alias is never confused with a while/until condition's
    // own alias, which is a different field) or on the counter-init node
    // (count, which has no such ambiguity since it's a synthetic node with
    // no separate "own alias" of its own).
    let alias: string | undefined;
    let note: string | undefined;

    if (pattern.type === 'while') {
      // Build while conditions
      const whileConditions = pattern.conditionNodeIds.map((id) => {
        const node = this.getNode(flow, id) as ConditionNode;
        if (!alias && node?.data?.blockAlias) alias = node.data.blockAlias;
        if (!note && node?.data?.blockNote) note = node.data.blockNote;
        return this.buildCondition(node);
      });

      const result: Record<string, unknown> = {
        repeat: {
          while: whileConditions,
          sequence: bodySequence,
        },
      };
      if (alias) result.alias = alias;
      if (note) result.note = note;
      return result;
    }

    if (pattern.type === 'until') {
      const untilConditions = pattern.conditionNodeIds.map((id) => {
        const node = this.getNode(flow, id) as ConditionNode;
        if (!alias && node?.data?.blockAlias) alias = node.data.blockAlias;
        if (!note && node?.data?.blockNote) note = node.data.blockNote;
        return this.buildCondition(node);
      });

      const result: Record<string, unknown> = {
        repeat: {
          until: untilConditions,
          sequence: bodySequence,
        },
      };
      if (alias) result.alias = alias;
      if (note) result.note = note;
      return result;
    }

    if (pattern.type === 'count') {
      if (pattern.initNodeId) {
        const initNode = this.getNode(flow, pattern.initNodeId);
        if (initNode?.data && 'alias' in initNode.data) {
          alias = initNode.data.alias as string | undefined;
        }
        if (initNode?.data && 'note' in initNode.data) {
          note = initNode.data.note as string | undefined;
        }
      }

      const result: Record<string, unknown> = {
        repeat: {
          count: pattern.count,
          sequence: bodySequence,
        },
      };
      if (alias) result.alias = alias;
      if (note) result.note = note;
      return result;
    }

    return null;
  }

  /**
   * Build a sub-sequence within a repeat body for branching paths
   */
  private buildBodySubsequence(
    flow: FlowGraph,
    startId: string,
    pattern: RepeatPattern,
    visited: Set<string>
  ): unknown[] {
    const sequence: unknown[] = [];
    let currentId: string | null = startId;

    while (currentId && pattern.bodyNodeIds.includes(currentId) && !visited.has(currentId)) {
      visited.add(currentId);
      const node = this.getNode(flow, currentId);
      if (!node) break;

      const action = this.buildNodeAction(node);
      if (action) {
        sequence.push(action);
      }

      const outgoing = flow.edges.filter(
        (e) => e.source === currentId && !this.backEdgeIds.has(e.id)
      );
      currentId = outgoing.length === 1 ? outgoing[0].target : null;
    }

    return sequence;
  }

  /**
   * Extract trigger configurations from trigger nodes
   */
  private extractTriggers(flow: FlowGraph): unknown[] {
    return flow.nodes
      .filter((n): n is TriggerNode => n.type === 'trigger')
      .map((node) => this.buildTrigger(node));
  }

  /**
   * Detect if multiple first actions form an OR pattern
   * (all are conditions whose true OR false paths converge to the same node)
   */
  private detectOrPattern(
    flow: FlowGraph,
    firstActionIds: string[]
  ): { conditions: ConditionNode[]; convergenceNode: string; isFromFalsePaths: boolean } | null {
    // All first actions must be condition nodes
    const conditions = firstActionIds.map((id) => this.getNode(flow, id));
    if (!conditions.every((n): n is ConditionNode => n?.type === 'condition')) {
      return null;
    }

    // Check if all true paths converge to the same node
    const trueTargets = new Set<string>();
    for (const cond of conditions) {
      const trueEdge = flow.edges.find((e) => e.source === cond.id && e.sourceHandle === 'true');
      if (trueEdge) {
        trueTargets.add(trueEdge.target);
      }
    }

    if (trueTargets.size === 1 && conditions.length === firstActionIds.length) {
      // All conditions have the same true target
      const convergenceNode = [...trueTargets][0];
      return {
        conditions: conditions as ConditionNode[],
        convergenceNode,
        isFromFalsePaths: false,
      };
    }

    // Check if all false paths converge to the same node
    const falseTargets = new Set<string>();
    for (const cond of conditions) {
      const falseEdge = flow.edges.find((e) => e.source === cond.id && e.sourceHandle === 'false');
      if (falseEdge) {
        falseTargets.add(falseEdge.target);
      }
    }

    if (falseTargets.size === 1 && conditions.length === firstActionIds.length) {
      // All conditions have the same false target
      const convergenceNode = [...falseTargets][0];
      return {
        conditions: conditions as ConditionNode[],
        convergenceNode,
        isFromFalsePaths: true,
      };
    }

    return null;
  }

  /**
   * Extract leading condition nodes that can be promoted to the root conditions block.
   * Only conditions with no false/else path are promotable, forming a straight chain
   * from triggers to actions via true paths only (or false paths only for inverted conditions).
   * Fan-out is allowed when only one handle type is used - the condition is promoted and
   * all fan-out targets become action starting points.
   */
  private extractLeadingConditions(
    flow: FlowGraph,
    startNodeId: string
  ): { conditions: unknown[]; nextNodeIds: string[]; visitedIds: Set<string> } {
    const conditions: unknown[] = [];
    const visitedIds = new Set<string>();
    let currentId: string | null = startNodeId;

    while (currentId) {
      const node = this.getNode(flow, currentId);
      if (!node || node.type !== 'condition') break;

      // Don't promote conditions that are part of a repeat pattern
      if (this.repeatPatterns.has(currentId) || this.repeatInternalNodeIds.has(currentId)) break;

      const allOutgoing = this.getOutgoingEdges(flow, currentId);
      const outgoing = allOutgoing.filter((e) => !this.backEdgeIds.has(e.id));
      const truePaths = outgoing.filter((edge) => edge.sourceHandle === 'true');
      const falsePaths = outgoing.filter((edge) => edge.sourceHandle === 'false');

      // Can only promote if the condition uses only ONE handle type (no branching to different outcomes)
      // If both handles are used, it's a full if/then/else and cannot be promoted
      if (truePaths.length > 0 && falsePaths.length > 0) break;
      // Must have at least one path
      if (truePaths.length === 0 && falsePaths.length === 0) break;

      // Build the condition object with alias preserved
      const condition = this.buildCondition(node as ConditionNode);
      if ((node as ConditionNode).data.alias) {
        condition.alias = (node as ConditionNode).data.alias;
      }

      if (falsePaths.length > 0) {
        // Connected via false handle only → inverted condition, wrap in "not"
        conditions.push({
          condition: 'not',
          conditions: [condition],
        });
        visitedIds.add(currentId);

        // If there's fan-out (multiple false paths), stop extraction and return all targets
        if (falsePaths.length > 1) {
          return { conditions, nextNodeIds: falsePaths.map((e) => e.target), visitedIds };
        }
        currentId = falsePaths[0].target;
      } else {
        // Connected via true handle only → promote as-is
        conditions.push(condition);
        visitedIds.add(currentId);

        // If there's fan-out (multiple true paths), stop extraction and return all targets
        if (truePaths.length > 1) {
          return { conditions, nextNodeIds: truePaths.map((e) => e.target), visitedIds };
        }
        currentId = truePaths[0].target;
      }
    }

    return { conditions, nextNodeIds: currentId ? [currentId] : [], visitedIds };
  }

  /**
   * Build a single trigger configuration
   */
  private buildTrigger(node: TriggerNode): Record<string, unknown> {
    const trigger: Record<string, unknown> = { ...node.data };

    // Clean up undefined/empty values
    return Object.fromEntries(
      Object.entries(trigger).filter(([, v]) => v !== undefined && v !== '' && v !== null)
    );
  }

  /**
   * Find condition nodes whose specified handle (true/false) points to a given target node
   * Returns the condition sources if there are multiple (OR pattern), empty array otherwise
   */
  private findOrConditionSources(
    flow: FlowGraph,
    targetNodeId: string,
    handleType: 'true' | 'false',
    visited: Set<string>
  ): ConditionNode[] {
    const sources = flow.edges
      .filter(
        (e) =>
          e.target === targetNodeId && e.sourceHandle === handleType && !this.backEdgeIds.has(e.id)
      )
      .map((e) => this.getNode(flow, e.source))
      .filter((n): n is ConditionNode => n?.type === 'condition' && !visited.has(n.id));

    return sources.length > 1 ? sources : [];
  }

  /**
   * Recursively build the action sequence that starts at `nodeId`.
   *
   * `joinId` is where the enclosing block ends (its join): building stops
   * there, because that node belongs to the steps AFTER the block.
   */
  private buildSequenceFromNode(
    flow: FlowGraph,
    nodeId: string,
    visited: Set<string>,
    joinId?: string
  ): unknown[] {
    if (visited.has(nodeId) || nodeId === joinId) {
      return []; // Avoid infinite loops / stop at the end of the enclosing block
    }

    const node = this.getNode(flow, nodeId);
    if (!node) {
      return [];
    }

    const sequence: unknown[] = [];

    // Check if this node is an OR convergence point (multiple conditions' true/false paths converge here)
    const orTrueSources = this.findOrConditionSources(flow, nodeId, 'true', visited);
    const orFalseSources = this.findOrConditionSources(flow, nodeId, 'false', visited);

    if (orTrueSources.length > 1) {
      // Multiple conditions' TRUE paths converge here - build OR block
      const orConditions = orTrueSources.map((c) => this.buildCondition(c));
      // Mark these conditions as visited
      for (const c of orTrueSources) {
        visited.add(c.id);
      }

      // Now add the current node to visited and build the then sequence
      visited.add(nodeId);
      const thenSequence =
        node.type === 'condition'
          ? this.buildSequenceFromNode(flow, nodeId, new Set(), joinId) // Process this condition node fresh
          : this.buildSequenceFromNode(flow, nodeId, new Set(visited), joinId);

      // For OR conditions, prepend the current node's action to the then sequence if it's not a condition
      let finalThenSequence: unknown[];
      if (node.type !== 'condition') {
        const currentAction = this.buildNodeAction(node);
        finalThenSequence = currentAction ? [currentAction, ...thenSequence] : thenSequence;
      } else {
        finalThenSequence = thenSequence;
      }

      sequence.push({
        if: [{ condition: 'or', conditions: orConditions }],
        then: finalThenSequence,
        else: [], // OR conditions don't have a shared else path
      });
      return sequence;
    }

    if (orFalseSources.length > 1) {
      // Multiple conditions' FALSE paths converge here - build OR block (negated logic)
      // When false paths converge, it means "if NOT cond1 AND NOT cond2" which is equivalent to "if NOT (cond1 OR cond2)"
      const orConditions = orFalseSources.map((c) => this.buildCondition(c));
      // Mark these conditions as visited
      for (const c of orFalseSources) {
        visited.add(c.id);
      }

      // Now add the current node to visited and build the then sequence
      visited.add(nodeId);
      const thenSequence =
        node.type === 'condition'
          ? this.buildSequenceFromNode(flow, nodeId, new Set(), joinId)
          : this.buildSequenceFromNode(flow, nodeId, new Set(visited), joinId);

      // For OR conditions, prepend the current node's action to the then sequence if it's not a condition
      let finalThenSequence: unknown[];
      if (node.type !== 'condition') {
        const currentAction = this.buildNodeAction(node);
        finalThenSequence = currentAction ? [currentAction, ...thenSequence] : thenSequence;
      } else {
        finalThenSequence = thenSequence;
      }

      // Since false paths converge, we negate by swapping then/else
      // "if any condition is false, do this" = "if NOT(all conditions true), do this"
      sequence.push({
        if: [{ condition: 'or', conditions: orConditions }],
        then: [], // When OR is true, we don't execute (this is the "else" in normal terms)
        else: finalThenSequence, // When OR is false (all conditions false), execute
      });
      return sequence;
    }

    // Check if this node is the entry point of a repeat pattern
    const repeatPattern = this.repeatPatterns.get(nodeId);
    if (repeatPattern) {
      const repeatBlock = this.buildRepeatBlock(flow, repeatPattern, visited);
      if (repeatBlock) {
        sequence.push(repeatBlock);
        // Continue from the exit node
        if (repeatPattern.exitNodeId) {
          const afterRepeat = this.buildSequenceFromNode(
            flow,
            repeatPattern.exitNodeId,
            new Set(visited),
            joinId
          );
          sequence.push(...afterRepeat);
        }
        return sequence;
      }
    }

    // Normal processing - add to visited now
    visited.add(nodeId);

    // Get outgoing edges (excluding repeat back-edges)
    const outgoing = this.getOutgoingEdges(flow, nodeId).filter((e) => !this.backEdgeIds.has(e.id));

    if (node.type === 'condition') {
      // ===== Condition Chain Logic =====
      // This logic identifies chains of conditions and merges them into a single 'choose'

      const conditions: unknown[] = [];
      let currentNode: FlowNode = node;
      let thenNodeIds: string[] = [];
      let elseNodeIds: string[] = [];

      // The 'else' paths are taken from the very first condition in the chain
      // Use filter to get ALL false edges, not just the first (handles fan-out patterns)
      const originalElsePaths = this.getOutgoingEdges(flow, node.id).filter(
        (edge) => edge.sourceHandle === 'false' && !this.backEdgeIds.has(edge.id)
      );
      elseNodeIds = originalElsePaths.map((edge) => edge.target);

      // Start traversing the 'true' path to find all sequential conditions
      // Only chain conditions that share the same "else" behavior (no else, or same else target)
      while (currentNode?.type === 'condition') {
        conditions.push(this.buildCondition(currentNode as ConditionNode));

        // Get ALL true paths (handles fan-out patterns where multiple conditions branch from same handle)
        const truePaths = this.getOutgoingEdges(flow, currentNode.id).filter(
          (edge) => edge.sourceHandle === 'true' && !this.backEdgeIds.has(edge.id)
        );

        if (truePaths.length === 0) {
          // No true paths - end of chain
          break;
        }

        // If there are multiple true paths (fan-out), we can't chain conditions
        // Each branch becomes a separate action in the then sequence
        if (truePaths.length > 1) {
          thenNodeIds = truePaths.map((edge) => edge.target);
          break;
        }

        // Single true path - check if we can chain to another condition
        const truePath = truePaths[0];
        const nextNode = this.getNode(flow, truePath.target);

        // If the next node is a condition and not visited, check if we should continue chaining
        // Never chain conditions that are part of a repeat pattern
        if (
          nextNode?.type === 'condition' &&
          !visited.has(nextNode.id) &&
          !this.repeatPatterns.has(nextNode.id) &&
          !this.repeatInternalNodeIds.has(nextNode.id)
        ) {
          // Check if the next condition has false paths
          const nextFalsePaths = this.getOutgoingEdges(flow, nextNode.id).filter(
            (edge) => edge.sourceHandle === 'false' && !this.backEdgeIds.has(edge.id)
          );

          // Only continue chaining if:
          // 1. The next condition has no false path (it can be merged), OR
          // 2. The next condition has exactly one false path going to one of the original else targets
          const canChain =
            nextFalsePaths.length === 0 ||
            (nextFalsePaths.length === 1 && elseNodeIds.includes(nextFalsePaths[0].target));

          if (canChain) {
            currentNode = nextNode;
            visited.add(currentNode.id); // Mark as visited to avoid re-processing
          } else {
            // The next condition has its own else branch - don't merge it
            // Instead, it becomes part of the "then" sequence as a nested if
            thenNodeIds = [truePath.target];
            break;
          }
        } else {
          // End of chain: the target is not a condition or is already visited
          thenNodeIds = [truePath.target];
          break;
        }
      }

      // Put conditions directly in the if: array - HA implicitly ANDs them
      const chooseAction: Record<string, unknown> = {
        // A step's own alias (`stepAlias`) takes precedence when present;
        // older graphs that only ever set `alias` (frontend-authored, or
        // produced before this field existed) fall back to it unchanged.
        alias: node.data.stepAlias ?? node.data.alias,
        if: conditions,
        then: [],
        else: [],
      };
      if (typeof node.data.stepNote === 'string') {
        chooseAction.note = node.data.stepNote;
      }

      // The join is where the branches meet again (the nearest node every path
      // from both of them passes through). It belongs AFTER the if/then/else
      // block rather than being duplicated inside each branch. Branches that
      // never meet (one of them stops the run) have no join.
      const join = this.findJoin([...thenNodeIds, ...elseNodeIds]);
      const branchJoin = join ?? joinId;

      const thenActions = thenNodeIds.flatMap((id) =>
        this.buildSequenceFromNode(flow, id, new Set(visited), branchJoin)
      );
      const elseActions = elseNodeIds.flatMap((id) =>
        this.buildSequenceFromNode(flow, id, new Set(visited), branchJoin)
      );
      chooseAction.then = thenActions;

      const isGuardClause =
        join === null &&
        elseNodeIds.length > 0 &&
        thenNodeIds.length > 0 &&
        thenNodeIds.every((id) => this.endsInStop(flow, id));
      if (isGuardClause) {
        // `if <condition> then: [..., stop]` followed by the rest: what follows
        // runs only when the condition fails, so it stays a sibling instead of
        // being nested into an `else:`.
        sequence.push(chooseAction, ...elseActions);
      } else {
        chooseAction.else = elseActions;
        sequence.push(chooseAction);
        if (join) {
          // Continue from the join after the condition block
          sequence.push(...this.buildSequenceFromNode(flow, join, new Set(visited), joinId));
        }
      }
    } else {
      // ===== Default Logic for Non-Condition Nodes =====
      const action = this.buildNodeAction(node);
      if (action) {
        sequence.push(action);
      }

      if (outgoing.length === 1) {
        // Single outgoing edge - continue the sequence
        const nextActions = this.buildSequenceFromNode(
          flow,
          outgoing[0].target,
          new Set(visited),
          joinId
        );
        sequence.push(...nextActions);
      } else if (outgoing.length > 1) {
        // Multiple outgoing edges (parallel paths) that meet again at their join
        const join = this.findJoin(outgoing.map((e) => e.target));
        const branchJoin = join ?? joinId;
        const filteredBranches = outgoing
          .map((edge) =>
            this.buildSequenceFromNode(flow, edge.target, new Set(visited), branchJoin)
          )
          .filter((branch) => branch.length > 0);
        if (filteredBranches.length > 0) {
          // Flatten single-action branches to avoid double-nesting (- - service:)
          sequence.push({
            parallel: filteredBranches.map((branch) => (branch.length === 1 ? branch[0] : branch)),
          });
        }
        if (join) {
          sequence.push(...this.buildSequenceFromNode(flow, join, new Set(visited), joinId));
        }
      }
    }

    return sequence;
  }

  /**
   * The join of the given branch starts: where they meet again, or null when
   * they only meet at the end of the run (a branch stops, or there is a single
   * branch).
   */
  private findJoin(branchStarts: string[]): string | null {
    if (branchStarts.length < 2) return null;
    return this.postDominators.joinOf(branchStarts);
  }

  /**
   * True when every path that starts at `startId` ends in an enabled `stop`,
   * i.e. control can never fall through to whatever follows the branch.
   */
  private endsInStop(flow: FlowGraph, startId: string, seen = new Set<string>()): boolean {
    if (seen.has(startId)) return false;
    seen.add(startId);
    const node = this.getNode(flow, startId);
    if (!node) return false;
    if (node.type === 'action' && 'stop' in node.data && node.data.enabled !== false) return true;

    const outgoing = this.getOutgoingEdges(flow, startId).filter(
      (e) => !this.backEdgeIds.has(e.id)
    );
    if (outgoing.length === 0) return false;
    // A condition with only one exit falls out of the sequence on the other
    if (node.type === 'condition' && new Set(outgoing.map((e) => e.sourceHandle)).size < 2) {
      return false;
    }
    return outgoing.every((e) => this.endsInStop(flow, e.target, new Set(seen)));
  }

  /**
   * Build action configuration for a single node
   */
  private buildNodeAction(node: FlowNode): Record<string, unknown> | null {
    switch (node.type) {
      case 'trigger':
        return null; // Triggers are handled separately

      case 'condition':
        return this.buildConditionChoose(node);

      case 'action':
        return this.buildActionCall(node);

      case 'delay':
        return this.buildDelay(node);

      case 'wait':
        return this.buildWait(node);

      case 'set_variables':
        return this.buildSetVariables(node);

      default:
        return null;
    }
  }

  /**
   * Build a choose block for a condition node
   */
  private buildConditionChoose(node: ConditionNode): Record<string, unknown> {
    // Build the full condition including any nested conditions
    const condition = this.buildCondition(node);

    const choose: Record<string, unknown> = {
      // A step's own alias (`stepAlias`) takes precedence when present;
      // older graphs that only ever set `alias` fall back to it unchanged.
      alias: node.data.stepAlias ?? node.data.alias,
      if: [condition],
      then: [], // Will be filled by the caller
      else: [], // Will be filled by the caller
    };
    if (typeof node.data.stepNote === 'string') {
      choose.note = node.data.stepNote;
    }

    // Note: 'id' for trigger conditions belongs inside the condition object, not at the if/then/else level
    // The id is already included via buildCondition's ...rest spread

    return choose;
  }

  /**
   * Map a single condition object (used for individual conditions in an array)
   */
  private mapSingleCondition(data: Record<string, unknown>): Record<string, unknown> {
    const {
      condition,
      conditions,
      alias,
      conditionAlias,
      stepAlias,
      stepNote,
      blockAlias,
      blockNote,
      template,
      ...rest
    } = data;
    const out: Record<string, unknown> = {
      condition: condition,
      ...rest,
    };
    // A condition's own alias comes ONLY from `conditionAlias` — never
    // `alias`, which may instead be an enclosing step's/block's alias
    // copied down for canvas display. Omit entirely when the source
    // condition had none, rather than fabricating it from `alias`.
    if (typeof conditionAlias === 'string') {
      out.alias = conditionAlias;
    }
    // For template conditions, ensure value_template is set from template if needed
    if (condition === 'template' && !rest.value_template && template) {
      out.value_template = template;
    }
    // Recursively map nested group conditions
    if (Array.isArray(conditions) && conditions.length > 0) {
      out.conditions = (conditions as Record<string, unknown>[])
        .map((c) => this.mapSingleCondition(c))
        .filter(
          (c) => c && (!Array.isArray(c.conditions) || (c.conditions as unknown[]).length > 0)
        );
    }
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
  }

  /**
   * Build condition configuration
   */
  private buildCondition(node: ConditionNode): Record<string, unknown> {
    // Helper to recursively map condition to condition
    function mapCondition(data: Record<string, unknown>): Record<string, unknown> {
      if (!data || typeof data !== 'object') return data;
      // Destructure and exclude 'template' - HA uses 'value_template' for template conditions
      const {
        condition,
        conditions,
        alias,
        conditionAlias,
        stepAlias,
        stepNote,
        blockAlias,
        blockNote,
        template,
        ...rest
      } = data;
      const out: Record<string, unknown> = {
        condition: condition,
        ...rest,
      };
      // A condition's own alias comes ONLY from `conditionAlias` — never
      // `alias`, which may instead be an enclosing step's/block's alias
      // copied down for canvas display. Omit entirely when the source
      // condition had none, rather than fabricating it from `alias`.
      if (typeof conditionAlias === 'string') {
        out.alias = conditionAlias;
      }
      // For template conditions, ensure value_template is set from template if needed
      if (condition === 'template' && !rest.value_template && template) {
        out.value_template = template;
      }
      // Recursively map nested group conditions
      if (Array.isArray(conditions) && conditions.length > 0) {
        out.conditions = conditions
          .map(mapCondition)
          .filter((c) => c && (!Array.isArray(c.conditions) || c.conditions.length > 0));
      }
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
    }
    return mapCondition(node.data);
  }

  /**
   * Build service call action or device action
   */
  private buildActionCall(node: ActionNode): Record<string, unknown> {
    // Check if this is a device action (needs special format)
    if (isDeviceAction(node.data.data)) {
      const deviceData = node.data.data;
      const action: Record<string, unknown> = {
        device_id: deviceData.device_id,
        domain: deviceData.domain,
        type: deviceData.type,
      };

      if (node.data.alias) {
        action.alias = node.data.alias;
      }

      // Add entity_id if present
      if (deviceData.entity_id) {
        action.entity_id = deviceData.entity_id;
      }

      // Add subtype if present
      if (deviceData.subtype) {
        action.subtype = deviceData.subtype;
      }

      // Add any additional parameters (like 'option' for select)
      const knownFields = ['type', 'device_id', 'domain', 'entity_id', 'subtype'];
      for (const [key, value] of Object.entries(deviceData)) {
        if (!knownFields.includes(key) && value !== undefined) {
          action[key] = value;
        }
      }

      if (node.data.enabled === false) {
        action.enabled = false;
      }

      if (typeof node.data.note === 'string') {
        action.note = node.data.note;
      }

      return action;
    }

    // Check if this is a fallback repeat action (opaque repeat block)
    if (node.data.repeat) {
      const repeatData = node.data.repeat;
      const action: Record<string, unknown> = {
        repeat: {
          ...(repeatData.count !== undefined ? { count: repeatData.count } : {}),
          ...(repeatData.while ? { while: repeatData.while } : {}),
          ...(repeatData.until ? { until: repeatData.until } : {}),
          ...(repeatData.for_each ? { for_each: repeatData.for_each } : {}),
          sequence: repeatData.sequence ?? [],
        },
      };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.enabled === false) action.enabled = false;
      if (typeof node.data.note === 'string') action.note = node.data.note;
      return action;
    }

    // Check if this is a fire event action
    if (typeof node.data.event === 'string' && node.data.event.trim() !== '') {
      const action: Record<string, unknown> = { event: node.data.event };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.event_data && Object.keys(node.data.event_data).length > 0) {
        action.event_data = node.data.event_data;
      }
      if (node.data.enabled === false) action.enabled = false;
      if (typeof node.data.note === 'string') action.note = node.data.note;
      return action;
    }

    // Check if this is a stop action
    if ('stop' in node.data) {
      const { stop, error, alias, note, enabled, id: _id, ...extraProps } = node.data;
      const action: Record<string, unknown> = { stop: stop ?? '', ...extraProps };
      if (alias) action.alias = alias;
      if (error === true) action.error = true;
      if (enabled === false) action.enabled = false;
      if (typeof note === 'string') action.note = note;
      return action;
    }

    // Standard service call format
    // Use spread pattern to preserve unknown properties from custom integrations
    const {
      alias,
      service,
      // `id` is intentionally dropped (not just excluded from extraProps) —
      // HA's action-step schemas (service call, delay, wait, set_variables)
      // don't support a per-step `id:` at all; only triggers do. Real HA
      // rejects it outright ("extra keys not allowed"), so it can't be
      // preserved even for round-trip fidelity.
      id: _id,
      target,
      data,
      data_template,
      response_variable,
      continue_on_error,
      enabled,
      repeat: _repeat,
      ...extraProps
    } = node.data;
    const action: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      service,
    };

    if (target) {
      action.target = target;
    }

    if (data) {
      action.data = data;
    }

    if (data_template) {
      action.data_template = data_template;
    }

    if (response_variable) {
      action.response_variable = response_variable;
    }

    if (continue_on_error) {
      action.continue_on_error = continue_on_error;
    }

    if (enabled === false) {
      action.enabled = false;
    }

    return action;
  }

  /**
   * Build delay action
   */
  private buildDelay(node: DelayNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, delay: delayValue, id: _id, ...extraProps } = node.data;
    const delay: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      delay: delayValue,
    };

    return delay;
  }

  /**
   * Build wait action
   */
  private buildWait(node: WaitNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const {
      alias,
      id: _id,
      wait_template,
      wait_for_trigger,
      timeout,
      continue_on_timeout,
      ...extraProps
    } = node.data;
    const wait: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
    };

    if (wait_template) {
      wait.wait_template = wait_template;
    } else if (wait_for_trigger) {
      wait.wait_for_trigger = wait_for_trigger.map((triggerData) => {
        const trigger: Record<string, unknown> = { ...triggerData };
        return Object.fromEntries(
          Object.entries(trigger).filter(([, v]) => v !== undefined && v !== '' && v !== null)
        );
      });
    }

    if (timeout) {
      wait.timeout = timeout;
    }

    if (continue_on_timeout !== undefined) {
      wait.continue_on_timeout = continue_on_timeout;
    }

    return wait;
  }

  /**
   * Build set variables action
   */
  private buildSetVariables(node: SetVariablesNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, id: _id, variables, ...extraProps } = node.data;
    const setVars: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      variables,
    };

    if (alias) {
      setVars.alias = alias;
    }

    return setVars;
  }
}
