import * as React from 'react';
import { cn } from '@/lib/utils';

interface ResizablePanelProps {
  children: React.ReactNode;
  side: 'left' | 'right';
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** localStorage key the committed width persists under (design doc §4: `flow.panel.left`/`.right`). */
  storageKey: string;
  /** Forces `collapsedWidth` and disables the resize handle -- the left palette's icon rail. */
  collapsed?: boolean;
  collapsedWidth?: number;
  className?: string;
}

function loadStoredWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number
) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    const parsed = stored ? Number(stored) : Number.NaN;
    // Three call sites (mount, drag commit, keyboard commit) must all agree on this exact
    // clamp so a width never persists outside the panel's own configured bounds.
    if (Number.isFinite(parsed)) return Math.min(Math.max(parsed, minWidth), maxWidth);
  } catch {
    // localStorage unavailable (private browsing, quota) -- fall through to the default.
  }
  return defaultWidth;
}

/**
 * Cody's resizable-panel mechanic (cody-design.md §5), restyled to Flow's own numbers (design
 * doc §4): a 1px seam with an 8px pointer hit-area, an accent pill that only appears on
 * hover/drag, double-click-to-reset, and per-side localStorage persistence. Width is written
 * straight to the DOM node during a drag (no React re-render per pointermove) and only
 * committed to state -- and localStorage -- on release, mirroring Cody's own ref+CSS-variable
 * technique.
 */
export function ResizablePanel({
  children,
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  collapsed = false,
  collapsedWidth = 48,
  className,
}: ResizablePanelProps) {
  const [width, setWidth] = React.useState(() =>
    loadStoredWidth(storageKey, defaultWidth, minWidth, maxWidth)
  );
  const [isDragging, setIsDragging] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dragStateRef = React.useRef<{ startWidth: number; startX: number } | null>(null);

  const commitWidth = React.useCallback(
    (next: number) => {
      setWidth(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Ignore -- the width still applies for this session.
      }
    },
    [storageKey]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    dragStateRef.current = { startWidth: width, startX: event.clientX };
    setIsDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  // `width`/`commitWidth` intentionally excluded: dragState.startWidth already captures the
  // width at drag-start, and re-running this effect mid-drag would drop the active listeners.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  React.useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || !panelRef.current) return;
      const delta = event.clientX - dragState.startX;
      const signedDelta = side === 'left' ? delta : -delta;
      const next = Math.min(Math.max(dragState.startWidth + signedDelta, minWidth), maxWidth);
      panelRef.current.style.width = `${next}px`;
    };

    const handlePointerUp = () => {
      if (panelRef.current) {
        commitWidth(Math.round(Number.parseFloat(panelRef.current.style.width) || width));
      }
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
    // (dependency rationale documented above the hook)
  }, [isDragging, side, minWidth, maxWidth]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0;
    if (step === 0) return;
    event.preventDefault();
    const signedStep = side === 'left' ? step : -step;
    commitWidth(Math.min(Math.max(width + signedStep, minWidth), maxWidth));
  };

  const handleDoubleClick = () => commitWidth(defaultWidth);

  return (
    <div
      ref={panelRef}
      className={cn('relative flex h-full min-h-0 flex-shrink-0 flex-col', className)}
      style={{
        width: collapsed ? collapsedWidth : width,
        transition: isDragging ? 'none' : undefined,
      }}
    >
      {children}

      {!collapsed && (
        // 1px visible seam via the panel's own border-l/border-r (applied by the caller);
        // this button is purely the 8px invisible pointer/keyboard hit-area plus the
        // accent hover/drag pill, centered on that seam.
        <button
          type="button"
          aria-label="Resize panel"
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
          onKeyDown={handleKeyDown}
          className={cn(
            'ui-focus-ring group absolute top-0 bottom-0 z-10 w-2 cursor-col-resize touch-none border-none bg-transparent p-0',
            side === 'right' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
          )}
        >
          <span
            className={cn(
              'absolute top-1/2 left-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-flow-fast',
              isDragging
                ? 'h-16 bg-flow-accent'
                : 'h-8 bg-transparent group-hover:h-[52px] group-hover:bg-flow-accent'
            )}
          />
        </button>
      )}
    </div>
  );
}
