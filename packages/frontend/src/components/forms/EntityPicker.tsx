import {
  Activity,
  AlarmClock,
  Blinds,
  Bot,
  CalendarClock,
  Camera,
  Check,
  CircleDot,
  Clapperboard,
  CloudSun,
  Droplets,
  Fan,
  FileCode,
  Flame,
  Hash,
  HelpCircle,
  Lightbulb,
  ListChecks,
  ListFilter,
  Lock,
  type LucideIcon,
  MapPin,
  MapPinned,
  Plus,
  RefreshCw,
  Rss,
  ShieldAlert,
  SlidersHorizontal,
  SquareDot,
  Sun,
  TextCursorInput,
  Thermometer,
  ToggleLeft,
  ToggleRight,
  Tv,
  Type,
  User,
  X,
} from 'lucide-react';
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
import { useHass } from '@/contexts/HassContext';
import { useFuzzySearch } from '@/hooks/useFuzzySearch';
import { cn } from '@/lib/utils';
import type { HassEntity } from '@/types/hass';
import {
  FilterChip,
  MAX_RESULTS,
  PickerPopoverShell,
  pushRecentPick,
  readRecentPicks,
} from './pickerPopover';

/** Domain -> icon for the entity picker. Mirrors HA's own domain iconography at a glance. */
const DOMAIN_ICON: Record<string, LucideIcon> = {
  light: Lightbulb,
  switch: ToggleLeft,
  sensor: Activity,
  binary_sensor: CircleDot,
  climate: Thermometer,
  cover: Blinds,
  fan: Fan,
  media_player: Tv,
  automation: AlarmClock,
  script: FileCode,
  scene: Clapperboard,
  input_boolean: ToggleRight,
  input_number: Hash,
  input_select: ListFilter,
  input_text: TextCursorInput,
  input_datetime: CalendarClock,
  person: User,
  device_tracker: MapPin,
  zone: MapPinned,
  sun: Sun,
  weather: CloudSun,
  camera: Camera,
  remote: Rss,
  vacuum: Bot,
  lock: Lock,
  alarm_control_panel: ShieldAlert,
  water_heater: Flame,
  humidifier: Droplets,
  button: SquareDot,
  number: SlidersHorizontal,
  select: ListChecks,
  text: Type,
  update: RefreshCw,
};

function DomainIcon({ entityId, className }: { entityId: string; className?: string }) {
  const Icon = DOMAIN_ICON[entityId.split('.')[0]] ?? HelpCircle;
  return <Icon className={className} />;
}

function getEntityName(entity: HassEntity): string {
  return (entity.attributes.friendly_name as string) || entity.entity_id;
}

const RECENT_ENTITIES_KEY = 'flow.recent-entities';
const NO_AREA = 'No area';

type SearchableEntity = {
  entity: HassEntity;
  entity_id: string;
  friendlyName: string;
  areaLabel: string;
  domain: string;
};

function applyDomainFilter(
  entities: HassEntity[],
  domainFilter: string | string[] | undefined
): HassEntity[] {
  if (!domainFilter) return entities;
  const filters = Array.isArray(domainFilter) ? domainFilter : [domainFilter];
  return entities.filter((entity) => filters.includes(entity.entity_id.split('.')[0]));
}

interface EntityPopoverProps {
  entities: HassEntity[];
  selectedIds: string[];
  multiple: boolean;
  onPick: (entityId: string) => void;
  preferredDomains?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  triggerTitle: string;
}

/** The design doc §14 popover content, shared by the single-select trigger and the multi "add" trigger. */
function EntityPopover({
  entities,
  selectedIds,
  multiple,
  onPick,
  preferredDomains,
  open,
  onOpenChange,
  trigger,
  triggerTitle,
}: EntityPopoverProps) {
  const { getAreaNameForEntity } = useHass();
  const { t } = useTranslation('common');
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string | null>(preferredDomains?.[0] ?? null);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  const searchable: SearchableEntity[] = useMemo(
    () =>
      entities.map((entity) => ({
        entity,
        entity_id: entity.entity_id,
        friendlyName: getEntityName(entity),
        areaLabel: getAreaNameForEntity(entity.entity_id) ?? '',
        domain: entity.entity_id.split('.')[0],
      })),
    [entities, getAreaNameForEntity]
  );

  const { query, setQuery, filteredItems } = useFuzzySearch<SearchableEntity>(searchable, {
    keys: ['friendlyName', 'entity_id', 'areaLabel'],
    threshold: 0.35,
    minMatchCharLength: 1,
  });

  // Fresh state each time the popover opens: clear any leftover search text and re-sync recents
  // (another picker instance may have written to the same localStorage key since last open).
  useEffect(() => {
    if (open) {
      setQuery('');
      setRecentIds(readRecentPicks(RECENT_ENTITIES_KEY));
    }
  }, [open, setQuery]);

  const byQueryAndDomain = useMemo(
    () =>
      domainFilter ? filteredItems.filter((item) => item.domain === domainFilter) : filteredItems,
    [filteredItems, domainFilter]
  );
  const byQueryAndArea = useMemo(
    () =>
      areaFilter
        ? filteredItems.filter((item) => (item.areaLabel || NO_AREA) === areaFilter)
        : filteredItems,
    [filteredItems, areaFilter]
  );

  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of byQueryAndDomain) {
      const key = item.areaLabel || NO_AREA;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({ value, label: value, count })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [byQueryAndDomain]);

  const domainOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of byQueryAndArea) {
      counts.set(item.domain, (counts.get(item.domain) ?? 0) + 1);
    }
    return Array.from(counts, ([value, count]) => ({ value, label: value, count })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [byQueryAndArea]);

  const matches = useMemo(() => {
    let result = filteredItems;
    if (domainFilter) result = result.filter((item) => item.domain === domainFilter);
    if (areaFilter) result = result.filter((item) => (item.areaLabel || NO_AREA) === areaFilter);
    return result;
  }, [filteredItems, domainFilter, areaFilter]);

  const capped = matches.slice(0, MAX_RESULTS);
  const remaining = matches.length - capped.length;

  const groups = useMemo(() => {
    const order: string[] = [];
    const byArea = new Map<string, SearchableEntity[]>();
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

  const recentEntities = useMemo(() => {
    if (query.trim()) return [];
    const byId = new Map(searchable.map((item) => [item.entity_id, item]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((item): item is SearchableEntity => !!item)
      .filter((item) => (domainFilter ? item.domain === domainFilter : true))
      .filter((item) => (areaFilter ? (item.areaLabel || NO_AREA) === areaFilter : true));
  }, [query, recentIds, searchable, domainFilter, areaFilter]);

  const handlePick = (entityId: string) => {
    onPick(entityId);
    pushRecentPick(RECENT_ENTITIES_KEY, entityId);
    setRecentIds(readRecentPicks(RECENT_ENTITIES_KEY));
  };

  const renderRow = (item: SearchableEntity) => {
    const isSelected = selectedIds.includes(item.entity_id);
    return (
      <CommandItem
        key={item.entity_id}
        value={item.entity_id}
        disabled={multiple && isSelected}
        onSelect={() => handlePick(item.entity_id)}
        className="items-start gap-2"
      >
        <DomainIcon
          entityId={item.entity_id}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-flow-text-muted"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-flow-text">{item.friendlyName}</span>
          <span className="truncate font-mono text-flow-text-muted text-xs">{item.entity_id}</span>
        </div>
        {multiple && isSelected ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-flow-accent" />
        ) : (
          query.trim() !== '' && (
            <span className="shrink-0 text-flow-text-muted text-xs">{item.entity.state}</span>
          )
        )}
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
          placeholder="Search entities..."
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
          <FilterChip
            label="Domain"
            options={domainOptions}
            value={domainFilter}
            onChange={setDomainFilter}
          />
        </div>
        <CommandList className="max-h-[360px]">
          <CommandEmpty>{t('pickers.noEntities')}</CommandEmpty>
          {recentEntities.length > 0 && (
            <CommandGroup heading={t('pickers.recent')}>
              {recentEntities.map(renderRow)}
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

interface EntityPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Optional entities list. If not provided, auto-fetches from useHass(). */
  entities?: HassEntity[];
  domainFilter?: string | string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Pre-selects the Domain filter chip's initial value (softer hint than domainFilter); user-clearable. */
  preferredDomains?: string[];
}

/**
 * Rich entity picker (design doc §14): trigger is a chip (domain icon + friendly name +
 * muted entity_id/area); click opens a searchable, area-grouped, area/domain-filterable
 * popover (bottom sheet on mobile) with a Recent section and a 60-row scale cap.
 */
export function EntityPicker({
  value,
  onChange,
  entities: entitiesProp,
  domainFilter,
  placeholder = 'Select entity...',
  className,
  disabled,
  preferredDomains,
}: EntityPickerProps) {
  const { entities: contextEntities, getAreaNameForEntity } = useHass();
  const allEntities = entitiesProp ?? contextEntities;
  const entities = useMemo(
    () => applyDomainFilter(allEntities, domainFilter),
    [allEntities, domainFilter]
  );

  const [open, setOpen] = useState(false);
  const selected = entities.find((entity) => entity.entity_id === value);
  const isUnknown = Boolean(value) && !selected;

  return (
    <div className={cn('relative min-w-0', className)}>
      <EntityPopover
        entities={entities}
        selectedIds={value ? [value] : []}
        multiple={false}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
        preferredDomains={preferredDomains}
        open={open}
        onOpenChange={setOpen}
        triggerTitle="Select entity"
        trigger={
          <button
            type="button"
            disabled={disabled || entities.length === 0}
            className={cn(
              'flex w-full min-w-0 items-center gap-2 rounded-flow-control border border-flow-border bg-flow-elevated px-3 py-2 text-left text-sm transition-colors duration-flow-fast hover:border-flow-accent disabled:cursor-not-allowed disabled:opacity-50',
              !selected && 'text-flow-text-muted'
            )}
          >
            {selected ? (
              <>
                <DomainIcon
                  entityId={selected.entity_id}
                  className="h-3.5 w-3.5 shrink-0 text-flow-text-muted"
                />
                <span className="min-w-0 flex-1 truncate text-flow-text">
                  {getEntityName(selected)}
                </span>
                <span className="min-w-0 shrink truncate text-flow-text-muted text-xs">
                  {[selected.entity_id, getAreaNameForEntity(selected.entity_id)]
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

interface MultiEntityPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Optional entities list. If not provided, EntityPicker auto-fetches from useHass() */
  entities?: HassEntity[];
  domainFilter?: string | string[];
  placeholder?: string;
  className?: string;
}

/** Chips of selected entities plus a compact "+ Add" trigger opening the same rich popover in multi mode. */
export function MultiEntityPicker({
  value,
  onChange,
  entities: entitiesProp,
  domainFilter,
  placeholder = 'Select entities...',
  className,
}: MultiEntityPickerProps) {
  const { entities: contextEntities } = useHass();
  const allEntities = entitiesProp ?? contextEntities;
  const entities = useMemo(
    () => applyDomainFilter(allEntities, domainFilter),
    [allEntities, domainFilter]
  );
  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.entity_id, entity])),
    [entities]
  );

  const [open, setOpen] = useState(false);
  const handleRemove = (id: string) => onChange(value.filter((existing) => existing !== id));

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {value.map((id) => {
        const entity = entityById.get(id);
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1.5 rounded-flow-control border border-flow-border bg-flow-elevated py-0.5 pr-1 pl-2 text-flow-text-secondary text-xs"
          >
            {entity && (
              <DomainIcon entityId={id} className="h-3 w-3 shrink-0 text-flow-text-muted" />
            )}
            <span className="max-w-[10rem] truncate">{entity ? getEntityName(entity) : id}</span>
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
      <EntityPopover
        entities={entities}
        selectedIds={value}
        multiple
        onPick={(id) => {
          if (!value.includes(id)) onChange([...value, id]);
        }}
        open={open}
        onOpenChange={setOpen}
        triggerTitle="Add entity"
        trigger={
          <button
            type="button"
            disabled={entities.length === 0}
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
