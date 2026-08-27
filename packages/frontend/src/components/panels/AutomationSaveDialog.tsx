import { AlertTriangle, Check, Copy, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useHass } from '@/contexts/HassContext';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { useFlowStore } from '@/store/flow-store';

interface AutomationSaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (automationId: string) => void;
}

export function AutomationSaveDialog({ isOpen, onClose, onSaved }: AutomationSaveDialogProps) {
  const { t } = useTranslation(['common', 'dialogs', 'errors']);
  const {
    flowName,
    flowDescription,
    automationId,
    isSaving,
    setFlowName,
    setFlowDescription,
    setAutomationId,
    saveAutomation,
    updateAutomation,
  } = useFlowStore();

  const { hass, config: hassConfig } = useHass();

  const [localDescription, setLocalDescription] = useState(flowDescription);
  const [error, setError] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);

  const isUpdate = !!automationId;

  // Sync local description with store when dialog opens
  useEffect(() => {
    if (isOpen) {
      setLocalDescription(flowDescription);
      setError(null);
      setSuggestedName(null);
    }
  }, [isOpen, flowDescription]);

  // Check for name conflicts when name changes
  const checkNameConflict = async (name: string) => {
    if (!name.trim()) {
      setSuggestedName(null);
      return;
    }

    try {
      const exists = await getHomeAssistantAPI(hass, hassConfig).automationExistsByAlias(name);
      if (exists && !isUpdate) {
        const uniqueName = await getHomeAssistantAPI(hass, hassConfig).getUniqueAutomationAlias(name);
        setSuggestedName(uniqueName);
      } else {
        setSuggestedName(null);
      }
    } catch (err) {
      console.warn('Failed to check name conflict:', err);
      setSuggestedName(null);
    }
  };

  const handleSave = async () => {
    if (!hass) {
      setError(t('errors:connection.notConnected'));
      return;
    }

    if (!flowName.trim()) {
      setError(t('errors:form.nameRequired'));
      return;
    }

    setError(null);

    try {
      // Update the flow store with the description
      setFlowDescription(localDescription.trim());

      let resultId: string;
      if (isUpdate) {
        await updateAutomation(hass);
        resultId = automationId || '';
      } else {
        resultId = await saveAutomation(hass);
      }

      onSaved?.(resultId);
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('errors:api.unknownError');
      setError(errorMessage);
    }
  };

  const handleClose = () => {
    setError(null);
    setSuggestedName(null);
    onClose();
  };

  const handleNameChange = (name: string) => {
    setFlowName(name);
    checkNameConflict(name);
  };

  const useSuggestedName = () => {
    if (suggestedName) {
      setFlowName(suggestedName);
      setSuggestedName(null);
    }
  };

  const handleSaveAsCopy = async () => {
    if (!hass) {
      setError(t('errors:connection.notConnected'));
      return;
    }

    setError(null);

    try {
      // Get a unique name for the copy
      const copyName = await getHomeAssistantAPI(hass, hassConfig).getUniqueAutomationAlias(flowName);
      setFlowName(copyName);
      setFlowDescription(localDescription.trim());

      // Clear the automation ID to force creating a new one
      setAutomationId(null);

      // Save as new automation
      const resultId = await saveAutomation(hass);

      onSaved?.(resultId);
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('errors:api.unknownError');
      setError(errorMessage);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-flow-border bg-flow-panel text-flow-text shadow-flow-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-flow-text">
            <Save className="h-5 w-5" />
            {isUpdate ? t('dialogs:save.titleUpdate') : t('dialogs:save.title')}
          </DialogTitle>
          <DialogDescription className="text-flow-text-secondary">
            {isUpdate ? t('dialogs:save.descriptionUpdate') : t('dialogs:save.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="automation-name" className="font-mono text-flow-text-muted text-xs">
              {t('dialogs:save.nameLabel')}
            </Label>
            <Input
              id="automation-name"
              value={flowName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('placeholders.enterAutomationName')}
              disabled={isSaving}
              className="border-flow-border bg-flow-bg font-mono text-flow-text placeholder:text-flow-text-muted focus-visible:ring-[var(--accent)]"
            />
          </div>

          {suggestedName && (
            <div className="flex items-center justify-between gap-2 rounded-flow-control border border-[var(--warn)] p-2.5 font-mono text-[var(--warn)] text-xs">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t('dialogs:save.nameConflict', { suggestedName })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={useSuggestedName}
                disabled={isSaving}
                className="h-7 border-[var(--warn)] text-[var(--warn)] hover:bg-flow-elevated"
              >
                {t('buttons.use')}
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="automation-description" className="font-mono text-flow-text-muted text-xs">
              {t('dialogs:save.descriptionLabel')}
            </Label>
            <Textarea
              id="automation-description"
              value={localDescription}
              onChange={(e) => setLocalDescription(e.target.value)}
              placeholder={t('placeholders.describeAutomation')}
              rows={3}
              disabled={isSaving}
              className="border-flow-border bg-flow-bg font-mono text-flow-text text-sm placeholder:text-flow-text-muted focus-visible:ring-[var(--accent)]"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-flow-control border border-[var(--danger)] p-2.5 font-mono text-[var(--danger)] text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isSaving}
              className="text-flow-text hover:bg-flow-elevated"
            >
              {t('buttons.cancel')}
            </Button>
            {isUpdate && (
              <Button
                variant="outline"
                onClick={handleSaveAsCopy}
                disabled={isSaving || !flowName.trim()}
                className="border-flow-border text-flow-text hover:bg-flow-elevated"
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {t('buttons.saveAsCopy')}
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={isSaving || !flowName.trim()}
              className="bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isUpdate ? t('status.updating') : t('status.saving')}
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  {isUpdate ? t('buttons.update') : t('buttons.save')}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
