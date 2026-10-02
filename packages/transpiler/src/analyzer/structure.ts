import type { FlowEdge, FlowGraph, FlowNode } from '@flow/shared';

/**
 * Structured control flow.
 *
 * Every Home Assistant automation is built from nested blocks (if / choose /
 * parallel / repeat), so its flow graph is *structured*: every branching node
 * opens a region that closes again at a single join node, and nothing enters
 * or leaves the region sideways. Branches that end in `stop` simply never
 * reach the join.
 *
 * Post-dominators make that precise and are what the native generator needs:
 * the join of a branching node is its immediate post-dominator, the nearest
 * node that every path leaving it must pass through.
 */

/** Virtual node that every path ends in (a `stop`, or simply the last step). */
export const EXIT_NODE = '__exit__';

export interface PostDominators {
  /** Immediate post-dominator of every node; `EXIT_NODE` when paths only meet at the end. */
  readonly ipdom: ReadonlyMap<string, string>;
  /** Nodes after which the run always ends: an enabled `stop`, or every path leads to one. */
  readonly dead: ReadonlySet<string>;
  /**
   * Where the branches that START at `starts` come together again, or null when they never do.
   * A branch that always ends in `stop` never comes back, so it does not count: the join of a
   * branch that stops and one that goes on is nothing (the one that goes on simply continues),
   * and a stopping branch does not hide the join of the others.
   */
  joinOf(starts: readonly string[]): string | null;
}

/** A `stop` that is switched on ends the run; a disabled one does nothing. */
export function isEnabledStop(node: FlowNode): boolean {
  return node.type === 'action' && 'stop' in node.data && node.data.enabled !== false;
}

/** Forward adjacency (targets deduplicated) ignoring the given edges, e.g. loop back-edges. */
function forwardAdjacency(
  flow: FlowGraph,
  ignoredEdgeIds: ReadonlySet<string>
): { successors: Map<string, string[]>; predecessors: Map<string, string[]> } {
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const node of flow.nodes) {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  }
  for (const edge of flow.edges) {
    if (ignoredEdgeIds.has(edge.id)) continue;
    const out = successors.get(edge.source);
    const into = predecessors.get(edge.target);
    if (!out || !into || out.includes(edge.target)) continue;
    out.push(edge.target);
    into.push(edge.source);
  }
  return { successors, predecessors };
}

/** Post-order over the forward edges: every node comes after all of its successors. */
function postOrder(nodeIds: readonly string[], successors: Map<string, string[]>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const next of successors.get(id) ?? []) visit(next);
    order.push(id);
  };
  for (const id of nodeIds) visit(id);
  return order;
}

interface PostDominatorTree {
  ipdom: Map<string, string>;
  joinOf(starts: readonly string[]): string | null;
}

/** The post-dominator tree of the forward edges. */
function buildTree(flow: FlowGraph, ignoredEdgeIds: ReadonlySet<string>): PostDominatorTree {
  const { successors } = forwardAdjacency(flow, ignoredEdgeIds);
  const ipdom = new Map<string, string>([[EXIT_NODE, EXIT_NODE]]);
  const depth = new Map<string, number>([[EXIT_NODE, 0]]);

  // Nearest common ancestor of a and b in the post-dominator tree
  const meet = (a: string, b: string): string => {
    let x = a;
    let y = b;
    while (x !== y) {
      const dx = depth.get(x) ?? 0;
      const dy = depth.get(y) ?? 0;
      if (dx >= dy) x = ipdom.get(x) ?? EXIT_NODE;
      if (dy >= dx) y = ipdom.get(y) ?? EXIT_NODE;
    }
    return x;
  };

  for (const id of postOrder(
    flow.nodes.map((n) => n.id),
    successors
  )) {
    let parent: string | undefined;
    for (const next of successors.get(id) ?? []) {
      if (!depth.has(next)) continue; // only possible on a cycle that was not excluded
      parent = parent === undefined ? next : meet(parent, next);
    }
    const resolved = parent ?? EXIT_NODE;
    ipdom.set(id, resolved);
    depth.set(id, (depth.get(resolved) ?? 0) + 1);
  }

  return {
    ipdom,
    joinOf(starts) {
      let join: string | undefined;
      for (const start of starts) {
        if (!depth.has(start)) continue;
        join = join === undefined ? start : meet(join, start);
      }
      return join === undefined || join === EXIT_NODE ? null : join;
    },
  };
}

/**
 * The nodes after which the run always ends: an enabled `stop`, or a node whose every way on
 * leads to one (a condition only counts when both of its handles lead somewhere: with one of
 * them free, the run can fall out of the sequence on the other).
 */
function findDeadNodes(flow: FlowGraph, ignoredEdgeIds: ReadonlySet<string>): Set<string> {
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    if (ignoredEdgeIds.has(edge.id)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const dead = new Set<string>();
  const live = new Set<string>();
  const inProgress = new Set<string>();

  const isDead = (id: string): boolean => {
    if (dead.has(id)) return true;
    const node = byId.get(id);
    if (!node || live.has(id) || inProgress.has(id)) return false;
    let result = isEnabledStop(node);
    const out = outgoing.get(id) ?? [];
    if (!result && out.length > 0) {
      inProgress.add(id);
      const handles = new Set(out.map((edge) => edge.sourceHandle));
      const everyWayOn = node.type !== 'condition' || (handles.has('true') && handles.has('false'));
      result = everyWayOn && out.every((edge) => isDead(edge.target));
      inProgress.delete(id);
    }
    (result ? dead : live).add(id);
    return result;
  };

  for (const node of flow.nodes) isDead(node.id);
  return dead;
}

export function computePostDominators(
  flow: FlowGraph,
  ignoredEdgeIds: ReadonlySet<string> = new Set()
): PostDominators {
  const tree = buildTree(flow, ignoredEdgeIds);
  const dead = findDeadNodes(flow, ignoredEdgeIds);
  // Paths that lead into a dead node do not count when looking for where the live branches meet.
  const deadEdgeIds = flow.edges.filter((edge) => dead.has(edge.target)).map((edge) => edge.id);
  const liveTree =
    deadEdgeIds.length === 0 ? tree : buildTree(flow, new Set([...ignoredEdgeIds, ...deadEdgeIds]));

  return {
    ipdom: tree.ipdom,
    dead,
    joinOf(starts) {
      const distinct = [...new Set(starts)];
      if (distinct.length < 2) return null;
      // Branches that all reach one node (even a `stop`) end there; only when they do not, the
      // branches that stop on their own are left out.
      const live = distinct.filter((start) => !dead.has(start));
      return tree.joinOf(distinct) ?? (live.length < 2 ? null : liveTree.joinOf(live));
    },
  };
}

/**
 * True when every branching node opens a region that is entered only at the
 * branching node and left only at its join (or by ending the run). That is
 * exactly the shape a nested HA automation has, so it can be written back as
 * nested YAML without a state machine.
 */
export function isStructuredFlow(
  flow: FlowGraph,
  ignoredEdgeIds: ReadonlySet<string>,
  postDominators: PostDominators
): boolean {
  const { successors, predecessors } = forwardAdjacency(flow, ignoredEdgeIds);

  for (const [branchId, targets] of successors) {
    if (targets.length < 2) continue;
    const join = postDominators.ipdom.get(branchId) ?? EXIT_NODE;
    // When the other branches stop, what follows the block hangs off the one branch that goes on:
    // that branch is the continuation, not a region of its own.
    const live = targets.filter((id) => !postDominators.dead.has(id));
    const seeds =
      join === EXIT_NODE && live.length === 1 ? targets.filter((id) => id !== live[0]) : targets;

    const region = new Set<string>();
    const pending = [...seeds];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (id === join || region.has(id)) continue;
      region.add(id);
      pending.push(...(successors.get(id) ?? []));
    }

    for (const id of region) {
      for (const from of predecessors.get(id) ?? []) {
        if (from !== branchId && !region.has(from)) return false;
      }
    }
  }
  return true;
}
