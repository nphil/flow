import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { version } from '../../../../../custom_components/flow/manifest.json';
import { FlowMark } from './FlowMark';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useTranslation(['dialogs', 'common']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-flow-border bg-flow-panel text-flow-text shadow-flow-modal">
        <DialogHeader className="items-center text-center">
          <FlowMark size={40} className="mb-1 text-flow-text" />
          <DialogTitle
            className="font-serif text-2xl text-flow-text"
            style={{ letterSpacing: '-0.01em', fontWeight: 600 }}
          >
            {'Flow'}
          </DialogTitle>
          <DialogDescription className="text-flow-text-secondary">
            {t('dialogs:about.tagline')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-center font-mono text-flow-text-muted text-xs">
          <p>{t('dialogs:about.version', { version })}</p>
          <p>{t('dialogs:about.attribution')}</p>
          <div className="flex justify-center gap-4">
            <a
              href="https://github.com/nphil/haflow"
              target="_blank"
              rel="noopener noreferrer"
              className="ui-focus-ring rounded-flow-control text-flow-accent hover:text-flow-accent-hover hover:underline"
            >
              {'GitHub'}
            </a>
            <a
              href="https://github.com/FezVrasta/cafe-hass"
              target="_blank"
              rel="noopener noreferrer"
              className="ui-focus-ring rounded-flow-control text-flow-accent hover:text-flow-accent-hover hover:underline"
            >
              {t('dialogs:about.originalProject')}
            </a>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          className="mt-2 border-flow-border text-flow-text hover:bg-flow-elevated"
        >
          {t('common:buttons.close')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
