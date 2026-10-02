import type { DurationParts } from '@flow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** HH:MM:SS text, a bare number of seconds, or a mapping of units (any unit may be a template). */
export type DurationValue = string | number | DurationParts;

export interface DurationInputProps {
  value: DurationValue;
  onChange: (val: DurationValue) => void;
}

/**
 * Reusable duration input component without label/description wrapper.
 * Supports both string (HH:MM:SS) and object ({ hours, minutes, seconds, milliseconds }) formats.
 */
export function DurationInput({ value, onChange }: DurationInputProps) {
  const { t } = useTranslation(['common', 'nodes']);
  // A bare number of seconds is shown (and edited) as text.
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  const isString = text !== null;
  const obj: DurationParts = typeof value === 'object' && value !== null ? value : {};
  const [useString, setUseString] = useState(isString);

  const handleToggle = (checked: boolean) => {
    setUseString(checked);
    if (checked) {
      // Convert object to string (default HH:MM:SS); whole days fold into the hours.
      const dayHours = Number(obj.days ?? 0) * 24;
      const h = dayHours > 0 ? Number(obj.hours ?? 0) + dayHours : (obj.hours ?? 0);
      const m = obj.minutes ?? 0;
      const s = obj.seconds ?? 0;
      const ms = obj.milliseconds ?? 0;
      const base = [h, m, s].map((n) => n.toString().padStart(2, '0')).join(':');
      const str = ms ? `${base}.${ms}` : base;
      onChange(str);
    } else {
      // Convert string to object (parse HH:MM:SS[.ms])
      if (text !== null) {
        const match = /^([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2})(?:\.(\d{1,3}))?$/.exec(text);
        if (match) {
          const [, h, m, s, ms] = match;
          onChange({
            hours: Number(h),
            minutes: Number(m),
            seconds: Number(s),
            ...(ms ? { milliseconds: Number(ms) } : {}),
          });
        } else {
          onChange({});
        }
      }
    }
  };

  const handleObjChange = (
    field: 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds',
    v: string
  ) => {
    const num = v === '' ? undefined : Number(v);
    const updated = {
      ...obj,
      [field]: Number.isNaN(num) ? undefined : num,
    };
    Object.keys(updated).forEach((k) => {
      const v = updated[k as keyof typeof updated];
      if (v === undefined || v === null) {
        delete updated[k as keyof typeof updated];
      }
    });
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-flow-text-muted text-xs">{t('nodes:durationField.string')}</span>
        <Switch checked={useString} onCheckedChange={handleToggle} />
        <span className="text-flow-text-muted text-xs">{t('nodes:durationField.object')}</span>
      </div>
      {useString ? (
        <Input
          type="text"
          value={text ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('nodes:durationField.placeholder')}
        />
      ) : (
        <div className="flow-field-grid-4">
          <div>
            <Label className="text-flow-text-muted text-xs">{t('nodes:durationField.days')}</Label>
            <Input
              type="number"
              min={0}
              value={obj.days ?? ''}
              onChange={(e) => handleObjChange('days', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-flow-text-muted text-xs">{t('nodes:durationField.hours')}</Label>
            <Input
              type="number"
              min={0}
              value={obj.hours ?? ''}
              onChange={(e) => handleObjChange('hours', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-flow-text-muted text-xs">
              {t('nodes:durationField.minutes')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.minutes ?? ''}
              onChange={(e) => handleObjChange('minutes', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-flow-text-muted text-xs">
              {t('nodes:durationField.seconds')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.seconds ?? ''}
              onChange={(e) => handleObjChange('seconds', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-flow-text-muted text-xs">
              {t('nodes:durationField.milliseconds')}
            </Label>
            <Input
              type="number"
              min={0}
              value={obj.milliseconds ?? ''}
              onChange={(e) => handleObjChange('milliseconds', e.target.value)}
              placeholder="0"
              className="mt-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export interface DurationFieldProps {
  label?: string;
  description?: string;
  value: DurationValue;
  onChange: (val: DurationValue) => void;
  fieldKey?: string; // e.g. 'delay' or 'timeout'
}

/**
 * Duration field with FormField wrapper for label and description.
 */
export function DurationField({ label, description, value, onChange }: DurationFieldProps) {
  const { t } = useTranslation(['common', 'nodes']);

  return (
    <FormField
      label={label ?? t('nodes:durationField.label')}
      description={description || t('nodes:durationField.description')}
    >
      <DurationInput value={value} onChange={onChange} />
    </FormField>
  );
}
