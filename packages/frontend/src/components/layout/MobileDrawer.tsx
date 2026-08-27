import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title?: string;
  children: ReactNode;
}

/**
 * Design doc §4 mobile (<768px): left/right panels become full-height overlay drawers with a
 * scrim, closed via the scrim, the X button, or Escape. Pure CSS transform + opacity
 * transitions -- no extra dependency, kept mounted (just translated off-screen) so the slide
 * animation has something to animate between.
 */
export function MobileDrawer({ open, onClose, side, title, children }: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: scrim; Escape/X button cover keyboard users */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={cn(
          'flow-scrim fixed inset-0 z-40 transition-opacity duration-flow-med',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'fixed top-0 bottom-0 z-50 flex w-[85vw] max-w-sm flex-col bg-flow-panel shadow-flow-modal transition-transform duration-flow-med ease-flow-warm',
          side === 'left'
            ? 'left-0 border-flow-border border-r'
            : 'right-0 border-flow-border border-l',
          open ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full',
          !open && 'pointer-events-none'
        )}
      >
        <div className="flex items-center justify-between border-flow-border border-b p-2">
          {title && (
            <span className="px-1 font-mono text-flow-text-muted text-xs uppercase tracking-wide">
              {title}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ui-focus-ring ml-auto flex h-7 w-7 items-center justify-center rounded-flow-control text-flow-text-muted transition-colors duration-flow-fast hover:bg-flow-elevated hover:text-flow-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </>
  );
}
