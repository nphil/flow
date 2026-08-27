import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeTraceState, NodeTraceStatus } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';

/** Corner badge kind derived from a node's trace status. */
export type NodeTraceBadgeKind = 'ok' | 'fail' | 'error' | 'active';

export interface NodeTraceStatusView {
  traceState: NodeTraceState | undefined;
  /** Ring utility classes reflecting the trace status; empty when not traced. */
  ringClass: string;
  /** True when a trace is shown but this node was never visited. */
  dimmed: boolean;
  badge: NodeTraceBadgeKind | null;
  /** Native `title` tooltip: status, reason, timestamp, visit count. */
  tooltip: string;
  /** True while the shown trace is still running (live view). */
  isRunning: boolean;
}

const RING_CLASSES: Record<NodeTraceStatus, string> = {
  ok: 'ring-2 ring-green-500',
  active: 'node-trace-active ring-4 ring-yellow-400',
  'condition-false': 'ring-2 ring-orange-500',
  error: 'ring-2 ring-red-500',
};

const BADGE_KINDS: Record<NodeTraceStatus, NodeTraceBadgeKind> = {
  ok: 'ok',
  active: 'active',
  'condition-false': 'fail',
  error: 'error',
};

function statusLabel(t: TFunction<['nodes']>, status: NodeTraceStatus): string {
  switch (status) {
    case 'ok':
      return t('nodes:trace.status.ok');
    case 'active':
      return t('nodes:trace.status.active');
    case 'condition-false':
      return t('nodes:trace.status.conditionFalse');
    case 'error':
      return t('nodes:trace.status.error');
  }
}

function summarizeResult(result: Record<string, unknown>): string | null {
  if (Object.keys(result).length === 0) return null;
  try {
    const text = JSON.stringify(result);
    return text.length > 120 ? `${text.slice(0, 119)}…` : text;
  } catch {
    return null;
  }
}

function reasonLabel(t: TFunction<['nodes']>, state: NodeTraceState): string | null {
  if (state.status === 'error') return state.error ?? null;
  if (state.status === 'condition-false' || state.result?.result === false) {
    return t('nodes:trace.reason.conditionFalse');
  }
  if (state.result?.result === true) return t('nodes:trace.reason.conditionTrue');
  return state.result ? summarizeResult(state.result) : null;
}

/**
 * Single source of trace styling for all canvas node components: ring
 * classes, dimming for unvisited nodes, corner badge kind, and the native
 * title tooltip. Simulation/replay highlighting (activeNodeId) is expected
 * to take precedence — callers apply `ringClass` only while not active.
 */
export function useNodeTraceStatus(nodeId: string): NodeTraceStatusView {
  const { t } = useTranslation(['nodes']);
  const traceState = useFlowStore((s): NodeTraceState | undefined => s.nodeTraceStates[nodeId]);
  const isShowingTrace = useFlowStore((s) => s.isShowingTrace);
  const isRunning = useFlowStore((s) => s.isShowingTrace && s.traceData?.state === 'running');

  return useMemo(() => {
    if (!isShowingTrace || !traceState) {
      return {
        traceState: undefined,
        ringClass: '',
        dimmed: isShowingTrace,
        badge: null,
        tooltip: '',
        isRunning,
      };
    }

    const lines = [statusLabel(t, traceState.status)];
    const reason = reasonLabel(t, traceState);
    if (reason) lines.push(reason);
    lines.push(new Date(traceState.timestamp).toLocaleTimeString());
    if (traceState.visitCount > 1) {
      lines.push(t('nodes:trace.visits', { count: traceState.visitCount }));
    }

    return {
      traceState,
      ringClass: RING_CLASSES[traceState.status],
      dimmed: false,
      badge: BADGE_KINDS[traceState.status],
      tooltip: lines.join('\n'),
      isRunning,
    };
  }, [isShowingTrace, traceState, isRunning, t]);
}
