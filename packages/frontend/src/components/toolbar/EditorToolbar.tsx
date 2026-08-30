import { LayoutGrid, Loader2, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeAction } from '@/components/actions';
import { Button } from '@/components/ui/button';
import type { UseNodeActionsResult } from '@/hooks/useNodeActions';
import { cn } from '@/lib/utils';

/** Groups shown as inline clusters, in order; layout (arrange/fit) slots in before delete. */
const CLUSTER_GROUPS = ['history', 'clipboard', 'selection', 'edit', 'align'] as const;

interface EditorToolbarProps {
  actions: UseNodeActionsResult;
  isArranging: boolean;
  onAutoArrange: () => void;
  onZoomFit: () => void;
  className?: string;
}

function GroupSeparator() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-flow-border" />;
}

/**
 * Canvas command cluster in the header's center (design doc §4 update): the
 * former floating toolbar, grouped history | clipboard | selection | edit |
 * align | layout | delete with hairline separators. Selection-dependent
 * buttons stay visible but dim when nothing is selected, so the bar never
 * reflows. Sized/styled identically to the header's other icon buttons.
 */
export function EditorToolbar({
  actions,
  isArranging,
  onAutoArrange,
  onZoomFit,
  className,
}: EditorToolbarProps) {
  const { t } = useTranslation(['common', 'panels']);
  const { actionsByGroup, renderContext, runAction, clipboardNodeCount, shortcutLabel } = actions;

  const renderAction = (action: NodeAction) => {
    const Icon = action.getIcon ? action.getIcon(renderContext) : action.icon;
    const tooltip =
      typeof action.tooltip === 'function' ? action.tooltip(renderContext) : action.tooltip;
    const enabled = action.isEnabled ? action.isEnabled(renderContext) : true;
    const shortcut = shortcutLabel(action);
    const isPaste = action.name === 'paste';

    return (
      <Button
        key={action.name}
        variant="ghost"
        size="icon"
        disabled={!enabled}
        onClick={() => runAction(action)}
        title={shortcut ? `${tooltip} (${shortcut})` : tooltip}
        aria-label={tooltip}
        className={cn(
          'relative h-8 w-8 shrink-0',
          action.variant === 'destructive' && 'hover:text-flow-danger'
        )}
      >
        <Icon className="h-4 w-4" />
        {isPaste && clipboardNodeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-flow-accent font-bold font-mono text-[9px] text-flow-on-accent">
            {clipboardNodeCount}
          </span>
        )}
      </Button>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label={t('common:labels.canvasTools')}
      className={cn('items-center', className)}
    >
      {CLUSTER_GROUPS.map((group) => {
        const groupActions = actionsByGroup[group];
        if (!groupActions || groupActions.length === 0) return null;
        return (
          <div key={group} className="flex items-center">
            {groupActions.map(renderAction)}
            <GroupSeparator />
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="icon"
        disabled={isArranging}
        onClick={onAutoArrange}
        title={t('panels:header.autoArrange')}
        aria-label={t('panels:header.autoArrange')}
        className="h-8 w-8 shrink-0"
      >
        {isArranging ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LayoutGrid className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onZoomFit}
        title={`${t('panels:header.zoomFit')} (Shift+1)`}
        aria-label={t('panels:header.zoomFit')}
        className="h-8 w-8 shrink-0"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>

      <GroupSeparator />
      {(actionsByGroup.delete ?? []).map(renderAction)}
    </div>
  );
}
