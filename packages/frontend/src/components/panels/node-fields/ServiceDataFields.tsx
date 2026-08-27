import { dump, load } from 'js-yaml';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AreaPicker } from '@/components/forms/AreaPicker';
import { DevicePicker, MultiDevicePicker } from '@/components/forms/DevicePicker';
import { EntityPicker, MultiEntityPicker } from '@/components/forms/EntityPicker';
import { FormField } from '@/components/forms/FormField';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useHass } from '@/contexts/HassContext';

interface ServiceField {
  name?: string;
  description?: string;
  example?: unknown;
  required?: boolean;
  selector?: Record<string, unknown>;
}

interface ServiceDataFieldsProps {
  serviceFields: Record<string, ServiceField>;
  currentData: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}

/** Serializes an arbitrary field value for the YAML sub-editor. Strings render as-is (no
 * quoting noise); everything else is YAML-dumped so it's human-editable. */
function toYamlText(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return dump(value).trimEnd();
  } catch {
    return String(value);
  }
}

/** Parses YAML sub-editor input back into a value. On parse failure, keeps the raw string
 * rather than throwing (mirrors DynamicFieldRenderer's `case 'object'` JSON try/catch, but
 * YAML is more forgiving for scalars/multi-line text like templates). */
function fromYamlText(text: string): unknown {
  try {
    return load(text);
  } catch {
    return text;
  }
}

/** Minor case: HA area selectors are typically single, but `multiple: true` is possible.
 * No MultiAreaPicker exists in the picker contract, so this is a lightweight local
 * chip-row mirroring MultiEntityPicker's shape, built on the single-select AreaPicker. */
function MultiAreaChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { areas } = useHass();
  const areaById = new Map(areas.map((area) => [area.area_id, area]));
  const handleRemove = (id: string) => onChange(value.filter((existing) => existing !== id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1.5 rounded-flow-control border border-flow-border bg-flow-elevated py-0.5 pr-1 pl-2 text-flow-text-secondary text-xs"
        >
          {areaById.get(id)?.name ?? id}
          <button
            type="button"
            onClick={() => handleRemove(id)}
            aria-label={`Remove ${id}`}
            className="shrink-0 rounded-full p-0.5 text-flow-text-muted hover:bg-flow-panel hover:text-flow-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <AreaPicker
        value=""
        onChange={(id) => {
          if (id && !value.includes(id)) onChange([...value, id]);
        }}
        placeholder="+ Area"
        className="w-32"
      />
    </div>
  );
}

/**
 * Renders dynamic service data fields based on service definition.
 * Replaces the duplicated service field rendering logic.
 */
export function ServiceDataFields({
  serviceFields,
  currentData,
  onChange,
}: ServiceDataFieldsProps) {
  const { t } = useTranslation(['common', 'nodes']);
  if (Object.keys(serviceFields).length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3">
      <h4 className="mb-3 font-semibold text-muted-foreground text-xs">
        {t('nodes:serviceDataFields.heading')}
      </h4>
      {Object.entries(serviceFields).map(([fieldName, field]) => {
        const selector = field.selector || {};
        const selectorType = Object.keys(selector)[0];
        const selectorConfig = selector[selectorType] || {};
        const currentValue = currentData[fieldName] as string | number | boolean | undefined;

        // Use field.name if available, otherwise format fieldName as label
        const fieldLabel =
          field.name || fieldName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

        // Render input based on selector type
        if (selectorType === 'number') {
          const config = selectorConfig as {
            min?: number;
            max?: number;
            unit_of_measurement?: string;
          };

          return (
            <FormField
              key={fieldName}
              label={`${fieldLabel}${config.unit_of_measurement ? ` (${config.unit_of_measurement})` : ''}`}
              required={field.required}
              description={field.description}
            >
              <Input
                type="number"
                value={(currentValue as number) ?? ''}
                onChange={(e) => onChange(fieldName, e.target.value ? Number(e.target.value) : '')}
                min={config.min}
                max={config.max}
                placeholder={field.example !== undefined ? String(field.example) : ''}
              />
            </FormField>
          );
        }

        if (selectorType === 'select') {
          const config = selectorConfig as { options?: string[] };

          return (
            <FormField
              key={fieldName}
              label={fieldLabel}
              required={field.required}
              description={field.description}
            >
              <Select
                value={String(currentValue === '' ? '__NONE__' : (currentValue ?? '__NONE__'))}
                onValueChange={(value) => onChange(fieldName, value === '__NONE__' ? '' : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('placeholders.none')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">{t('placeholders.none')}</SelectItem>
                  {config.options?.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          );
        }

        if (selectorType === 'boolean') {
          return (
            <div key={fieldName} className="mb-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={(currentValue as boolean) ?? false}
                onChange={(e) => onChange(fieldName, e.target.checked)}
                className="rounded"
              />
              <Label className="font-medium text-muted-foreground text-xs">
                {fieldLabel}
                {field.required && (
                  <span className="ml-0.5 text-destructive">{t('labels.requiredAsterisk')}</span>
                )}
              </Label>
            </div>
          );
        }

        if (selectorType === 'entity') {
          const config = selectorConfig as { multiple?: boolean };
          const isMultiple = config.multiple === true;

          if (isMultiple) {
            // Normalize value to array for multi-entity picker
            const arrayValue = Array.isArray(currentValue)
              ? (currentValue as string[])
              : currentValue
                ? [String(currentValue)]
                : [];

            return (
              <FormField
                key={fieldName}
                label={fieldLabel}
                required={field.required}
                description={field.description}
              >
                <MultiEntityPicker
                  value={arrayValue}
                  onChange={(value) => onChange(fieldName, value)}
                  placeholder={field.example !== undefined ? String(field.example) : undefined}
                />
              </FormField>
            );
          }

          return (
            <FormField
              key={fieldName}
              label={fieldLabel}
              required={field.required}
              description={field.description}
            >
              <EntityPicker
                value={String(currentValue ?? '')}
                onChange={(value) => onChange(fieldName, value)}
                placeholder={field.example !== undefined ? String(field.example) : undefined}
              />
            </FormField>
          );
        }

        if (selectorType === 'device') {
          const config = selectorConfig as { multiple?: boolean };
          const isMultiple = config.multiple === true;

          if (isMultiple) {
            const arrayValue = Array.isArray(currentValue)
              ? (currentValue as string[])
              : currentValue
                ? [String(currentValue)]
                : [];

            return (
              <FormField
                key={fieldName}
                label={fieldLabel}
                required={field.required}
                description={field.description}
              >
                <MultiDevicePicker
                  value={arrayValue}
                  onChange={(value) => onChange(fieldName, value)}
                  placeholder={field.example !== undefined ? String(field.example) : undefined}
                />
              </FormField>
            );
          }

          return (
            <FormField
              key={fieldName}
              label={fieldLabel}
              required={field.required}
              description={field.description}
            >
              <DevicePicker
                value={String(currentValue ?? '')}
                onChange={(value) => onChange(fieldName, value)}
                placeholder={field.example !== undefined ? String(field.example) : undefined}
              />
            </FormField>
          );
        }

        if (selectorType === 'area') {
          const config = selectorConfig as { multiple?: boolean };
          const isMultiple = config.multiple === true;

          if (isMultiple) {
            const arrayValue = Array.isArray(currentValue)
              ? (currentValue as string[])
              : currentValue
                ? [String(currentValue)]
                : [];

            return (
              <FormField
                key={fieldName}
                label={fieldLabel}
                required={field.required}
                description={field.description}
              >
                <MultiAreaChips
                  value={arrayValue}
                  onChange={(value) => onChange(fieldName, value)}
                />
              </FormField>
            );
          }

          return (
            <FormField
              key={fieldName}
              label={fieldLabel}
              required={field.required}
              description={field.description}
            >
              <AreaPicker
                value={String(currentValue ?? '')}
                onChange={(value) => onChange(fieldName, value)}
                placeholder={field.example !== undefined ? String(field.example) : undefined}
              />
            </FormField>
          );
        }

        if (selectorType === 'text') {
          return (
            <FormField
              key={fieldName}
              label={fieldLabel}
              required={field.required}
              description={field.description}
            >
              <Input
                type="text"
                value={(currentValue as string) ?? ''}
                onChange={(e) => onChange(fieldName, e.target.value)}
                placeholder={field.example !== undefined ? String(field.example) : ''}
              />
            </FormField>
          );
        }

        // Fallback: YAML sub-editor for every other selector type (object, time, date,
        // datetime, duration, color_rgb, color_temp, icon, media, target, action, condition,
        // template, and any future/unknown selector) — never drop a field we can't render a
        // dedicated control for.
        return (
          <FormField
            key={fieldName}
            label={fieldLabel}
            required={field.required}
            description={field.description}
          >
            <Textarea
              value={toYamlText(currentData[fieldName])}
              onChange={(e) => onChange(fieldName, fromYamlText(e.target.value))}
              placeholder={field.example !== undefined ? String(field.example) : ''}
              className="font-mono text-sm"
              rows={3}
            />
          </FormField>
        );
      })}
    </div>
  );
}
