import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeTraceBadgeKind, NodeTraceStatusView } from './useNodeTraceStatus';

const BADGE_BG: Record<NodeTraceBadgeKind, string> = {
  ok: 'bg-green-500',
  fail: 'bg-orange-500',
  error: 'bg-red-500',
  active: 'bg-yellow-500',
};

/**
 * Corner badge showing a node's trace status (top-left, mirroring the
 * validation badge at top-right). Repeat visits (loops) render an extra
 * `×N` counter next to the badge.
 */
export function NodeTraceBadge({ view }: { view: NodeTraceStatusView }) {
  const { badge, traceState, tooltip, isRunning } = view;
  if (!badge || !traceState) return null;

  return (
    <div className="absolute -top-2 -left-2 z-10 flex items-center gap-0.5" title={tooltip}>
      <div
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-white shadow-sm',
          BADGE_BG[badge]
        )}
      >
        {badge === 'ok' && <Check className="h-3 w-3" />}
        {badge === 'fail' && <X className="h-3 w-3" />}
        {badge === 'error' && <AlertCircle className="h-3 w-3" />}
        {badge === 'active' && <Loader2 className={cn('h-3 w-3', isRunning && 'animate-spin')} />}
      </div>
      {traceState.visitCount > 1 && (
        <span className="rounded-full bg-slate-700 px-1 font-bold text-[10px] text-white shadow-sm">
          {`×${traceState.visitCount}`}
        </span>
      )}
    </div>
  );
}
