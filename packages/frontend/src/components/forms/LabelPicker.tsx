import { Tag } from 'lucide-react';
import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { useHass } from '@/contexts/HassContext';
import { cn } from '@/lib/utils';
import type { LabelRegistryEntry } from './registryTypes';

type LabelOption = ComboboxOption & { color: string | null };

interface LabelPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional label list. If not provided, auto-fetches from useHass(). */
  labels?: LabelRegistryEntry[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Small color swatch for a label. HA label colors are user-chosen named CSS colors
 * (e.g. "red", "blue") coming straight from the user's own data, so applying `color` as an
 * inline `backgroundColor` renders the user's choice rather than hardcoding a palette.
 */
function LabelSwatch({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full border border-flow-border', className)}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/** Fuzzy combobox over the label registry, searching by label name. */
export function LabelPicker({
  value,
  onChange,
  labels: labelsProp,
  placeholder = 'Select label...',
  className,
  disabled,
}: LabelPickerProps) {
  const { labels: contextLabels } = useHass();
  const labels = labelsProp ?? contextLabels;

  const options: LabelOption[] = useMemo(
    () => labels.map((label) => ({ value: label.label_id, label: label.name, color: label.color })),
    [labels]
  );

  const isUnknown = Boolean(value) && !labels.some((label) => label.label_id === value);

  return (
    <div className={cn('relative', className)}>
      <Combobox<LabelOption>
        options={options}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        buttonClassName={cn(!value && 'text-flow-text-muted')}
        disabled={disabled || options.length === 0}
        searchKeys={['label']}
        renderOption={(option) => (
          <div className="flex min-w-0 items-center gap-2">
            <LabelSwatch color={option.color} className="h-2.5 w-2.5" />
            <Tag className="h-3.5 w-3.5 shrink-0 text-flow-text-muted" />
            <span className="truncate">{option.label}</span>
          </div>
        )}
        renderValue={(option) =>
          option ? (
            <div className="flex min-w-0 items-center gap-2">
              <LabelSwatch color={option.color} className="h-2.5 w-2.5" />
              <span className="truncate">{option.label}</span>
            </div>
          ) : null
        }
      />
      {isUnknown && <div className="mt-1 truncate font-mono text-flow-danger">{value}</div>}
    </div>
  );
}
