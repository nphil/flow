import type {
  ConditionNode,
  FlowEdge,
  FlowGraph,
  FlowNode,
  NodeHints,
  ParallelBranchHint,
} from '@flow/shared';
import { readNodeHints } from '@flow/shared';
import { computePostDominators, type PostDominators } from '../analyzer/structure';
import { findBackEdges } from '../analyzer/topology';

/**
 * Turns the flat flow graph back into Home Assistant's nested steps.
 *
 * A step list is built recursively: `buildSequence` walks from a node along its edges and returns
 * the steps; a branching node (condition, fan-out) builds each of its branches with a nested
 * `buildSequence` and then continues with whatever comes after the block.
 *
 * Several different step trees draw the same graph, so the builder reads the hints the parser left
 * on the nodes (see `NodeHints`): a `choose` against an `if/else` ladder, an inline condition step
 * against an `if` wrapping the rest, where a loop's conditions end, which parallel branch a node
 * opens, and where a block ends when one of its branches stops. A hint is only believed while it
 * agrees with the graph; a graph without hints (drawn on the canvas) is read from its edges alone.
 */

export interface StepBuilderHooks {
  /** The step a non-condition node stands for (null when it stands for nothing). */
  buildNodeAction(node: FlowNode): unknown;
  /** A condition node's condition: nested groups included, aliases in place, hints removed. */
  buildCondition(node: ConditionNode): Record<string, unknown>;
}

/** The step lists of an automation: its own `conditions:` and its `actions:`. */
export interface BuiltActions {
  rootConditions: unknown[] | null;
  actions: unknown[];
  warnings: string[];
}

interface Ctx {
  /** Nesting level of the list being built (the parser's `stepDepth`). */
  level: number;
  /** Where the enclosing block ends: reaching it ends the list. */
  joinId: string | undefined;
  /** Believe `stepDepth`: a node that sits above this list is not part of it. */
  hints: boolean;
}

/** A built list of steps, and the node it stopped at because that node belongs to what follows. */
interface Built {
  steps: unknown[];
  end: string | null;
}

type StepOut =
  | { kind: 'step'; steps: unknown[]; next: string[] }
  | { kind: 'end'; at: string | null };

/** One `repeat` loop, found from the loop hints (or, for graphs without them, from its back-edge). */
interface Loop {
  kind: 'while' | 'until' | 'count';
  /** Every node of the loop's own machinery (tests, counter set-up, increment, check). */
  nodeIds: string[];
  /** The tests of `while` / `until`, in order. */
  conditions: string[];
  /** First nodes of the loop body. */
  bodyStarts: string[];
  /** The body ends when it reaches this node (`until`: its first test, `count`: the increment). */
  tailId?: string;
  /** Where control goes once the loop is done. */
  exitStarts: string[];
  /** `count`: the counter set-up, which also carries the loop's alias / note. */
  initId?: string;
  count?: number | string;
}

/** A step with the alias / note / enabled of the block that owns it. */
interface BlockProps {
  alias?: string;
  note?: string;
  enabled?: false | string;
}

/** The nodes that start one branch of a fan-out, and what its first node says about the branch. */
interface BranchGroup {
  starts: string[];
  hint?: ParallelBranchHint;
}

const TOP: Ctx = { level: 0, joinId: undefined, hints: false };

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function defined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/** A step's own keys first, in the order Home Assistant's editor writes them. */
function withBlockProps(props: BlockProps, body: Record<string, unknown>): Record<string, unknown> {
  return defined({ alias: props.alias, note: props.note, enabled: props.enabled, ...body });
}

export class SequenceBuilder {
  private readonly nodes: Map<string, FlowNode>;
  /** Outgoing edges that are not loop back-edges, in edge order. */
  private readonly forwardOut = new Map<string, FlowEdge[]>();
  private readonly backEdgeIds: Set<string>;
  private readonly structure: PostDominators;
  private readonly hintCache = new Map<string, NodeHints>();
  /** Loops by the node a walk reaches first. */
  private readonly loops = new Map<string, Loop>();
  private readonly loopMembers = new Set<string>();
  /** Nodes already turned into a step: nothing is ever written twice. */
  private readonly emitted = new Set<string>();
  /** Loops whose body is being built. */
  private readonly activeLoops = new Set<Loop>();

  constructor(
    private readonly flow: FlowGraph,
    private readonly hooks: StepBuilderHooks
  ) {
    this.nodes = new Map(flow.nodes.map((node) => [node.id, node]));
    this.backEdgeIds = findBackEdges(flow);
    for (const edge of flow.edges) {
      if (this.backEdgeIds.has(edge.id)) continue;
      this.forwardOut.set(edge.source, [...(this.forwardOut.get(edge.source) ?? []), edge]);
    }
    this.structure = computePostDominators(flow, this.backEdgeIds);
    this.findLoops();
  }

  // ---------------------------------------------------------------------------
  // The automation: root conditions and the action list
  // ---------------------------------------------------------------------------

  /** The root conditions and the actions that follow the trigger nodes. */
  buildActions(triggerIds: string[]): BuiltActions {
    const firstActions = unique(triggerIds.flatMap((id) => this.targets(id)));

    if (firstActions.length === 1) {
      const promoted = this.extractLeadingConditions(firstActions[0]);
      if (promoted.conditions.length > 0) {
        return {
          rootConditions: promoted.conditions,
          actions: this.buildSequence(promoted.nextIds, TOP).steps,
          warnings: [],
        };
      }
      return {
        rootConditions: null,
        actions: this.buildSequence(firstActions, TOP).steps,
        warnings: [],
      };
    }
    if (firstActions.length === 0) {
      return {
        rootConditions: null,
        actions: [],
        warnings: ['No actions found after trigger nodes'],
      };
    }

    const hinted = firstActions.some((id) => this.hints(id).parallelPath !== undefined);
    const orPattern = hinted ? null : this.detectOrPattern(firstActions);
    if (orPattern) {
      // Several conditions that all lead to the same step: that step runs when any of them holds.
      for (const condition of orPattern.conditions) this.emitted.add(condition.id);
      const orConditions = orPattern.conditions.map((c) => this.hooks.buildCondition(c));
      const body = this.buildSequence([orPattern.convergence], TOP).steps;
      return {
        rootConditions: null,
        actions: [
          {
            if: [{ condition: 'or', conditions: orConditions }],
            then: body,
            else: [],
          },
        ],
        warnings: [],
      };
    }

    const allTriggerConditions = firstActions.every((id) => {
      const node = this.node(id);
      return node?.type === 'condition' && node.data.condition === 'trigger';
    });
    if (allTriggerConditions) {
      // Every first step is its own trigger's `if`: written one after the other, not in parallel.
      return {
        rootConditions: null,
        actions: firstActions.flatMap((id) => this.buildSequence([id], TOP).steps),
        warnings: [],
      };
    }
    return {
      rootConditions: null,
      actions: this.buildSequence(firstActions, TOP).steps,
      warnings: [],
    };
  }

  /**
   * Conditions that sit right after the triggers and have no else path belong in the automation's
   * own `conditions:` (Home Assistant then tracks "last triggered" correctly). A condition the
   * parser made from an `if`, a `choose` or an inline `- condition:` step is a step: it stays one.
   */
  private extractLeadingConditions(startId: string): { conditions: unknown[]; nextIds: string[] } {
    const conditions: unknown[] = [];
    let currentId: string | null = startId;

    while (currentId) {
      const node = this.node(currentId);
      if (node?.type !== 'condition') break;
      if (this.loops.has(currentId) || this.loopMembers.has(currentId)) break;
      const { stepDepth } = this.hints(currentId);
      if (stepDepth !== undefined && stepDepth >= 0) break;

      const truePaths = this.targets(currentId, 'true');
      const falsePaths = this.targets(currentId, 'false');
      // Only a condition that uses one of its handles can be promoted.
      if (truePaths.length > 0 && falsePaths.length > 0) break;
      if (truePaths.length === 0 && falsePaths.length === 0) break;

      const condition = this.hooks.buildCondition(node);
      if (node.data.alias) condition.alias = node.data.alias;
      this.emitted.add(currentId);

      // Connected through the false handle only: an inverted condition.
      const onward = falsePaths.length > 0 ? falsePaths : truePaths;
      conditions.push(
        falsePaths.length > 0 ? { condition: 'not', conditions: [condition] } : condition
      );
      if (onward.length > 1) return { conditions, nextIds: onward };
      currentId = onward[0];
    }
    return { conditions, nextIds: currentId ? [currentId] : [] };
  }

  /** Several first steps that are all conditions leading to one step: an `or`. */
  private detectOrPattern(
    firstActions: string[]
  ): { conditions: ConditionNode[]; convergence: string; fromFalsePaths: boolean } | null {
    const conditions = firstActions.map((id) => this.node(id));
    if (!conditions.every((node): node is ConditionNode => node?.type === 'condition')) return null;

    for (const handle of ['true', 'false'] as const) {
      const convergence = unique(conditions.flatMap((node) => this.targets(node.id, handle)));
      if (convergence.length === 1) {
        return { conditions, convergence: convergence[0], fromFalsePaths: handle === 'false' };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Walking the graph
  // ---------------------------------------------------------------------------

  private node(id: string): FlowNode | undefined {
    return this.nodes.get(id);
  }

  private hints(id: string): NodeHints {
    const cached = this.hintCache.get(id);
    if (cached) return cached;
    const node = this.node(id);
    const hints = node ? readNodeHints(node.data) : {};
    this.hintCache.set(id, hints);
    return hints;
  }

  /** Where the node's forward edges lead (through one handle, or all of them). */
  private targets(id: string, handle?: 'true' | 'false'): string[] {
    const edges = this.forwardOut.get(id) ?? [];
    return unique(
      edges
        .filter((edge) => handle === undefined || edge.sourceHandle === handle)
        .map((e) => e.target)
    );
  }

  private isDead(id: string): boolean {
    return this.structure.dead.has(id);
  }

  /**
   * The level a walk that reaches this node is at. An `until` loop is entered at the first node of
   * its body, which sits one level down, but the loop itself belongs to the level of its tests.
   */
  private levelOf(id: string): number | undefined {
    const loop = this.loops.get(id);
    const testId =
      loop && !this.activeLoops.has(loop) ? (loop.conditions[0] ?? loop.initId) : undefined;
    return this.hints(testId ?? id).stepDepth;
  }

  /** True when the node sits on a higher level than the list that is being built. */
  private isAbove(id: string, level: number): boolean {
    const nodeLevel = this.levelOf(id);
    return nodeLevel !== undefined && nodeLevel < level;
  }

  /** Why a walk must not take this node into the list it is building, if it must not. */
  private boundary(id: string, ctx: Ctx): 'join' | 'emitted' | 'above' | null {
    if (id === ctx.joinId) return 'join';
    if (this.emitted.has(id)) return 'emitted';
    return ctx.hints && this.isAbove(id, ctx.level) ? 'above' : null;
  }

  /**
   * The steps of the list that starts at `starts` (several starts are a fan-out: a parallel
   * block). `pathIndex` says how many enclosing parallel blocks already used a first node's
   * `parallelPath`.
   */
  private buildSequence(starts: string[], ctx: Ctx, pathIndex = 0): Built {
    const steps: unknown[] = [];
    let current = starts;
    let index = pathIndex;
    for (;;) {
      const out = this.buildNext(current, ctx, index);
      if (out.kind === 'end') return { steps, end: out.at };
      steps.push(...out.steps);
      current = out.next;
      index = 0;
    }
  }

  private buildNext(current: string[], ctx: Ctx, pathIndex: number): StepOut {
    const candidates = unique(current);
    const open = candidates.filter((id) => this.boundary(id, ctx) === null);
    if (open.length === 0) {
      // Everything left belongs to what follows: remember where.
      const at = candidates.find((id) => this.boundary(id, ctx) !== 'emitted');
      return { kind: 'end', at: at ?? null };
    }
    if (open.length > 1) {
      const loop = this.sharedLoop(open);
      return loop ? this.buildLoop(loop, ctx) : this.buildParallel(open, ctx, pathIndex);
    }
    return this.buildAt(open[0], ctx, pathIndex);
  }

  private buildAt(id: string, ctx: Ctx, pathIndex: number): StepOut {
    const node = this.node(id);
    if (!node) return { kind: 'end', at: null };

    const loop = this.loops.get(id);
    if (loop && !this.activeLoops.has(loop)) return this.buildLoop(loop, ctx);

    const level = this.hints(id).parallelPath?.[pathIndex];
    if (level?.count === 1) return this.buildParallel([id], ctx, pathIndex);

    if (node.type === 'condition') return this.buildConditionBlock(node, ctx);

    this.emitted.add(id);
    const step = this.hooks.buildNodeAction(node);
    return {
      kind: 'step',
      steps: step === null || step === undefined ? [] : [step],
      next: this.targets(id),
    };
  }

  // ---------------------------------------------------------------------------
  // Branching blocks
  // ---------------------------------------------------------------------------

  /**
   * Builds the branches of a block: each one a nested list that starts at its own nodes. Returns
   * where control continues once the block is done.
   *
   * When two or more branches go on (do not end in `stop`) they meet again at the join; that is
   * where the block ends. When only one goes on, the block's end cannot be seen from the edges
   * (the steps after the block hang off that one branch), so the `stepDepth` hints say where the
   * branch's own steps stop and the steps after the block begin.
   */
  private buildBranches(
    branchStarts: string[][],
    ctx: Ctx,
    pathIndex = 0
  ): { results: Built[]; next: string[] } {
    const starts = unique(branchStarts.flat());
    const live = starts.filter((id) => !this.isDead(id));
    const join = this.structure.joinOf(starts);
    const branchCtx: Ctx = {
      level: ctx.level + 1,
      joinId: join ?? ctx.joinId,
      hints: join === null && live.length <= 1,
    };
    const results = branchStarts.map((branch) => this.buildSequence(branch, branchCtx, pathIndex));

    if (join !== null) return { results, next: [join] };
    const pending = live.length === 1 ? results.find((result) => result.end !== null)?.end : null;
    return { results, next: pending ? [pending] : [] };
  }

  private buildConditionBlock(node: ConditionNode, ctx: Ctx): StepOut {
    const hints = this.hints(node.id);
    if (this.isGate(node, ctx)) return this.buildGate(node);
    if (hints.chooseBranch === 0) return this.buildChoose(node, ctx);
    return this.buildIf(node, ctx);
  }

  /**
   * An inline `- condition:` step. When it fails it ends only the list it is in, so its false
   * handle may only lead to the end of that list: a node above it, or the enclosing join.
   */
  private isGate(node: ConditionNode, ctx: Ctx): boolean {
    const { gateStep, stepDepth } = this.hints(node.id);
    if (!gateStep || stepDepth === undefined) return false;
    return this.targets(node.id, 'false').every(
      (id) => id === ctx.joinId || this.isAbove(id, stepDepth)
    );
  }

  private buildGate(node: ConditionNode): StepOut {
    this.emitted.add(node.id);
    const step = this.hooks.buildCondition(node);
    if (node.data.alias) step.alias = node.data.alias;
    return { kind: 'step', steps: [step], next: this.targets(node.id, 'true') };
  }

  /** The conditions of one `if` / choose branch: a chain of condition nodes. */
  private collectChain(first: ConditionNode): ConditionNode[] {
    const chain = [first];
    const elseTargets = this.targets(first.id, 'false');
    for (;;) {
      const last = chain[chain.length - 1];
      const onward = this.targets(last.id, 'true');
      if (onward.length !== 1) return chain;
      const next = this.node(onward[0]);
      if (next?.type !== 'condition' || this.emitted.has(next.id)) return chain;
      if (this.loops.has(next.id) || this.loopMembers.has(next.id)) return chain;

      const lastIndex = this.hints(last.id).conditionIndex;
      const nextHints = this.hints(next.id);
      if (lastIndex !== undefined) {
        // Written as one list: the next condition says it is the next one of it.
        if (nextHints.conditionIndex !== lastIndex + 1 || nextHints.chooseBranch !== undefined) {
          return chain;
        }
      } else {
        // Drawn on the canvas: conditions in a row with no else of their own are one `if` list.
        const structural =
          nextHints.gateStep ||
          nextHints.conditionIndex !== undefined ||
          nextHints.stepDepth !== undefined;
        const nextElse = this.targets(next.id, 'false');
        const sameElse =
          nextElse.length === 0 || (nextElse.length === 1 && elseTargets.includes(nextElse[0]));
        if (structural || !sameElse) return chain;
      }
      chain.push(next);
    }
  }

  /** The alias an `if` step or choose branch gets: the node's own when it was edited. */
  private stepAlias(node: ConditionNode): string | undefined {
    const { stepAlias, conditionAlias } = this.hints(node.id);
    const shown = node.data.alias;
    return shown !== conditionAlias ? shown : stepAlias;
  }

  private buildIf(first: ConditionNode, ctx: Ctx): StepOut {
    const chain = this.collectChain(first);
    for (const node of chain) this.emitted.add(node.id);
    const last = chain[chain.length - 1];
    const hints = this.hints(first.id);
    const marked = hints.conditionIndex !== undefined;

    const thenStarts = this.targets(last.id, 'true');
    const elseStarts = this.targets(first.id, 'false');
    const { results, next } = this.buildBranches([thenStarts, elseStarts], ctx);
    const [thenResult, elseResult] = results;

    const props: BlockProps = {
      alias: marked ? this.stepAlias(first) : (hints.stepAlias ?? first.data.alias),
      note: hints.stepNote,
      enabled: hints.blockEnabled,
    };
    const conditions = chain.map((node) => this.hooks.buildCondition(node));

    // Drawn on the canvas: `if C then [..., stop]` followed by steps. What follows runs only when
    // the condition fails, so it stays a sibling of the `if` instead of moving into an `else`.
    const isGuardClause =
      !marked &&
      thenStarts.length > 0 &&
      elseStarts.length > 0 &&
      next.length === 0 &&
      thenStarts.every((id) => this.isDead(id));
    if (isGuardClause) {
      const guard = withBlockProps(props, { if: conditions, then: thenResult.steps });
      return {
        kind: 'step',
        steps: [guard, ...elseResult.steps],
        next: elseResult.end ? [elseResult.end] : [],
      };
    }
    const step = withBlockProps(props, {
      if: conditions,
      then: thenResult.steps,
      else: elseResult.steps,
    });
    return { kind: 'step', steps: [step], next };
  }

  private buildChoose(first: ConditionNode, ctx: Ctx): StepOut {
    const branches: { chain: ConditionNode[]; thenStarts: string[] }[] = [];
    let head: ConditionNode | undefined = first;
    let defaultStarts: string[] = [];

    while (head) {
      const chain = this.collectChain(head);
      for (const node of chain) this.emitted.add(node.id);
      branches.push({ chain, thenStarts: this.targets(chain[chain.length - 1].id, 'true') });

      // The next branch (or the default) hangs off the first condition's false handle.
      const falseTargets = this.targets(head.id, 'false');
      const candidate = falseTargets.length === 1 ? this.node(falseTargets[0]) : undefined;
      const isNextBranch =
        candidate?.type === 'condition' &&
        !this.emitted.has(candidate.id) &&
        this.hints(candidate.id).chooseBranch === branches.length;
      head = isNextBranch ? candidate : undefined;
      defaultStarts = isNextBranch ? [] : falseTargets;
    }

    const { results, next } = this.buildBranches(
      [...branches.map((b) => b.thenStarts), defaultStarts],
      ctx
    );
    const block = this.hints(first.id);
    const choose = branches.map(({ chain }, index) => {
      const { stepNote } = this.hints(chain[0].id);
      return defined({
        alias: this.stepAlias(chain[0]),
        note: stepNote,
        conditions: chain.map((node) => this.hooks.buildCondition(node)),
        sequence: results[index].steps,
      });
    });
    const defaultSteps = results[results.length - 1].steps;
    const step = withBlockProps(
      { alias: block.blockAlias, note: block.blockNote, enabled: block.blockEnabled },
      { choose, default: defaultSteps.length > 0 ? defaultSteps : undefined }
    );
    return { kind: 'step', steps: [step], next };
  }

  // ---------------------------------------------------------------------------
  // Parallel
  // ---------------------------------------------------------------------------

  /**
   * A fan-out is a `parallel` block: each target starts a branch and the block ends where the
   * branches meet. The first node of a branch says which branch it opens (`parallelPath`), which
   * keeps a branch that itself starts with a parallel block in one piece.
   */
  private buildParallel(starts: string[], ctx: Ctx, pathIndex: number): StepOut {
    const groups = this.groupBranches(starts, pathIndex);
    const { results, next } = this.buildBranches(
      groups.map((group) => group.starts),
      ctx,
      pathIndex + 1
    );

    const branches = groups.flatMap((group, index) => {
      const { steps } = results[index];
      if (steps.length === 0) return [];
      const { alias, note } = group.hint ?? {};
      if (alias === undefined && note === undefined) {
        return [steps.length === 1 ? steps[0] : { sequence: steps }];
      }
      return [defined({ alias, note, sequence: steps })];
    });
    if (branches.length === 0) return { kind: 'step', steps: [], next };

    const block = groups.find((group) => group.hint?.branch === 0)?.hint?.block;
    return {
      kind: 'step',
      steps: [withBlockProps(block ?? {}, { parallel: branches })],
      next,
    };
  }

  /** The branches of a fan-out: starts that open the same branch belong together. */
  private groupBranches(starts: string[], pathIndex: number): BranchGroup[] {
    const groups: BranchGroup[] = [];
    for (const id of starts) {
      const hint = this.hints(id).parallelPath?.[pathIndex];
      const group = hint ? groups.find((g) => g.hint?.branch === hint.branch) : undefined;
      if (group) group.starts.push(id);
      else groups.push({ starts: [id], hint });
    }
    const position = (group: BranchGroup): number => group.hint?.branch ?? Number.MAX_SAFE_INTEGER;
    return groups
      .map((group, order) => ({ group, order }))
      .sort((a, b) => position(a.group) - position(b.group) || a.order - b.order)
      .map(({ group }) => group);
  }

  // ---------------------------------------------------------------------------
  // Loops
  // ---------------------------------------------------------------------------

  /** The loop all of these starts are the entry of (a body that starts with a parallel block). */
  private sharedLoop(starts: string[]): Loop | undefined {
    const loop = this.loops.get(starts[0]);
    const shared = loop && starts.every((id) => this.loops.get(id) === loop);
    return shared && !this.activeLoops.has(loop) ? loop : undefined;
  }

  private buildLoop(loop: Loop, ctx: Ctx): StepOut {
    for (const id of loop.nodeIds) this.emitted.add(id);

    // An `until` loop is entered at its body's first node: while its body is built, that node
    // is the body, not the loop again.
    this.activeLoops.add(loop);
    const body = this.buildSequence(loop.bodyStarts, {
      level: ctx.level + 1,
      joinId: loop.tailId,
      hints: false,
    });
    this.activeLoops.delete(loop);
    const conditions = loop.conditions.flatMap((id) => {
      const node = this.node(id);
      return node?.type === 'condition' ? [this.hooks.buildCondition(node)] : [];
    });

    let test: Record<string, unknown>;
    let props: BlockProps;
    if (loop.kind === 'count') {
      test = { count: loop.count };
      const init = loop.initId ? this.node(loop.initId) : undefined;
      const { blockEnabled } = loop.initId ? this.hints(loop.initId) : {};
      props = { alias: init?.data.alias, note: init?.data.note, enabled: blockEnabled };
    } else {
      test = { [loop.kind]: conditions };
      const first = this.hints(loop.conditions[0]);
      props = { alias: first.blockAlias, note: first.blockNote, enabled: first.blockEnabled };
    }
    const step = { repeat: { ...test, sequence: body.steps } };
    return {
      kind: 'step',
      steps: [defined({ ...step, alias: props.alias, note: props.note, enabled: props.enabled })],
      next: loop.exitStarts,
    };
  }

  /** Finds every loop: from the loop hints, then (for older graphs) from the back-edges alone. */
  private findLoops(): void {
    this.findWhileLoops();
    this.findUntilLoops();
    this.findCountLoops();
    this.findLegacyLoops();
  }

  private register(loop: Loop, entries: string[]): void {
    for (const id of loop.nodeIds) this.loopMembers.add(id);
    for (const entry of entries) this.loops.set(entry, loop);
  }

  /** True when `next` is the test that follows `prev` in the same loop's list of tests. */
  private followsInList(prev: string, next: string): boolean {
    const nextIndex = this.hints(next).conditionIndex;
    return nextIndex !== undefined && nextIndex === (this.hints(prev).conditionIndex ?? -1) + 1;
  }

  /** The tests of a loop: the chain of `loopRole` nodes that starts at `head`. */
  private testChain(head: string, role: 'while' | 'until'): string[] {
    const chain = [head];
    for (;;) {
      const last = chain[chain.length - 1];
      const onward = this.targets(last, 'true').filter(
        (id) =>
          this.hints(id).loopRole === role && this.followsInList(last, id) && !chain.includes(id)
      );
      if (onward.length !== 1) return chain;
      chain.push(onward[0]);
    }
  }

  /** Loop tests that no other test of the same loop leads to. */
  private testHeads(role: 'while' | 'until'): string[] {
    const tests = this.flow.nodes.filter((node) => this.hints(node.id).loopRole === role);
    const following = new Set(
      tests.flatMap((node) =>
        this.targets(node.id, 'true').filter((id) => this.followsInList(node.id, id))
      )
    );
    return tests.map((node) => node.id).filter((id) => !following.has(id));
  }

  private findWhileLoops(): void {
    for (const head of this.testHeads('while')) {
      const conditions = this.testChain(head, 'while');
      const last = conditions[conditions.length - 1];
      this.register(
        {
          kind: 'while',
          nodeIds: conditions,
          conditions,
          bodyStarts: this.targets(last, 'true').filter((id) => !conditions.includes(id)),
          exitStarts: this.targets(head, 'false'),
        },
        [head]
      );
    }
  }

  private findUntilLoops(): void {
    for (const head of this.testHeads('until')) {
      const conditions = this.testChain(head, 'until');
      const last = conditions[conditions.length - 1];
      // Every test loops back to the body's start on its false handle: that is the back-edge.
      const bodyStarts = unique(
        conditions.flatMap((id) =>
          this.flow.edges
            .filter(
              (e) => e.source === id && e.sourceHandle === 'false' && this.backEdgeIds.has(e.id)
            )
            .map((e) => e.target)
        )
      );
      this.register(
        {
          kind: 'until',
          nodeIds: conditions,
          conditions,
          bodyStarts,
          tailId: head,
          exitStarts: this.targets(last, 'true'),
        },
        bodyStarts.length > 0 ? bodyStarts : [head]
      );
    }
  }

  private findCountLoops(): void {
    for (const node of this.flow.nodes) {
      if (this.hints(node.id).loopRole !== 'count-check') continue;
      const check = node.id;
      const backTargets = unique(
        this.flow.edges
          .filter(
            (e) => e.source === check && e.sourceHandle === 'true' && this.backEdgeIds.has(e.id)
          )
          .map((e) => e.target)
      );
      const step = this.flow.edges
        .filter((e) => e.target === check && !this.backEdgeIds.has(e.id))
        .map((e) => e.source)
        .find((id) => this.hints(id).loopRole === 'count-step');
      const init = this.flow.nodes.find(
        (candidate) =>
          this.hints(candidate.id).loopRole === 'count-init' &&
          backTargets.length > 0 &&
          backTargets.every((target) => this.targets(candidate.id).includes(target))
      );
      if (!step || !init) continue;

      const bodyStarts = backTargets.filter((id) => id !== step);
      this.register(
        {
          kind: 'count',
          nodeIds: [init.id, step, check],
          conditions: [],
          bodyStarts,
          tailId: step,
          exitStarts: this.targets(check, 'false'),
          initId: init.id,
          count: this.hints(init.id).loopCount,
        },
        [init.id]
      );
    }
  }

  /**
   * Graphs from before the loop hints (and loops drawn on the canvas) carry nothing but their
   * back-edge: a `while` loops back from a plain node to a condition, an `until` loops back from a
   * condition's false handle, a `count` from its true handle.
   */
  private findLegacyLoops(): void {
    for (const edge of this.flow.edges) {
      if (!this.backEdgeIds.has(edge.id)) continue;
      const source = this.node(edge.source);
      const target = this.node(edge.target);
      if (!source || !target) continue;
      if ([edge.source, edge.target].some((id) => this.hints(id).loopRole !== undefined)) continue;
      if (this.loopMembers.has(edge.source) || this.loops.has(edge.target)) continue;

      if (target.type === 'condition' && source.type !== 'condition') {
        this.findLegacyWhile(edge.target);
      } else if (source.type === 'condition' && edge.sourceHandle === 'false') {
        this.findLegacyUntil(edge.target);
      } else if (source.type === 'condition' && edge.sourceHandle === 'true') {
        this.findLegacyCount(edge.source, edge.target);
      }
    }
  }

  private findLegacyWhile(head: string): void {
    const conditions: string[] = [];
    for (let id: string | undefined = head; id; ) {
      if (this.node(id)?.type !== 'condition' || conditions.includes(id)) break;
      conditions.push(id);
      id = this.targets(id, 'true').length === 1 ? this.targets(id, 'true')[0] : undefined;
    }
    const last = conditions[conditions.length - 1];
    this.register(
      {
        kind: 'while',
        nodeIds: conditions,
        conditions,
        bodyStarts: this.targets(last, 'true').filter((id) => !conditions.includes(id)),
        exitStarts: this.targets(head, 'false'),
      },
      [head]
    );
  }

  private findLegacyUntil(firstBody: string): void {
    const untilSources = new Set(
      this.flow.edges
        .filter(
          (e) => this.backEdgeIds.has(e.id) && e.sourceHandle === 'false' && e.target === firstBody
        )
        .map((e) => e.source)
    );
    // The test no other test leads to is the head of the chain.
    const followed = new Set([...untilSources].flatMap((id) => this.targets(id, 'true')));
    const head = [...untilSources].find((id) => !followed.has(id));
    if (!head) return;
    const conditions = [head];
    for (;;) {
      const onward = this.targets(conditions[conditions.length - 1], 'true').filter((id) =>
        untilSources.has(id)
      );
      if (onward.length !== 1 || conditions.includes(onward[0])) break;
      conditions.push(onward[0]);
    }
    this.register(
      {
        kind: 'until',
        nodeIds: conditions,
        conditions,
        bodyStarts: [firstBody],
        tailId: head,
        exitStarts: this.targets(conditions[conditions.length - 1], 'true'),
      },
      [firstBody]
    );
  }

  private findLegacyCount(check: string, loopTarget: string): void {
    const step = this.flow.edges.find(
      (e) => e.target === check && !this.backEdgeIds.has(e.id)
    )?.source;
    const init = this.flow.edges
      .filter((e) => e.target === loopTarget && !this.backEdgeIds.has(e.id))
      .map((e) => e.source)
      .find((id) => this.node(id)?.type === 'set_variables');
    const checkNode = this.node(check);
    const template = checkNode?.type === 'condition' ? checkNode.data.value_template : undefined;
    const limit = typeof template === 'string' ? /<\s*(\d+)\s*\}\}/.exec(template)?.[1] : undefined;
    this.register(
      {
        kind: 'count',
        nodeIds: [init, step, check].filter((id): id is string => id !== undefined),
        conditions: [],
        bodyStarts: loopTarget === step ? [] : [loopTarget],
        tailId: step,
        exitStarts: this.targets(check, 'false'),
        initId: init,
        count: limit === undefined ? undefined : Number.parseInt(limit, 10),
      },
      [init ?? loopTarget]
    );
  }
}
