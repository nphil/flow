import type { FlowEdge, FlowGraph, FlowNode } from '@flow/shared';
import { firstSafeFix, lintFlowGraph, type ReadabilityFinding } from '@flow/transpiler';
import { logger } from '@/lib/logger';
import type { FlowState } from '@/store/flow-store';

/**
 * Readability assistant glue: turns the editor's store into the graph the lint engine reads and
 * keeps the (somewhat costly) lint result cached, so that dragging a node or selecting one never
 * re-runs it.
 */
const NODE_TYPES: Record<string, true> = {
  trigger: true,
  condition: true,
  action: true,
  delay: true,
  wait: true,
  set_variables: true,
};

/** The slice of the store the lint graph is built from (kept narrow so tests need no full store). */
export type LintGraphSource = Pick<
  FlowState,
  | 'nodes'
  | 'edges'
  | 'flowId'
  | 'flowName'
  | 'flowDescription'
  | 'flowMetadata'
  | 'userVariables'
  | 'userTriggerVariables'
>;

/**
 * The editor's state as the FlowGraph the lint engine and its fixes work on.
 *
 * Deliberately NOT `toFlowGraph()`: that one fills in defaults for the sake of saving (it gives an
 * action without `service` — a `stop` step, say — the service `light.turn_on`), which would make
 * such steps look like they switch a light and would hand fixes a graph that differs from the
 * canvas. Here every node keeps the very same `data` object the canvas holds, so a node that a
 * fix leaves alone stays reference-equal and `applyGraphEdit` can skip it.
 */
export function buildLintGraph(state: LintGraphSource): FlowGraph {
  const nodes = state.nodes
    .filter((node) => node.type !== undefined && Object.hasOwn(NODE_TYPES, node.type))
    .map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      // Same boundary `toFlowGraph` crosses: the store keeps loosely typed data per node type.
      data: node.data,
    })) as FlowNode[];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = state.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: typeof edge.label === 'string' ? edge.label : undefined,
    })) as FlowEdge[];

  return {
    id: state.flowId,
    name: state.flowName,
    description: state.flowDescription || undefined,
    nodes,
    edges,
    metadata: state.flowMetadata,
    version: 1,
    userVariables: state.userVariables,
    userTriggerVariables: state.userTriggerVariables,
  };
}

export interface ReadabilityReport {
  /** The graph that was linted. Node positions can be a little stale (they do not matter here). */
  graph: FlowGraph;
  nodeCount: number;
  findings: ReadabilityFinding[];
  /** Severity `warning`: "worth fixing". */
  warnings: ReadabilityFinding[];
  /** Severity `info`: suggestions. */
  suggestions: ReadabilityFinding[];
  /** How many findings have a fix that "Fix all safe" would apply. */
  safeFixCount: number;
  byNodeId: ReadonlyMap<string, ReadabilityFinding[]>;
  /** Warnings only, joined into the text for the node's warning dot. */
  warningSummaryByNodeId: ReadonlyMap<string, string>;
}

interface CacheEntry {
  nodes: LintGraphSource['nodes'];
  keys: ReadonlyArray<{ id: string; type: string | undefined; data: unknown }>;
  edges: LintGraphSource['edges'];
  flowName: string;
  flowDescription: string;
  report: ReadabilityReport;
}

let cache: CacheEntry | undefined;

function sameInputs(entry: CacheEntry, state: LintGraphSource): boolean {
  if (
    entry.edges !== state.edges ||
    entry.flowName !== state.flowName ||
    entry.flowDescription !== state.flowDescription
  ) {
    return false;
  }
  if (entry.nodes === state.nodes) return true;
  if (entry.keys.length !== state.nodes.length) return false;
  return state.nodes.every((node, index) => {
    const key = entry.keys[index];
    return key.id === node.id && key.type === node.type && key.data === node.data;
  });
}

function buildReport(state: LintGraphSource): ReadabilityReport {
  const graph = buildLintGraph(state);
  let findings: ReadabilityFinding[] = [];
  try {
    findings = lintFlowGraph(graph);
  } catch (error) {
    // A bug in a rule must never blank the editor: report nothing instead.
    logger.error('Readability check failed', error);
  }

  const byNodeId = new Map<string, ReadabilityFinding[]>();
  const warningMessages = new Map<string, string[]>();
  for (const finding of findings) {
    if (finding.nodeId === undefined) continue;
    const list = byNodeId.get(finding.nodeId);
    if (list) list.push(finding);
    else byNodeId.set(finding.nodeId, [finding]);
    if (finding.severity === 'warning') {
      const messages = warningMessages.get(finding.nodeId);
      if (messages) messages.push(finding.message);
      else warningMessages.set(finding.nodeId, [finding.message]);
    }
  }

  return {
    graph,
    nodeCount: graph.nodes.length,
    findings,
    warnings: findings.filter((finding) => finding.severity === 'warning'),
    suggestions: findings.filter((finding) => finding.severity === 'info'),
    safeFixCount: findings.filter((finding) => firstSafeFix(finding) !== undefined).length,
    byNodeId,
    warningSummaryByNodeId: new Map(
      [...warningMessages].map(([nodeId, messages]) => [nodeId, messages.join('\n')])
    ),
  };
}

/**
 * The readability report for the current editor state. Memoised on exactly what the lint reads
 * (each node's id, type and data reference, the edges, the name and the description), so it
 * returns the SAME object while those are unchanged — which a node drag or a selection
 * never touches. Stable output is what lets zustand selectors call this safely.
 */
export function readabilityOf(state: LintGraphSource): ReadabilityReport {
  if (cache && sameInputs(cache, state)) return cache.report;
  const report = buildReport(state);
  cache = {
    nodes: state.nodes,
    keys: state.nodes.map((node) => ({ id: node.id, type: node.type, data: node.data })),
    edges: state.edges,
    flowName: state.flowName,
    flowDescription: state.flowDescription,
    report,
  };
  return report;
}

/** Drops the memo (tests only). */
export function resetReadabilityCache(): void {
  cache = undefined;
}
