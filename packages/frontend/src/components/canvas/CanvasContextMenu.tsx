import { Clipboard, type LucideIcon, Maximize2, MousePointerClick, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuickAddPosition } from '@/components/canvas/QuickAddMenu';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

interface CanvasContextMenuProps {
  /** Screen position to anchor the menu at, or `null` when closed. */
  position: QuickAddPosition | null;
  canPaste: boolean;
  hasNodes: boolean;
  onAddNode: () => void;
  onPasteHere: () => void;
  onSelectAll: () => void;
  onFitView: () => void;
  onClose: () => void;
}

function MenuItem({
  icon: Icon,
  disabled,
  onClick,
  children,
}: {
  icon: LucideIcon;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-flow-control px-2 py-1.5 text-left font-mono text-flow-text text-xs transition-colors duration-flow-fast hover:bg-flow-elevated disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5 text-flow-text-secondary" />
      {children}
    </button>
  );
}

/**
 * Right-click menu for empty canvas: add a node at the cursor, paste the
 * internal clipboard at the cursor, plus select-all and zoom-to-fit.
 * Anchored the same way as QuickAddMenu — a zero-size fixed div at the
 * pointer, since there's no trigger element to anchor to.
 */
export function CanvasContextMenu({
  position,
  canPaste,
  hasNodes,
  onAddNode,
  onPasteHere,
  onSelectAll,
  onFitView,
  onClose,
}: CanvasContextMenuProps) {
  const { t } = useTranslation(['common', 'panels']);

  return (
    <Popover
      open={position !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {position && (
        <>
          <PopoverAnchor asChild>
            <div
              style={{
                position: 'fixed',
                left: position.screenX,
                top: position.screenY,
                width: 0,
                height: 0,
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            align="start"
            sideOffset={2}
            className="w-52 rounded-flow-card border border-flow-border bg-flow-panel p-1 shadow-flow-pop"
          >
            <MenuItem icon={Plus} onClick={onAddNode}>
              {t('common:canvasMenu.addNode')}
            </MenuItem>
            <MenuItem icon={Clipboard} disabled={!canPaste} onClick={onPasteHere}>
              {t('common:canvasMenu.pasteHere')}
            </MenuItem>
            <div className="my-1 h-px bg-flow-border" aria-hidden />
            <MenuItem icon={MousePointerClick} disabled={!hasNodes} onClick={onSelectAll}>
              {t('common:toolbar.selectAll')}
            </MenuItem>
            <MenuItem icon={Maximize2} disabled={!hasNodes} onClick={onFitView}>
              {t('panels:header.zoomFit')}
            </MenuItem>
          </PopoverContent>
        </>
      )}
    </Popover>
  );
}
