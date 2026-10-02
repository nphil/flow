/**
 * Readability assistant: inspects a FlowGraph and reports what makes the automation hard for a
 * person to read or maintain, with one-click fixes where they cannot change what it does.
 * Pure (no I/O, no React): the graph goes in, plain findings come out, and fixes return NEW graphs.
 */
import type { FlowGraph } from '@flow/shared';
import { buildLintContext } from './context';
import { READABILITY_RULES } from './rules';
import type {
  ReadabilityFinding,
  ReadabilityFix,
  ReadabilityRule,
  ReadabilitySeverity,
} from './types';

export { READABILITY_RULES } from './rules';
export type {
  LintContext,
  ReadabilityFinding,
  ReadabilityFix,
  ReadabilityRule,
  ReadabilitySeverity,
} from './types';

const SEVERITY_RANK: Record<ReadabilitySeverity, number> = { warning: 0, info: 1 };

/** Applying one fix can reveal another (a converted condition may now be too long...); bound the loop. */
const MAX_FIX_PASSES = 5;

/**
 * All findings for the graph: warnings before suggestions, then in canvas order, then in rule
 * order. Whole-automation findings come last in their group.
 */
export function lintFlowGraph(
  graph: FlowGraph,
  rules: readonly ReadabilityRule[] = READABILITY_RULES
): ReadabilityFinding[] {
  const context = buildLintContext(graph);
  const nodeRank = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const wholeAutomationRank = graph.nodes.length;

  return rules
    .flatMap((rule, ruleIndex) =>
      rule.check(context).map((finding) => ({
        finding,
        ruleIndex,
        rank:
          finding.nodeId === undefined
            ? wholeAutomationRank
            : (nodeRank.get(finding.nodeId) ?? wholeAutomationRank),
      }))
    )
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
        a.rank - b.rank ||
        a.ruleIndex - b.ruleIndex
    )
    .map(({ finding }) => finding);
}

/** The fix "fix all safe" would use for a finding: the first one that is safe, if any. */
export function firstSafeFix(finding: ReadabilityFinding): ReadabilityFix | undefined {
  return finding.fixes.find((fix) => fix.safe);
}

export interface SafeFixResult {
  graph: FlowGraph;
  /** The findings that were fixed, in the order they were fixed. */
  applied: ReadabilityFinding[];
}

/**
 * Applies the first safe fix of every finding, re-checking after each pass until nothing safe is
 * left. Returns the same graph object when there was nothing to do.
 */
export function applySafeFixes(
  graph: FlowGraph,
  rules: readonly ReadabilityRule[] = READABILITY_RULES
): SafeFixResult {
  let current = graph;
  const applied: ReadabilityFinding[] = [];

  for (let pass = 0; pass < MAX_FIX_PASSES; pass += 1) {
    let progressed = false;
    for (const finding of lintFlowGraph(current, rules)) {
      const fix = firstSafeFix(finding);
      if (!fix) continue;
      const next = fix.apply(current);
      if (next === current) continue;
      current = next;
      applied.push(finding);
      progressed = true;
    }
    if (!progressed) break;
  }
  return { graph: current, applied };
}
