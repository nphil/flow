import { Check, Cpu, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { useHass } from '@/contexts/HassContext';
import { useFuzzySearch } from '@/hooks/useFuzzySearch';
import { cn } from '@/lib/utils';
import {
  FilterChip,
  MAX_RESULTS,
  PickerPopoverShell,
  pushRecentPick,
  readRecentPicks,
} from './pickerPopover';
import type { AreaRegistryEntry, DeviceRegistryEntry } from './registryTypes';

function getDeviceName(device: DeviceRegistryEntry): string {
  return device.name_by_user || device.name || device.id;
}

const RECENT_DEVICES_KEY = 'flow.recent-devices';
const NO_AREA = 'No area';

type SearchableDevice = {
  device: DeviceRegistryEntry;
  id: string;
  name: string;
  areaLabel: string;
  manufacturerModel: string;
};

interface DevicePopoverProps {
  devices: DeviceRegistryEntry[];
  areaById: Map<string, AreaRegistryEntry>;
  selectedIds: string[];
  multiple: boolean;
  onPick: (deviceId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  triggerTitle: string;
}

/** The design doc §14 popover content (device variant: area filter only, no domain/state). */
function DevicePopover({
  devices,
  areaById,
  selectedIds,
  multiple,
  onPick,
  open,
  onOpenChange,
  trigger,
  triggerTitle,
}: DevicePopoverProps) {
  const { t } = useTranslation('common');
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const searchable: SearchableDevice[] = useMemo(
    () =>
      devices.map((device) => ({
        device,
        id: device.id,
        name: getDeviceName(device),
        areaLabel: (device.area_id && areaById.get(device.area_id)?.name) || '',
        manufacturerModel: [device.manufacturer, device.model].filter(Boolean).join(' '),
      })),
    [devices, areaById]
  );

  const { query, setQuery, filteredItems } = useFuzzySearch<SearchableDevice>(searchable, {
    keys: ['name', 'manufacturerModel', 'areaLabel'],
    threshold: 0.35,
    minMatchCharLength: 1,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setRecentIds(readRecentPicks(RECENT_DEVICES_KEY));
    }
  }, [open, setQuery]);

  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of filteredItems) {
      const key = item.areaLabel || NO_AREA;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({ value, label: value, count })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [filteredItems]);

  const matches = useMemo(
    () =>
      areaFilter
        ? filteredItems.filter((item) => (item.areaLabel || NO_AREA) === areaFilter)
        : filteredItems,
    [filteredItems, areaFilter]
  );

  const capped = matches.slice(0, MAX_RESULTS);
  const remaining = matches.length - capped.length;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byArea = new Map<string, SearchableDevice[]>();
    for (const item of capped) {
      const key = item.areaLabel || NO_AREA;
      const existing = byArea.get(key);
      if (existing) existing.push(item);
      else {
        byArea.set(key, [item]);
        order.push(key);
      }
    }
    order.sort((a, b) => (a === NO_AREA ? 1 : b === NO_AREA ? -1 : 0));
    return order.map((key) => ({ key, items: byArea.get(key) ?? [] }));
  }, [capped]);

  const recentDevices = useMemo(() => {
    if (query.trim()) return [];
    const byId = new Map(searchable.map((item) => [item.id, item]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((item): item is SearchableDevice => !!item)
      .filter((item) => (areaFilter ? (item.areaLabel || NO_AREA) === areaFilter : true));
  }, [query, recentIds, searchable, areaFilter]);

  const handlePick = (deviceId: string) => {
    onPick(deviceId);
    pushRecentPick(RECENT_DEVICES_KEY, deviceId);
    setRecentIds(readRecentPicks(RECENT_DEVICES_KEY));
  };

  const renderRow = (item: SearchableDevice) => {
    const isSelected = selectedIds.includes(item.id);
    return (
      <CommandItem
        key={item.id}
        value={item.id}
        disabled={multiple && isSelected}
        onSelect={() => handlePick(item.id)}
        className="items-start gap-2"
      >
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-flow-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-flow-text">{item.name}</span>
          {item.manufacturerModel && (
            <span className="truncate text-flow-text-muted text-xs">{item.manufacturerModel}</span>
          )}
        </div>
        {multiple && isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-flow-accent" />}
      </CommandItem>
    );
  };

  return (
    <PickerPopoverShell
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      title={triggerTitle}
    >
      <Command shouldFilter={false} className="h-full bg-transparent text-flow-text">
        <CommandInput
          autoFocus
          placeholder="Search devices..."
          value={query}
          onValueChange={setQuery}
        />
        <div className="flex flex-wrap items-center gap-1.5 border-flow-border border-b px-3 py-1.5">
          <FilterChip
            label="Area"
            options={areaOptions}
            value={areaFilter}
            onChange={setAreaFilter}
          />
        </div>
        <CommandList className="max-h-[360px]">
          <CommandEmpty>{t('pickers.noDevices')}</CommandEmpty>
          {recentDevices.length > 0 && (
            <CommandGroup heading={t('pickers.recent')}>
              {recentDevices.map(renderRow)}
            </CommandGroup>
          )}
          {groups.map(({ key, items }) => (
            <CommandGroup
              key={key}
              heading={key}
              className="[&_[cmdk-group-heading]]:sticky [&_[cmdk-group-heading]]:top-0 [&_[cmdk-group-heading]]:z-10 [&_[cmdk-group-heading]]:bg-flow-panel"
            >
              {items.map(renderRow)}
            </CommandGroup>
          ))}
          {remaining > 0 && (
            <div className="px-3 py-2 text-center text-flow-text-muted text-xs">
              {t('pickers.moreKeepTyping', { count: remaining })}
            </div>
          )}
        </CommandList>
      </Command>
    </PickerPopoverShell>
  );
}

interface DevicePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional device list. If not provided, auto-fetches from useHass(). */
  devices?: DeviceRegistryEntry[];
  areaFilter?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Rich device picker (design doc §14): same popover pattern as EntityPicker, with
 * manufacturer/model as the muted secondary line instead of entity_id and no state column.
 * Falls back to a manual-entry text input when the registry is empty.
 */
export function DevicePicker({
  value,
  onChange,
  devices: devicesProp,
  areaFilter,
  placeholder = 'Select device...',
  className,
  disabled,
}: DevicePickerProps) {
  const { t } = useTranslation('common');
  const { devices: contextDevices, areas } = useHass();
  const allDevices = devicesProp ?? contextDevices;
  const hasDevices = allDevices.length > 0;

  const devices = useMemo(
    () => (areaFilter ? allDevices.filter((device) => device.area_id === areaFilter) : allDevices),
    [allDevices, areaFilter]
  );
  const areaById = useMemo(() => new Map(areas.map((area) => [area.area_id, area])), [areas]);

  const [open, setOpen] = useState(false);
  const selected = devices.find((device) => device.id === value);
  const isUnknown = Boolean(value) && hasDevices && !selected;

  if (!hasDevices) {
    return (
      <div className={cn('space-y-1', className)}>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || t('pickers.deviceIdPlaceholder')}
          disabled={disabled}
        />
        <p className="text-flow-text-muted text-xs">{t('pickers.deviceIdManualHint')}</p>
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <DevicePopover
        devices={devices}
        areaById={areaById}
        selectedIds={value ? [value] : []}
        multiple={false}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
        open={open}
        onOpenChange={setOpen}
        triggerTitle="Select device"
        trigger={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex w-full items-center gap-2 rounded-flow-control border border-flow-border bg-flow-elevated px-3 py-2 text-left text-sm transition-colors duration-flow-fast hover:border-flow-accent disabled:cursor-not-allowed disabled:opacity-50',
              !selected && 'text-flow-text-muted'
            )}
          >
            {selected ? (
              <>
                <Cpu className="h-3.5 w-3.5 shrink-0 text-flow-text-muted" />
                <span className="min-w-0 flex-1 truncate text-flow-text">
                  {getDeviceName(selected)}
                </span>
                <span className="shrink-0 truncate text-flow-text-muted text-xs">
                  {[
                    selected.area_id ? areaById.get(selected.area_id)?.name : undefined,
                    [selected.manufacturer, selected.model].filter(Boolean).join(' '),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            ) : (
              <span className="flex-1 truncate">{placeholder}</span>
            )}
          </button>
        }
      />
      {isUnknown && <div className="mt-1 truncate font-mono text-flow-danger">{value}</div>}
    </div>
  );
}

interface MultiDevicePickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  devices?: DeviceRegistryEntry[];
  areaFilter?: string;
  placeholder?: string;
  className?: string;
}

/** Chips of selected devices plus a compact "+ Add" trigger opening the same rich popover in multi mode. */
export function MultiDevicePicker({
  value,
  onChange,
  devices: devicesProp,
  areaFilter,
  placeholder = 'Select devices...',
  className,
}: MultiDevicePickerProps) {
  const { devices: contextDevices, areas } = useHass();
  const allDevices = devicesProp ?? contextDevices;
  const devices = useMemo(
    () => (areaFilter ? allDevices.filter((device) => device.area_id === areaFilter) : allDevices),
    [allDevices, areaFilter]
  );
  const areaById = useMemo(() => new Map(areas.map((area) => [area.area_id, area])), [areas]);
  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device])),
    [devices]
  );

  const [open, setOpen] = useState(false);
  const handleRemove = (id: string) => onChange(value.filter((existing) => existing !== id));

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {value.map((id) => {
        const device = deviceById.get(id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 rounded-flow-control border border-flow-border bg-flow-elevated py-0.5 pr-1 pl-2 text-flow-text-secondary text-xs"
          >
            <Cpu className="h-3 w-3 shrink-0 text-flow-text-muted" />
            <span className="max-w-[10rem] truncate">{device ? getDeviceName(device) : id}</span>
            <button
              type="button"
              onClick={() => handleRemove(id)}
              aria-label={`Remove ${id}`}
              className="shrink-0 rounded-full p-0.5 text-flow-text-muted hover:bg-flow-panel hover:text-flow-danger"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <DevicePopover
        devices={devices}
        areaById={areaById}
        selectedIds={value}
        multiple
        onPick={(id) => {
          if (!value.includes(id)) onChange([...value, id]);
        }}
        open={open}
        onOpenChange={setOpen}
        triggerTitle="Add device"
        trigger={
          <button
            type="button"
            disabled={devices.length === 0}
            className="inline-flex items-center gap-1 rounded-flow-control border border-flow-border border-dashed px-2 py-1 text-flow-text-muted text-xs hover:border-flow-accent hover:text-flow-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {placeholder}
          </button>
        }
      />
    </div>
  );
}
