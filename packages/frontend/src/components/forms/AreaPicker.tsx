import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { useHass } from '@/contexts/HassContext';
import { cn } from '@/lib/utils';
import type { AreaRegistryEntry } from './registryTypes';

interface AreaPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional area list. If not provided, auto-fetches from useHass(). */
  areas?: AreaRegistryEntry[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/** Fuzzy combobox over the area registry, searching by area name. */
export function AreaPicker({
  value,
  onChange,
  areas: areasProp,
  placeholder = 'Select area...',
  className,
  disabled,
}: AreaPickerProps) {
  const { areas: contextAreas } = useHass();
  const areas = areasProp ?? contextAreas;

  const options: ComboboxOption[] = useMemo(
    () => areas.map((area) => ({ value: area.area_id, label: area.name })),
    [areas]
  );

  const isUnknown = Boolean(value) && !areas.some((area) => area.area_id === value);

  return (
    <div className={cn('relative', className)}>
      <Combobox
        options={options}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        buttonClassName={cn(!value && 'text-flow-text-muted')}
        disabled={disabled || options.length === 0}
        searchKeys={['label']}
      />
      {isUnknown && <div className="mt-1 truncate font-mono text-flow-danger">{value}</div>}
    </div>
  );
}
