import { useReactFlow } from '@xyflow/react';
import {
  Copy,
  FileDown,
  FileUp,
  Info,
  LayoutGrid,
  Loader2,
  Maximize2,
  Menu,
  MoreVertical,
  PanelRight,
  Play,
  Save,
  Trash2,
  Unplug,
  WifiOff,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { EditorToolbar } from '@/components/toolbar/EditorToolbar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useHass } from '@/contexts/HassContext';
import type { DirtyGuard } from '@/hooks/useDirtyGuard';
import { ACTION_GROUP_ORDER, useNodeActions } from '@/hooks/useNodeActions';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { cn } from '@/lib/utils';
import { FIT_VIEW_MANUAL, FIT_VIEW_OPEN } from '@/lib/viewport';
import { useFlowStore } from '@/store/flow-store';
import type { HassEntity } from '@/types/hass';
import { AboutDialog } from './AboutDialog';
import { DeleteAutomationDialog } from './DeleteAutomationDialog';
import { FlowMark } from './FlowMark';
import { type ImportApplyPayload, ImportExportDialog } from './ImportExportDialog';
import { ThemeMenu } from './ThemeMenu';

interface HeaderProps {
  dirtyGuard: DirtyGuard;
  isMobile: boolean;
  onRequestSave: () => void;
  onToggleLeftDrawer: () => void;
  onToggleRightDrawer: () => void;
}

/** Finds the live automation entity behind the automation currently open on the canvas. */
function findOpenAutomationEntity(entities: HassEntity[], automationId: string | null) {
  if (!automationId) return undefined;
  return entities.find(
    (entity) =>
      entity.entity_id.startsWith('automation.') &&
      (String(entity.attributes.id ?? '') === automationId ||
        entity.entity_id === `automation.${automationId}`)
  );
}

/**
 * 48px app header (design doc §4), three zones: identity + inline-editable
 * name + status chips on the left, the merged canvas command cluster
 * (EditorToolbar — the former floating toolbar) in the center, and run/save +
 * the overflow menu on the right. Below `lg` the center cluster folds into
 * the overflow menu instead. Design doc §12 adds the standalone disconnect
 * action; §13 adds the shared Animations toggle.
 */
export function Header({
  dirtyGuard,
  isMobile,
  onRequestSave,
  onToggleLeftDrawer,
  onToggleRightDrawer,
}: HeaderProps) {
  const { t } = useTranslation(['common', 'panels', 'dialogs']);
  const { hass, config: hassConfig, entities, isRemote, setConfig } = useHass();
  const { fitView } = useReactFlow();

  const {
    flowName,
    flowMetadata,
    automationId,
    isSaving,
    isArranging,
    animationsEnabled,
    setFlowName,
    setAutomationId,
    reset,
    fromFlowGraph,
    setTracePathMap,
    autoArrange,
    setAnimationsEnabled,
  } = useFlowStore(
    useShallow((s) => ({
      flowName: s.flowName,
      flowMetadata: s.flowMetadata,
      automationId: s.automationId,
      isSaving: s.isSaving,
      isArranging: s.isArranging,
      animationsEnabled: s.animationsEnabled,
      setFlowName: s.setFlowName,
      setAutomationId: s.setAutomationId,
      reset: s.reset,
      fromFlowGraph: s.fromFlowGraph,
      setTracePathMap: s.setTracePathMap,
      autoArrange: s.autoArrange,
      setAnimationsEnabled: s.setAnimationsEnabled,
    }))
  );
  const isDirty = useFlowStore((s) => s.isDirty());
  const nodeActions = useNodeActions();

  const [importExportOpen, setImportExportOpen] = useState<'import' | 'export' | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const openEntity = useMemo(
    () => findOpenAutomationEntity(entities, automationId),
    [entities, automationId]
  );

  const handleZoomFit = () => fitView({ ...FIT_VIEW_MANUAL, duration: 220 });

  const handleRun = async () => {
    if (!hass || !openEntity) return;
    setIsRunning(true);
    try {
      await getHomeAssistantAPI(hass, hassConfig).triggerAutomation(openEntity.entity_id);
      toast.success(t('panels:header.runSuccess', { name: flowName }));
    } catch (error) {
      toast.error(
        t('panels:header.runFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsRunning(false);
    }
  };

  const handleDuplicate = () => {
    setAutomationId(null);
    setFlowName(
      t('panels:header.duplicateName', { name: flowName || t('common:defaults.newAutomation') })
    );
    toast.success(t('panels:header.duplicated'));
  };

  const handleDeleteConfirm = async () => {
    if (!hass || !automationId) return;
    setIsDeleting(true);
    try {
      await getHomeAssistantAPI(hass, hassConfig).deleteAutomation(automationId);
      reset();
      setDeleteOpen(false);
      toast.success(t('panels:header.deleted'));
    } catch (error) {
      toast.error(
        t('panels:header.deleteFailed', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApplyImport = (mode: 'new' | 'replace', payload: ImportApplyPayload) => {
    dirtyGuard.guard(() => {
      fromFlowGraph(payload.graph);
      setTracePathMap(payload.nodePathMap);
      if (mode === 'new') {
        setAutomationId(null);
      }
      if (payload.graph.name) {
        setFlowName(payload.graph.name);
      }
      setTimeout(() => fitView({ ...FIT_VIEW_OPEN, duration: 300 }), 50);
    });
  };

  const handleDisconnect = () => {
    dirtyGuard.guard(() => setConfig({ url: '', token: '' }));
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-flow-border border-b bg-flow-panel px-3">
      {/* Left zone: identity, editable name, status chips */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleLeftDrawer}
            className="h-8 w-8 shrink-0"
            aria-label={t('panels:header.openPalette')}
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}

        <FlowMark size={20} className="shrink-0 text-flow-text" />

        <Separator orientation="vertical" className="h-5 shrink-0 bg-flow-border" />

        <input
          value={flowName}
          onChange={(event) => setFlowName(event.target.value)}
          placeholder={t('common:placeholders.automationName')}
          title={flowName || undefined}
          className="ui-focus-ring min-w-0 max-w-72 flex-1 truncate rounded-flow-control bg-transparent px-1.5 font-medium text-[15px] text-flow-text placeholder:font-normal placeholder:text-flow-text-muted focus-visible:bg-flow-bg"
        />

        {/* Redundant with the pulsing save button for AT users — decorative for sighted scanning. */}
        {isDirty && (
          <span
            aria-hidden
            title={t('panels:header.unsavedChanges')}
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-flow-warn"
          />
        )}

        {openEntity && (
          <span
            className={cn(
              'hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide sm:flex',
              openEntity.state === 'on'
                ? 'bg-[color-mix(in_srgb,var(--ok)_16%,transparent)] text-[var(--ok)]'
                : 'bg-flow-elevated text-flow-text-muted'
            )}
          >
            {openEntity.state === 'on' ? t('panels:header.enabled') : t('panels:header.disabled')}
          </span>
        )}

        {flowMetadata.mode && flowMetadata.mode !== 'single' && (
          <span className="hidden shrink-0 rounded-full bg-flow-elevated px-2 py-0.5 font-mono text-[10px] text-flow-text-muted uppercase tracking-wide sm:flex">
            {flowMetadata.mode}
          </span>
        )}

        {isRemote && hass && !hass.connected && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] px-2 py-0.5 font-mono text-[10px] text-[var(--warn)] uppercase tracking-wide">
            <WifiOff className="h-2.5 w-2.5" />
            {t('panels:header.reconnecting')}
          </span>
        )}
      </div>

      {/* Center zone: merged canvas command cluster (folds into the overflow menu below lg) */}
      <EditorToolbar
        actions={nodeActions}
        isArranging={isArranging}
        onAutoArrange={() => autoArrange()}
        onZoomFit={handleZoomFit}
        className="hidden shrink-0 lg:flex"
      />

      {/* Right zone: automation-level commands */}
      <div className="flex min-w-0 flex-1 shrink-0 items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          disabled={!openEntity || isRunning}
          onClick={handleRun}
          title={t('panels:header.run')}
          className="h-8 w-8"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        </Button>

        <Button
          size="sm"
          disabled={!isDirty || isSaving}
          onClick={onRequestSave}
          title={t('common:buttons.save')}
          className={cn(
            'h-8 bg-flow-accent px-3 text-flow-on-accent hover:bg-flow-accent-hover',
            isDirty && !isSaving && 'save-button-unsaved'
          )}
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={t('panels:header.moreActions')}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60 border-flow-border bg-flow-panel text-flow-text"
          >
            {/* Below lg the center cluster is hidden — every canvas action stays reachable here. */}
            <div className="lg:hidden">
              {ACTION_GROUP_ORDER.map((group) => {
                const groupActions = nodeActions.actionsByGroup[group];
                if (!groupActions || groupActions.length === 0) return null;
                return (
                  <Fragment key={group}>
                    {groupActions.map((action) => {
                      const Icon = action.getIcon
                        ? action.getIcon(nodeActions.renderContext)
                        : action.icon;
                      const tooltip =
                        typeof action.tooltip === 'function'
                          ? action.tooltip(nodeActions.renderContext)
                          : action.tooltip;
                      const enabled = action.isEnabled
                        ? action.isEnabled(nodeActions.renderContext)
                        : true;
                      return (
                        <DropdownMenuItem
                          key={action.name}
                          disabled={!enabled}
                          onClick={() => nodeActions.runAction(action)}
                          className={cn(
                            'gap-2 font-mono text-xs',
                            action.variant === 'destructive' && 'text-[var(--danger)]'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" /> {tooltip}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator className="bg-flow-border" />
                  </Fragment>
                );
              })}
              <DropdownMenuItem
                disabled={isArranging}
                onClick={() => autoArrange()}
                className="gap-2 font-mono text-xs"
              >
                <LayoutGrid className="h-3.5 w-3.5" /> {t('panels:header.autoArrange')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleZoomFit} className="gap-2 font-mono text-xs">
                <Maximize2 className="h-3.5 w-3.5" /> {t('panels:header.zoomFit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-flow-border" />
            </div>

            <DropdownMenuItem
              onClick={() => setImportExportOpen('import')}
              className="gap-2 font-mono text-xs"
            >
              <FileUp className="h-3.5 w-3.5" /> {t('panels:header.importYaml')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setImportExportOpen('export')}
              className="gap-2 font-mono text-xs"
            >
              <FileDown className="h-3.5 w-3.5" /> {t('panels:header.exportYaml')}
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-flow-border" />

            <DropdownMenuItem onClick={handleDuplicate} className="gap-2 font-mono text-xs">
              <Copy className="h-3.5 w-3.5" /> {t('panels:header.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeleteOpen(true)}
              disabled={!automationId}
              className="gap-2 font-mono text-[var(--danger)] text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t('common:buttons.delete')}
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-flow-border" />

            <div className="flex items-center justify-between px-2 py-1.5 font-mono text-xs">
              <span>{t('panels:header.animations')}</span>
              <Switch
                checked={animationsEnabled}
                onCheckedChange={setAnimationsEnabled}
                className="data-[state=checked]:bg-flow-accent data-[state=unchecked]:bg-flow-elevated"
              />
            </div>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2 font-mono text-xs">
                {t('panels:header.theme')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="border-flow-border bg-flow-panel">
                <ThemeMenu />
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {isRemote && (
              <>
                <DropdownMenuSeparator className="bg-flow-border" />
                <DropdownMenuItem onClick={handleDisconnect} className="gap-2 font-mono text-xs">
                  <Unplug className="h-3.5 w-3.5" /> {t('panels:header.disconnect')}
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator className="bg-flow-border" />

            <DropdownMenuItem
              onClick={() => setAboutOpen(true)}
              className="gap-2 font-mono text-xs"
            >
              <Info className="h-3.5 w-3.5" /> {t('panels:header.about')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleRightDrawer}
            className="h-8 w-8"
            aria-label={t('panels:header.openPanel')}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      <ImportExportDialog
        open={importExportOpen !== null}
        onOpenChange={(open) => setImportExportOpen(open ? importExportOpen : null)}
        initialTab={importExportOpen ?? 'import'}
        onApply={handleApplyImport}
      />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <DeleteAutomationDialog
        open={deleteOpen}
        automationName={flowName}
        isDeleting={isDeleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </header>
  );
}
