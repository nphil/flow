import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import './index.css';
import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import { DirtyGuardDialog } from '@/components/layout/DirtyGuardDialog';
import { Header } from '@/components/layout/Header';
import { LeftPanel } from '@/components/layout/LeftPanel';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { RightPanel } from '@/components/layout/RightPanel';
import { AutomationSaveDialog } from '@/components/panels/AutomationSaveDialog';
import { ConnectScreen } from '@/components/panels/ConnectScreen';
import { NodePalette } from '@/components/panels/NodePalette';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ResizablePanel } from '@/components/ui/resizable-panel';
import { useDirtyGuard } from '@/hooks/useDirtyGuard';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useHass } from './contexts/HassContext';
import { useFlowTheme } from './hooks/useFlowTheme';
import { useLanguage } from './hooks/useLanguage';

function App() {
  const { t } = useTranslation(['common', 'errors', 'dialogs', 'panels']);
  const { hass, isRemote, connectionError, config, setConfig } = useHass();

  // Applies the Flow design-token theme (data-theme on <html>) and resolves light/dark
  // (design doc §12: standalone falls back to prefers-color-scheme, see useFlowTheme.ts).
  const { mode } = useFlowTheme();
  useLanguage();
  const isMobile = useIsMobile();
  const dirtyGuard = useDirtyGuard();

  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // Bridges Flow's own theme onto the legacy shadcn `.dark` class every shared ui/* primitive
  // (Button, Dialog, Input, ...) still reads until Wave 3 deletes that HSL token system.
  useEffect(() => {
    document.body.classList.toggle('dark', mode === 'dark');
  }, [mode]);

  useEffect(() => {
    if (!isMobile) {
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
    }
  }, [isMobile]);

  const reloadApp = () => window.location.reload();

  // Design doc §12: standalone mode (no parent hass) boots to a full-screen connect gate
  // instead of the app shell until a validated connection exists.
  if (isRemote && !hass) {
    return <ConnectScreen config={config} connectionError={connectionError} onConnect={setConfig} />;
  }

  return (
    <ErrorBoundary
      FallbackComponent={({ error }) => (
        <Dialog open={true} onOpenChange={reloadApp}>
          <DialogContent className="flex w-[90vw] max-w-full flex-col border-flow-border bg-flow-panel text-flow-text">
            <DialogHeader>
              <DialogTitle className="font-serif text-flow-text">{t('dialogs:error.title')}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="text-flow-text-secondary">
              {t('dialogs:error.description')}
            </DialogDescription>
            <div className="space-y-4">
              <pre className="max-h-60 overflow-auto rounded-flow-control border border-[var(--danger)] bg-flow-bg p-4 font-mono text-[var(--danger)] text-sm">
                {error.message}
                <br />
                {error.stack}
              </pre>
              <div className="text-flow-text-secondary">{t('dialogs:error.refreshPrompt')}</div>
              <Button onClick={reloadApp} className="bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover">
                {t('buttons.refresh')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    >
      <ReactFlowProvider>
        <div className="flex h-screen flex-col bg-flow-bg">
          <Header
            dirtyGuard={dirtyGuard}
            isMobile={isMobile}
            onRequestSave={() => setSaveDialogOpen(true)}
            onToggleLeftDrawer={() => setLeftDrawerOpen(true)}
            onToggleRightDrawer={() => setRightDrawerOpen(true)}
          />

          <div className="flex min-h-0 flex-1 overflow-hidden">
            {!isMobile && <LeftPanel />}

            <main className="flex min-h-0 flex-1 flex-col">
              <FlowCanvas />
            </main>

            {!isMobile && (
              <ResizablePanel
                side="right"
                defaultWidth={340}
                minWidth={280}
                maxWidth={560}
                storageKey="flow.panel.right"
                className="border-flow-border border-l bg-flow-panel"
              >
                <RightPanel dirtyGuard={dirtyGuard} className="h-full" />
              </ResizablePanel>
            )}
          </div>
        </div>

        {isMobile && (
          <>
            <MobileDrawer
              open={leftDrawerOpen}
              onClose={() => setLeftDrawerOpen(false)}
              side="left"
              title={t('labels.nodes')}
            >
              <NodePalette />
            </MobileDrawer>
            <MobileDrawer
              open={rightDrawerOpen}
              onClose={() => setRightDrawerOpen(false)}
              side="right"
            >
              <RightPanel dirtyGuard={dirtyGuard} className="h-full" />
            </MobileDrawer>
          </>
        )}

        <DirtyGuardDialog
          open={dirtyGuard.isPending}
          onCancel={dirtyGuard.cancel}
          onDiscard={dirtyGuard.proceed}
          onSave={() => setSaveDialogOpen(true)}
        />
        <AutomationSaveDialog
          isOpen={saveDialogOpen}
          onClose={() => setSaveDialogOpen(false)}
          onSaved={() => {
            setSaveDialogOpen(false);
            if (dirtyGuard.isPending) dirtyGuard.proceed();
          }}
        />

        <Toaster />
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}

export default App;
