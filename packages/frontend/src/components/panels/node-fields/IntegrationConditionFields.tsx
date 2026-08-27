import type { FlowNode } from '@flow/shared';
import { dump, load } from 'js-yaml';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { TargetEditor, type TargetIds } from '@/components/forms/TargetEditor';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getNodeDataObject } from '@/utils/nodeData';

/** Fields the common PropertyPanel section and the condition-type selector already own —
 * excluded from both the key/value list and the raw-YAML foldout below so nothing is edited
 * from two places at once. */
const COMMON_CONDITION_KEYS: Record<string, true> = {
  alias: true,
  condition: true,
  enabled: true,
  note: true,
};

/** Serializes an option value for its per-key YAML sub-editor; mirrors ServiceDataFields'
 * toYamlText convention (strings render as-is, everything else is YAML-dumped). */
function toYamlText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return dump(value).trimEnd();
  } catch {
    return String(value);
  }
}

/** Parses a per-key YAML sub-editor back into a value, falling back to the raw text on a parse
 * failure rather than throwing — mirrors ServiceDataFields' fromYamlText convention. */
function fromYamlText(text: string): unknown {
  try {
    return load(text);
  } catch {
    return text;
  }
}

interface IntegrationConditionFieldsProps {
  node: FlowNode;
  conditionType: string;
  onChange: (key: string, value: unknown) => void;
}

/**
 * A3 purpose-specific ("integration") condition editor (design doc §6): HA 2026.x added ~135
 * `domain.verb` condition types (battery.is_level, climate.is_heating, motion.is_detected, ...)
 * that use a `target`/`options` shape instead of the 11 legacy types' entity_id/above/below.
 * There's no per-type field catalog to drive a dedicated form the way triggers/legacy conditions
 * get one (config/conditionFields.ts), so this renders whatever keys are actually present:
 * `target` via the shared TargetEditor (which is how entity_id ends up going through
 * EntityPicker), `options` as a key/value list, anything else as a plain field — plus a YAML
 * foldout as the full escape hatch. Every row's onChange only ever touches its own key, so
 * unrecognized or unedited data stays byte-preserved.
 */
export function IntegrationConditionFields({
  node,
  conditionType,
  onChange,
}: IntegrationConditionFieldsProps) {
  const { t } = useTranslation(['nodes']);
  const nodeData = node.data as Record<string, unknown>;
  const target = getNodeDataObject<TargetIds>(node, 'target', {});
  const options = getNodeDataObject<Record<string, unknown>>(node, 'options', {});
  const hasTarget = nodeData.target !== undefined;
  const hasOptions = nodeData.options !== undefined;
  const otherKeys = Object.keys(nodeData).filter(
    (key) => !COMMON_CONDITION_KEYS[key] && key !== 'target' && key !== 'options'
  );

  return (
    <div className="flex flex-col gap-4">
      <FormField label={t('nodes:conditions.conditionLabel')}>
        <div className="flex items-center gap-2 rounded-flow-control border border-flow-border bg-flow-elevated px-3 py-2">
          <span className="shrink-0 rounded-full bg-flow-accent-subtle px-2 py-0.5 font-mono text-flow-accent text-xs">
            {conditionType}
          </span>
          <span className="text-flow-text-muted text-xs">
            {t('nodes:conditions.integration.hint')}
          </span>
        </div>
      </FormField>

      {hasTarget && (
        <FormField label={t('nodes:conditions.integration.targetLabel')}>
          <TargetEditor target={target} onChange={(next) => onChange('target', next)} />
        </FormField>
      )}

      {hasOptions && (
        <FormField label={t('nodes:conditions.integration.optionsLabel')}>
          <div className="flex flex-col gap-2">
            {Object.entries(options).map(([optionKey, value]) => (
              <IntegrationOptionRow
                key={optionKey}
                optionKey={optionKey}
                value={value}
                onChange={(next) => onChange('options', { ...options, [optionKey]: next })}
              />
            ))}
          </div>
        </FormField>
      )}

      {otherKeys.map((key) => (
        <IntegrationOptionRow
          key={key}
          optionKey={key}
          value={nodeData[key]}
          onChange={(next) => onChange(key, next)}
        />
      ))}

      <IntegrationYamlFoldout key={node.id} data={nodeData} onChange={onChange} />
    </div>
  );
}

/** One key/value row: a Switch/Input for primitives, a YAML sub-editor for anything nested. */
function IntegrationOptionRow({
  optionKey,
  value,
  onChange,
}: {
  optionKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-flow-text-secondary text-xs">{optionKey}</span>
        <Switch checked={value} onCheckedChange={onChange} />
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="flex items-center gap-2">
        <span className="w-1/3 shrink-0 truncate font-mono text-flow-text-secondary text-xs">
          {optionKey}
        </span>
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className="flex-1"
        />
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="flex items-center gap-2">
        <span className="w-1/3 shrink-0 truncate font-mono text-flow-text-secondary text-xs">
          {optionKey}
        </span>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
      </div>
    );
  }

  // Object/array/null values: no single-line input represents them safely — edit as YAML,
  // mirroring ServiceDataFields' catch-all for unhandled service-field selector types.
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-flow-text-secondary text-xs">{optionKey}</span>
      <Textarea
        value={toYamlText(value)}
        onChange={(e) => onChange(fromYamlText(e.target.value))}
        className="font-mono text-xs"
        rows={3}
      />
    </div>
  );
}

/**
 * Full escape hatch: dumps every present, not-common-section key as one YAML document and
 * writes changes back key-by-key through `onChange` (removed keys become `onChange(key,
 * undefined)`, matching PropertyPanel's own delete-a-property convention). Parse failures keep
 * showing exactly what the user typed instead of reverting or propagating a broken value —
 * mirrors PropertyEditor's "invalid JSON, don't update" convention for structured properties.
 */
function IntegrationYamlFoldout({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { t } = useTranslation(['nodes']);
  const [open, setOpen] = useState(false);
  const presentEntries = Object.entries(data).filter(([key]) => !COMMON_CONDITION_KEYS[key]);
  const [text, setText] = useState(() => dump(Object.fromEntries(presentEntries)).trimEnd());

  // Re-sync the buffer when `data` changes for a reason other than this box's own edit (e.g. a
  // sibling key/value row above changed an option) — but never fight the user's own in-progress
  // typing: only overwrite `text` when it doesn't already represent the current upstream data.
  // `text` intentionally excluded: reading it here must not re-trigger the effect on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    const upstream = dump(
      Object.fromEntries(Object.entries(data).filter(([key]) => !COMMON_CONDITION_KEYS[key]))
    ).trimEnd();
    let currentAsUpstream: string | null;
    try {
      const parsed = load(text);
      currentAsUpstream =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? dump(parsed).trimEnd()
          : null;
    } catch {
      currentAsUpstream = null;
    }
    if (currentAsUpstream !== upstream) {
      setText(upstream);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleTextChange = (nextText: string) => {
    setText(nextText);

    let parsed: unknown;
    try {
      parsed = load(nextText);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;

    const nextData = parsed as Record<string, unknown>;
    for (const [key] of presentEntries) {
      if (!(key in nextData)) onChange(key, undefined);
    }
    for (const [key, value] of Object.entries(nextData)) {
      onChange(key, value);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 font-mono text-flow-text-muted text-xs hover:text-flow-text-secondary">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {t('nodes:yamlFoldout.toggle')}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <Textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          className="font-mono text-xs"
          rows={Math.min(Math.max(presentEntries.length * 2, 4), 14)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
