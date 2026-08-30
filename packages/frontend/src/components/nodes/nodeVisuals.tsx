import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { NodeKind } from '@/utils/nodeData';
import { NodeTraceBadge } from './NodeTraceBadge';
import type { NodeTraceStatusView } from './useNodeTraceStatus';

/** Target canvas card width (design doc §5: "compact — target width 220px"). */
export const NODE_CARD_WIDTH = 220;

const KIND_BG: Record<NodeKind, string> = {
  trigger: 'bg-flow-node-trigger',
  condition: 'bg-flow-node-condition',
  action: 'bg-flow-node-action',
  timing: 'bg-flow-node-timing',
  data: 'bg-flow-node-data',
  flowctl: 'bg-flow-node-flowctl',
  unknown: 'bg-flow-node-unknown',
};

const KIND_TEXT: Record<NodeKind, string> = {
  trigger: 'text-flow-node-trigger',
  condition: 'text-flow-node-condition',
  action: 'text-flow-node-action',
  timing: 'text-flow-node-timing',
  data: 'text-flow-node-data',
  flowctl: 'text-flow-node-flowctl',
  unknown: 'text-flow-node-unknown',
};

/** CSS custom property backing a kind's color, for color-mix() tints Tailwind's static classes can't express. */
const KIND_VAR: Record<NodeKind, string> = {
  trigger: '--node-trigger',
  condition: '--node-condition',
  action: '--node-action',
  timing: '--node-timing',
  data: '--node-data',
  flowctl: '--node-flowctl',
  unknown: '--node-unknown',
};

/**
 * `.react-flow__handle-<kind>` — hover ring color per kind, defined once in
 * index.css alongside the handle's base (10px, bordered, quiet-at-rest)
 * styling. Kept as plain CSS rather than Tailwind ring utilities because the
 * ring needs a `color-mix()` alpha blend Tailwind's arbitrary-color slash
 * syntax can't produce for `var()`-backed theme colors (see index.css).
 */
export function handleKindClass(kind: NodeKind): string {
  return `flow-handle-${kind}`;
}

export interface NodeShellProps {
  kind: NodeKind;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  selected?: boolean;
  disabled?: boolean;
  hasErrors?: boolean;
  errorMessages?: string[];
  traceView: NodeTraceStatusView;
  /** Simulation playback / click-to-focus spotlight (distinct from live-trace "running"). */
  isActive?: boolean;
  stepNumber?: number | null;
  disabledLabel?: string;
  /** Extra content below the subtitle: handles, countdowns, branch chips. */
  children?: ReactNode;
  className?: string;
}

/**
 * Shared card chrome for every canvas node type (design doc §5): 12px-radius
 * bg-elevated card, kind-colored left rail + icon chip, mono title + muted
 * subtitle, selected/disabled/error/trace-status treatment. Node components
 * supply only their icon, derived title/subtitle, and handles/extra content.
 */
export function NodeShell({
  kind,
  icon: Icon,
  title,
  subtitle,
  selected,
  disabled,
  hasErrors,
  errorMessages,
  traceView,
  isActive,
  stepNumber,
  disabledLabel = 'Disabled',
  children,
  className,
}: NodeShellProps) {
  const { ringClass, dimmed, tooltip } = traceView;
  const pulse = isActive && !dimmed;

  return (
    <div
      className={cn(
        'group relative w-[220px] rounded-flow-card border bg-flow-elevated px-3.5 py-3 shadow-flow-card',
        'transition-colors duration-flow-fast ease-flow-warm',
        selected
          ? 'border-flow-accent shadow-[0_0_0_3px_var(--accent-subtle)]'
          : 'border-flow-border',
        disabled && 'opacity-45',
        ringClass,
        pulse && 'flow-node-pulse-ring',
        dimmed && 'opacity-40',
        className
      )}
      title={tooltip || undefined}
    >
      <span
        className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-flow-card', KIND_BG[kind])}
        aria-hidden
      />

      {hasErrors && (
        <span
          className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-flow-danger bg-flow-elevated text-flow-danger shadow-flow-card"
          title={errorMessages?.join('\n')}
        >
          <AlertCircle className="h-3 w-3" />
        </span>
      )}
      {!hasErrors && disabled && (
        <span className="absolute -top-2 -right-2 rounded-full border border-flow-border bg-flow-elevated px-1.5 py-0.5 font-mono text-[10px] text-flow-text-muted uppercase tracking-wide shadow-flow-card">
          {disabledLabel}
        </span>
      )}
      <NodeTraceBadge view={traceView} />

      <div className="flex items-center gap-2 pl-1">
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-flow-control',
            KIND_TEXT[kind]
          )}
          style={{ backgroundColor: `color-mix(in srgb, var(${KIND_VAR[kind]}) 16%, transparent)` }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate font-medium font-mono text-flow-text text-sm" title={title}>
          {title}
        </span>
        {stepNumber != null && (
          <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-flow-accent font-mono font-semibold text-[10px] text-flow-on-accent">
            {stepNumber}
          </span>
        )}
      </div>

      {subtitle && (
        <div className="mt-1 truncate pl-1 text-flow-text-muted text-xs" title={subtitle}>
          {subtitle}
        </div>
      )}

      {children}
    </div>
  );
}
