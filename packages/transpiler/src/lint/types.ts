import type { FlowGraph } from '@flow/shared';

/**
 * `warning` = worth fixing (it can make the automation misbehave or break later);
 * `info`    = a suggestion that only makes the automation easier to read.
 */
export type ReadabilitySeverity = 'warning' | 'info';

/** One way to resolve a finding. Fixes never mutate the graph they are given. */
export interface ReadabilityFix {
  /** Button text in plain English, e.g. `Ignore restores from "unavailable"`. */
  label: string;
  /**
   * True when applying the fix removes the problem without swallowing a genuine event or
   * changing a result in normal operation. Only safe fixes are applied by "fix all safe".
   */
  safe: boolean;
  /** What else changes (shown next to the button). Always set when `safe` is false. */
  note?: string;
  /**
   * Returns a NEW graph with the fix applied. Re-checks that the finding still applies to the
   * graph it is handed (the user may have edited the node since) and returns that graph
   * unchanged when it does not, so applying a stale fix is harmless.
   */
  apply: (graph: FlowGraph) => FlowGraph;
}

export interface ReadabilityFinding {
  /** Stable for the same problem on the same node, so it can be used as a list key. */
  id: string;
  ruleId: string;
  severity: ReadabilitySeverity;
  /** The node the finding is about. Absent for whole-automation findings. */
  nodeId?: string;
  /** One or two plain-English sentences a non-programmer understands. */
  message: string;
  /** Optional longer explanation: why it matters and what to do about it. */
  detail?: string;
  /** Ordered by preference; empty when the problem needs a human decision. */
  fixes: ReadabilityFix[];
}

/** Facts about the whole automation that several rules need; computed once per run. */
export interface LintContext {
  graph: FlowGraph;
  /** True when an enabled step calls anything beyond notify/log/speak style services. */
  actuates: boolean;
  /** True when a condition already skips triggers that come from `unavailable`/`unknown`. */
  hasRestoreGuard: boolean;
}

/** A readability check. Rules are listed in `rules/index.ts`; add a module there to add a rule. */
export interface ReadabilityRule {
  id: string;
  /** Plain-English name of what the rule looks for. */
  title: string;
  check: (context: LintContext) => ReadabilityFinding[];
}
