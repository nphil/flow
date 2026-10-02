import { applySafeFixes, type ReadabilityFix } from '@flow/transpiler';
import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';
import { buildLintGraph, type ReadabilityReport, readabilityOf } from '@/lib/readability';
import { useFlowStore } from '@/store/flow-store';

/**
 * Applies one fix to the open automation as a single undo step. Returns false when the fix no
 * longer applies (the node was edited since the list was drawn): nothing changes then.
 */
export function applyReadabilityFix(fix: ReadabilityFix): boolean {
  const store = useFlowStore.getState();
  const current = buildLintGraph(store);
  const next = fix.apply(current);
  if (next === current) return false;
  store.applyGraphEdit(next);
  return true;
}

/** Applies the first safe fix of every finding as a single undo step; returns how many were fixed. */
export function applyAllSafeReadabilityFixes(): number {
  const store = useFlowStore.getState();
  const { graph, applied } = applySafeFixes(buildLintGraph(store));
  if (applied.length === 0) return 0;
  store.applyGraphEdit(graph);
  return applied.length;
}

export interface ReadabilityApi extends ReadabilityReport {
  applyFix: (fix: ReadabilityFix) => void;
  fixAllSafe: () => void;
  /** Selects the node and brings it into view (same gesture as clicking a step in the Debug tab). */
  focusNode: (nodeId: string) => void;
  /** Deselects every node, so the Properties tab shows the automation's own settings. */
  deselectAll: () => void;
}

/** Readability findings of the open automation, split by severity, plus the actions on them. */
export function useReadability(): ReadabilityApi {
  const report = useFlowStore(readabilityOf);
  const { fitView } = useReactFlow();

  const applyFix = useCallback((fix: ReadabilityFix) => {
    applyReadabilityFix(fix);
  }, []);

  const fixAllSafe = useCallback(() => {
    applyAllSafeReadabilityFixes();
  }, []);

  const focusNode = useCallback(
    (nodeId: string) => {
      const { nodes, setNodes, selectNode } = useFlowStore.getState();
      if (!nodes.some((node) => node.id === nodeId)) return;
      // Leave node objects alone when their selection already matches: a changed node array is
      // an undo step.
      setNodes(
        nodes.map((node) =>
          Boolean(node.selected) === (node.id === nodeId)
            ? node
            : { ...node, selected: node.id === nodeId }
        )
      );
      selectNode(nodeId);
      fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1 });
    },
    [fitView]
  );

  const deselectAll = useCallback(() => {
    const { nodes, setNodes, selectNode } = useFlowStore.getState();
    if (nodes.some((node) => node.selected)) {
      setNodes(nodes.map((node) => (node.selected ? { ...node, selected: false } : node)));
    }
    selectNode(null);
  }, []);

  return { ...report, applyFix, fixAllSafe, focusNode, deselectAll };
}

/** Primitive counts for the tab badge (no object identity to worry about). */
export function useReadabilityCounts(): { warnings: number; total: number } {
  const warnings = useFlowStore((s) => readabilityOf(s).warnings.length);
  const total = useFlowStore((s) => readabilityOf(s).findings.length);
  return { warnings, total };
}

/** What is worth fixing on this node (warnings only), as text for the node's warning dot. */
export function useNodeReadabilityWarning(nodeId: string | null): string | undefined {
  return useFlowStore((s) =>
    nodeId === null ? undefined : readabilityOf(s).warningSummaryByNodeId.get(nodeId)
  );
}
