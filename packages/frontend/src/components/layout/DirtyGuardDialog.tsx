import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DirtyGuardDialogProps {
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}

/**
 * Design doc §0/§4: "Never lose user work" -- shown by `useDirtyGuard` before switching
 * automations, starting a new one, or applying an import while the canvas has unsaved changes.
 */
export function DirtyGuardDialog({ open, onCancel, onDiscard, onSave }: DirtyGuardDialogProps) {
  const { t } = useTranslation(['dialogs', 'common']);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md border-flow-border bg-flow-panel text-flow-text shadow-flow-modal">
        <DialogHeader>
          <DialogTitle className="font-serif text-flow-text">
            {t('dialogs:dirtyGuard.title')}
          </DialogTitle>
          <DialogDescription className="text-flow-text-secondary">
            {t('dialogs:dirtyGuard.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="text-flow-text hover:bg-flow-elevated"
          >
            {t('common:buttons.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={onDiscard}
            className="border-flow-border text-[var(--danger)] hover:bg-flow-elevated"
          >
            {t('dialogs:dirtyGuard.discard')}
          </Button>
          <Button
            onClick={onSave}
            className="bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover"
          >
            {t('common:buttons.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
