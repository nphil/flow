import type { FlowKind } from '@flow/shared';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FLOW_TEXT } from '@/lib/flow-kind-text';

interface DeleteFlowDialogProps {
  open: boolean;
  flowKind: FlowKind;
  flowName: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Overflow menu → Delete (design doc §4): destructive, unrelated to the unsaved-changes guard. */
export function DeleteFlowDialog({
  open,
  flowKind,
  flowName,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteFlowDialogProps) {
  const { t } = useTranslation(['dialogs', 'common']);
  const text = FLOW_TEXT[flowKind];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isDeleting) onCancel();
      }}
    >
      <DialogContent className="max-w-md border-flow-border bg-flow-panel text-flow-text shadow-flow-modal">
        <DialogHeader>
          <DialogTitle className="text-flow-text">{t(text.deleteTitle)}</DialogTitle>
          <DialogDescription className="text-flow-text-secondary">
            {t(text.deleteDescription, { name: flowName })}
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
            {isDeleting ? t(text.deleting) : t('common:buttons.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
