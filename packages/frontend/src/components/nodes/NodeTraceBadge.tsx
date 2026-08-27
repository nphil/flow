import { AlertCircle, Check, Loader2, type LucideIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NodeTraceBadgeKind, NodeTraceStatusView } from './useNodeTraceStatus';

const BADGE_TOKEN: Record<NodeTraceBadgeKind, string> = {
  ok: 'border-flow-ok text-flow-ok',
  fail: 'border-flow-warn text-flow-warn',
  error: 'border-flow-danger text-flow-danger',
  active: 'border-flow-accent text-flow-accent',
};

const BADGE_ICON: Record<NodeTraceBadgeKind, LucideIcon> = {
  ok: Check,
  fail: X,
  error: AlertCircle,
  active: Loader2,
};

/**
 * Corner badge showing a node's trace status (top-left, mirroring the
 * validation badge at top-right): neutral surface + status-colored border and
 * icon rather than a solid fill, so contrast holds regardless of how light or
 * dark a given palette's status hue is (tokens.css only guarantees status
 * colors are readable against surfaces, not against each other). Repeat
 * visits (loops) get a `×N` counter chip; a finished ('ok') step gets its
 * elapsed-time chip.
 */
export function NodeTraceBadge({ view }: { view: NodeTraceStatusView }) {
  const { badge, traceState, tooltip, isRunning, durationLabel } = view;
  if (!badge || !traceState) return null;
  const Icon = BADGE_ICON[badge];

  return (
    <div className="absolute -top-2 -left-2 z-10 flex items-center gap-1" title={tooltip}>
      <div
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full border bg-flow-elevated shadow-flow-card',
          BADGE_TOKEN[badge]
        )}
      >
        <Icon className={cn('h-3 w-3', badge === 'active' && isRunning && 'animate-spin')} />
      </div>
      {traceState.visitCount > 1 && (
        <span className="rounded-full border border-flow-border bg-flow-elevated px-1 font-bold font-mono text-[9px] text-flow-text-secondary shadow-flow-card">
          {`×${traceState.visitCount}`}
        </span>
      )}
      {durationLabel && (
        <span className="rounded-full border border-flow-border bg-flow-elevated px-1.5 py-0.5 font-mono text-[9px] text-flow-text-muted shadow-flow-card">
          {durationLabel}
        </span>
      )}
    </div>
  );
}
