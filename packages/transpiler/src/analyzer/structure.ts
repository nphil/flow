import type { FlowGraph } from '@flow/shared';

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
  /**
   * The nearest node that every path from all of `starts` passes through, or
   * null when they only meet at the end of the run (e.g. one branch stops).
   */
  joinOf(starts: readonly string[]): string | null;
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

export function computePostDominators(
  flow: FlowGraph,
  ignoredEdgeIds: ReadonlySet<string> = new Set()
): PostDominators {
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

    const region = new Set<string>();
    const pending = [...targets];
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
