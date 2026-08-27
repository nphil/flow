import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DeleteAutomationDialogProps {
  open: boolean;
  automationName: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Overflow menu → Delete (design doc §4): destructive, unrelated to the unsaved-changes guard. */
export function DeleteAutomationDialog({
  open,
  automationName,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteAutomationDialogProps) {
  const { t } = useTranslation(['dialogs', 'common']);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isDeleting) onCancel();
      }}
    >
      <DialogContent className="max-w-md border-flow-border bg-flow-panel text-flow-text shadow-flow-modal">
        <DialogHeader>
          <DialogTitle className="font-serif text-flow-text">
            {t('dialogs:deleteAutomation.title')}
          </DialogTitle>
          <DialogDescription className="text-flow-text-secondary">
            {t('dialogs:deleteAutomation.description', { name: automationName })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isDeleting}
            className="text-flow-text hover:bg-flow-elevated"
          >
            {t('common:buttons.cancel')}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-[var(--danger)] text-flow-on-accent hover:brightness-90"
          >
            {isDeleting ? t('dialogs:deleteAutomation.deleting') : t('common:buttons.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
