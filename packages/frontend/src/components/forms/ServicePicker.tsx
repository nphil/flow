import { useMemo } from 'react';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { useHass } from '@/contexts/HassContext';
import { cn } from '@/lib/utils';

type ServiceOption = ComboboxOption & {
  domain: string;
  service: string;
  descriptionLabel?: string;
};

interface ServicePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Combobox over every registered HA service (`useHass().getAllServices()`), grouped by
 * domain. Option value is `${domain}.${service}`; secondary text shows the service
 * definition's name/description when the integration provides one.
 */
export function ServicePicker({
  value,
  onChange,
  placeholder = 'Select service...',
  className,
}: ServicePickerProps) {
  const { getAllServices } = useHass();

  const options: ServiceOption[] = useMemo(
    () =>
      getAllServices().map(({ domain, service, definition }) => ({
        value: `${domain}.${service}`,
        label: `${domain}.${service}`,
        domain,
        service,
        descriptionLabel: definition.name || definition.description || undefined,
      })),
    [getAllServices]
  );

  return (
    <div className={cn('relative', className)}>
      <Combobox<ServiceOption>
        options={options}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        buttonClassName={cn(!value && 'text-flow-text-muted')}
        disabled={options.length === 0}
        searchKeys={['label', 'descriptionLabel']}
        groupBy={(option) => option.domain}
        renderOption={(option) => (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-mono">{option.label}</span>
            {option.descriptionLabel && (
              <span className="truncate text-flow-text-muted text-xs">
                {option.descriptionLabel}
              </span>
            )}
          </div>
        )}
        renderValue={(option) =>
          option ? <span className="truncate font-mono">{option.label}</span> : null
        }
      />
    </div>
  );
}
