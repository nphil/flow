import { type AutomationMode, isRecord, MAX_EXCEEDED_LEVELS } from '@flow/shared';
import { dump, load } from 'js-yaml';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { FLOW_TEXT } from '@/lib/flow-kind-text';
import { useFlowStore } from '@/store/flow-store';

const AUTOMATION_MODES: AutomationMode[] = ['single', 'restart', 'queued', 'parallel'];
const MODES_WITH_MAX = new Set<AutomationMode>(['queued', 'parallel']);

/**
 * Script only: the icon and the inputs the script takes (`fields`, kept as Home Assistant stores
 * them). The inputs are edited as YAML text and applied when the field loses focus; an unchanged
 * text never marks the flow as edited.
 */
function ScriptSettingsFields() {
  const { t } = useTranslation('common');
  const icon = useFlowStore((s) => s.flowMetadata.icon);
  const fields = useFlowStore((s) => s.flowMetadata.fields);
  const setFlowMetadata = useFlowStore((s) => s.setFlowMetadata);

  const stored = useMemo(() => (fields ? dump(fields) : ''), [fields]);
  const [draft, setDraft] = useState(stored);
  const [parseError, setParseError] = useState<string | null>(null);

  // The inputs changed outside this box (undo, another flow opened): show them.
  useEffect(() => {
    setDraft(stored);
    setParseError(null);
  }, [stored]);

  const applyFields = () => {
    if (draft === stored) {
      setParseError(null);
      return;
    }
    let next: unknown;
    try {
      next = draft.trim() === '' ? undefined : load(draft);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (next !== undefined && !isRecord(next)) {
      setParseError(t('scriptSettings.fieldsNotMapping'));
      return;
    }
    setParseError(null);
    if (JSON.stringify(next) !== JSON.stringify(fields)) {
      setFlowMetadata({ fields: next });
    }
  };

  return (
    <>
      <FormField label={t('scriptSettings.icon')} description={t('scriptSettings.iconDescription')}>
        <Input
          type="text"
          value={icon ?? ''}
          onChange={(e) =>
            setFlowMetadata({ icon: e.target.value === '' ? undefined : e.target.value })
          }
          placeholder="mdi:script-text"
        />
      </FormField>

      <FormField
        label={t('scriptSettings.fields')}
        description={t('scriptSettings.fieldsDescription')}
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={applyFields}
          placeholder={t('scriptSettings.fieldsPlaceholder')}
          rows={8}
          spellCheck={false}
          className="font-mono text-xs"
          aria-invalid={parseError !== null}
        />
        {parseError && (
          <p role="alert" className="whitespace-pre-wrap font-mono text-flow-danger text-xs">
            {parseError}
          </p>
        )}
        {draft !== stored && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={applyFields}
            className="self-start"
          >
            {t('scriptSettings.applyFields')}
          </Button>
        )}
      </FormField>
    </>
  );
}

export function FlowSettingsPanel() {
  const { t } = useTranslation(['common']);
  const flowKind = useFlowStore((s) => s.flowKind);
  const text = FLOW_TEXT[flowKind];
  const flowName = useFlowStore((s) => s.flowName);
  const flowDescription = useFlowStore((s) => s.flowDescription);
  const setFlowName = useFlowStore((s) => s.setFlowName);
  const setFlowDescription = useFlowStore((s) => s.setFlowDescription);
  const flowMetadata = useFlowStore((s) => s.flowMetadata);
  const setFlowMetadata = useFlowStore((s) => s.setFlowMetadata);

  const mode = flowMetadata.mode ?? 'single';
  const showMaxFields = MODES_WITH_MAX.has(mode);

  const handleModeChange = (value: string) => {
    const newMode = value as AutomationMode;
    const updates: Partial<typeof flowMetadata> = { mode: newMode };

    // Clear max/max_exceeded when switching to a mode that doesn't support them
    if (!MODES_WITH_MAX.has(newMode)) {
      updates.max = undefined;
      updates.max_exceeded = undefined;
    }

    setFlowMetadata(updates);
  };

  const handleMaxChange = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (value === '' || Number.isNaN(parsed)) {
      setFlowMetadata({ max: undefined });
    } else if (parsed > 0) {
      setFlowMetadata({ max: parsed });
    }
  };

  const handleMaxExceededChange = (value: string) => {
    setFlowMetadata({ max_exceeded: value === 'none' ? undefined : value });
  };

  return (
    <div className="h-full flex-1 space-y-4 overflow-y-auto p-4">
      <h3 className="mt-1.5 font-semibold text-flow-text text-sm">{t(text.settingsTitle)}</h3>

      <FormField label={t(text.nameLabel)}>
        <Input
          type="text"
          value={flowName}
          onChange={(e) => setFlowName(e.target.value)}
          placeholder={t(text.enterName)}
        />
      </FormField>

      <FormField label={t('automationSettings.description')}>
        <Textarea
          value={flowDescription}
          onChange={(e) => setFlowDescription(e.target.value)}
          placeholder={t(text.describe)}
          rows={3}
        />
      </FormField>

      <Separator />

      <FormField label={t('automationSettings.mode')} description={t(text.modeDescription)}>
        <Select value={mode} onValueChange={handleModeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTOMATION_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {t(`automationSettings.modes.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-flow-text-muted text-xs">
          {t(`automationSettings.modeDescriptions.${mode}`)}
        </p>
      </FormField>

      {showMaxFields && (
        <>
          <FormField
            label={t('automationSettings.max')}
            description={t('automationSettings.maxDescription')}
          >
            <Input
              type="number"
              min={1}
              value={flowMetadata.max ?? ''}
              onChange={(e) => handleMaxChange(e.target.value)}
              placeholder="10"
            />
          </FormField>

          {flowMetadata.max != null && (
            <FormField
              label={t('automationSettings.maxExceeded')}
              description={t('automationSettings.maxExceededDescription')}
            >
              <Select
                value={flowMetadata.max_exceeded ?? 'none'}
                onValueChange={handleMaxExceededChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('placeholders.none')}</SelectItem>
                  {MAX_EXCEEDED_LEVELS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {t(`automationSettings.maxExceededOptions.${opt}`)}
                    </SelectItem>
                  ))}
                  {/* Hand-written YAML may use another spelling (WARN, fatal): keep it as is. */}
                  {flowMetadata.max_exceeded &&
                    !MAX_EXCEEDED_LEVELS.some((opt) => opt === flowMetadata.max_exceeded) && (
                      <SelectItem value={flowMetadata.max_exceeded}>
                        {flowMetadata.max_exceeded}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </FormField>
          )}
        </>
      )}

      {flowKind === 'script' && (
        <>
          <Separator />
          <ScriptSettingsFields />
        </>
      )}
    </div>
  );
}
