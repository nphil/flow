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
  Redo2,
  Save,
  Trash2,
  Undo2,
  Unplug,
  WifiOff,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
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
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { cn } from '@/lib/utils';
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
 * 48px app header (design doc §4): mark, inline-editable name, enabled/mode/connection status,
 * and the primary command cluster + overflow menu. Design doc §12 adds the standalone
 * disconnect action; §13 adds the shared Animations toggle.
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
  } = useFlowStore();
  const isDirty = useFlowStore((s) => s.isDirty());
  const { undo, redo, canUndo, canRedo } = useStore(
    useFlowStore.temporal,
    useShallow((state) => ({
      undo: state.undo,
      redo: state.redo,
      canUndo: state.pastStates.length > 0,
      canRedo: state.futureStates.length > 0,
    }))
  );

  const [importExportOpen, setImportExportOpen] = useState<'import' | 'export' | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const openEntity = useMemo(
    () => findOpenAutomationEntity(entities, automationId),
    [entities, automationId]
  );

  const handleUndo = () => {
    undo();
    useFlowStore.getState().validateAllNodes();
  };
  const handleRedo = () => {
    redo();
    useFlowStore.getState().validateAllNodes();
  };

  const handleZoomFit = () => fitView({ padding: 0.15, duration: 220 });

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
      setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
    });
  };

  const handleDisconnect = () => {
    dirtyGuard.guard(() => setConfig({ url: '', token: '' }));
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-flow-border border-b bg-flow-panel px-3">
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleLeftDrawer}
          className="h-8 w-8 shrink-0 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text"
          aria-label={t('panels:header.openPalette')}
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}

      <FlowMark size={20} className="shrink-0 text-flow-text" />

      <Separator orientation="vertical" className="h-5 bg-flow-border" />

      <input
        value={flowName}
        onChange={(event) => setFlowName(event.target.value)}
        placeholder={t('common:placeholders.automationName')}
        className="ui-focus-ring min-w-0 max-w-72 flex-1 truncate rounded-flow-control bg-transparent px-1 font-serif text-base text-flow-text placeholder:text-flow-text-muted focus-visible:bg-flow-bg"
        style={{ letterSpacing: '-0.005em' }}
      />

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

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          disabled={!isDirty || isSaving}
          onClick={onRequestSave}
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

        <Button
          variant="ghost"
          size="icon"
          disabled={!openEntity || isRunning}
          onClick={handleRun}
          title={t('panels:header.run')}
          className="h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        </Button>

        <Separator orientation="vertical" className="hidden h-5 bg-flow-border md:block" />

        <Button
          variant="ghost"
          size="icon"
          disabled={!canUndo}
          onClick={handleUndo}
          title={t('panels:header.undo')}
          className="hidden h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text md:inline-flex"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!canRedo}
          onClick={handleRedo}
          title={t('panels:header.redo')}
          className="hidden h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text md:inline-flex"
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={isArranging}
          onClick={() => autoArrange()}
          title={t('panels:header.autoArrange')}
          className="hidden h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text md:inline-flex"
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
          onClick={handleZoomFit}
          title={t('panels:header.zoomFit')}
          className="hidden h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text md:inline-flex"
        >
          <Maximize2 className="h-4 w-4" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text"
              aria-label={t('panels:header.moreActions')}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 border-flow-border bg-flow-panel text-flow-text"
          >
            <div className="md:hidden">
              <DropdownMenuItem
                onClick={handleUndo}
                disabled={!canUndo}
                className="gap-2 font-mono text-xs"
              >
                <Undo2 className="h-3.5 w-3.5" /> {t('panels:header.undo')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleRedo}
                disabled={!canRedo}
                className="gap-2 font-mono text-xs"
              >
                <Redo2 className="h-3.5 w-3.5" /> {t('panels:header.redo')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => autoArrange()} className="gap-2 font-mono text-xs">
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
            className="h-8 w-8 text-flow-text-muted hover:bg-flow-elevated hover:text-flow-text"
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
