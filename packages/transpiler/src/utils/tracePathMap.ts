/**
 * Bidirectional mapping between Home Assistant automation trace step paths
 * (e.g. `action/0/choose/1/conditions/0`) and the canvas node IDs the
 * `YamlParser` created while walking the same YAML structure.
 *
 * Built once per parse (see `YamlParser.parse`'s `ParseResult.nodePathMap`)
 * and consumed by the live trace view to highlight the canvas node a
 * running automation's trace step currently corresponds to.
 */
export interface TracePathMap {
  /** Trace path -> canvas node id. */
  pathToNode: Record<string, string>;
  /** Canvas node id -> every trace path that resolves to it, primary path first. */
  nodeToPaths: Record<string, string[]>;
}

/**
 * Resolve a live Home Assistant trace step path to the canvas node id it
 * corresponds to.
 *
 * Resolution order:
 * 1. Exact match against `map.pathToNode`.
 * 2. Ancestor walk: strip the path one trailing `/segment` at a time until a
 *    mapped ancestor path is found (e.g. `action/0/if/condition/0` falls
 *    back to a node mapped at `action/0`).
 * 3. Unique descendant: if every mapped path nested under `stepPath` (i.e.
 *    every path starting with `${stepPath}/`) resolves to the same node id,
 *    return that node id.
 * 4. Otherwise `null` — the step doesn't correspond to any known node.
 */
export function resolveTracePath(map: TracePathMap, stepPath: string): string | null {
  const direct = map.pathToNode[stepPath];
  if (direct !== undefined) return direct;

  // Ancestor walk: strip one trailing `/segment` at a time.
  let path = stepPath;
  let slashIndex = path.lastIndexOf('/');
  while (slashIndex !== -1) {
    path = path.slice(0, slashIndex);
    const ancestor = map.pathToNode[path];
    if (ancestor !== undefined) return ancestor;
    slashIndex = path.lastIndexOf('/');
  }

  // Unique descendant: every mapped path nested under stepPath must agree
  // on a single node id.
  const prefix = `${stepPath}/`;
  let uniqueNodeId: string | null = null;
  for (const candidatePath in map.pathToNode) {
    if (!candidatePath.startsWith(prefix)) continue;
    const nodeId = map.pathToNode[candidatePath];
    if (uniqueNodeId === null) {
      uniqueNodeId = nodeId;
    } else if (uniqueNodeId !== nodeId) {
      return null;
    }
  }

  return uniqueNodeId;
}

/**
 * Accumulates `pathToNode` / `nodeToPaths` associations while `YamlParser`
 * walks an automation, then produces the finished `TracePathMap`.
 *
 * A single node is often reachable from more than one trace path — e.g. an
 * `if` action's own condition node is both the wrapper `action/{i}` step
 * and `action/{i}/if/condition/0`. The first path recorded for a node is
 * treated as that node's primary path (`nodeToPaths[id][0]`).
 */
export class PathRecorder {
  private readonly pathToNode = new Map<string, string>();
  private readonly nodeToPaths = new Map<string, string[]>();

  /** Record that `path` resolves to `nodeId`. Safe to call more than once per node. */
  record(nodeId: string, path: string): void {
    // A trace path can only ever mean one node; first writer wins so a
    // broader, secondary recording never clobbers an earlier, more specific
    // one for the same path.
    if (!this.pathToNode.has(path)) {
      this.pathToNode.set(path, nodeId);
    }

    const paths = this.nodeToPaths.get(nodeId);
    if (paths) {
      if (!paths.includes(path)) paths.push(path);
    } else {
      this.nodeToPaths.set(nodeId, [path]);
    }
  }

  /** Produce the finished, immutable-shape TracePathMap. */
  toTracePathMap(): TracePathMap {
    return {
      pathToNode: Object.fromEntries(this.pathToNode),
      nodeToPaths: Object.fromEntries(this.nodeToPaths),
    };
  }
}
