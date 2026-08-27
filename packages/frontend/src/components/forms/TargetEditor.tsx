import { Activity, Cpu, MapPinned, Tag, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useHass } from '@/contexts/HassContext';
import { cn } from '@/lib/utils';
import { AreaPicker } from './AreaPicker';
import { DevicePicker } from './DevicePicker';
import { EntityPicker } from './EntityPicker';
import { LabelPicker } from './LabelPicker';

type TargetIds = {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
  label_id?: string | string[];
};

function normalizeToArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function TargetPill({ label, count, onRemove }: { label: string; count?: number; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-flow-control border border-flow-border bg-flow-elevated py-0.5 pr-1 pl-2 text-flow-text-secondary text-xs">
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 rounded-full bg-flow-accent-subtle px-1.5 font-mono text-[10px] text-flow-accent">
          {count}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="shrink-0 rounded-full p-0.5 text-flow-text-muted hover:bg-flow-panel hover:text-flow-danger"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function TargetRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-flow-text-muted text-xs">
        <Icon className="h-3.5 w-3.5" />
        <span className="font-medium">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

interface TargetEditorProps {
  target: TargetIds | undefined;
  onChange: (target: Record<string, unknown> | undefined) => void;
  className?: string;
}

/**
 * Entities / Devices / Areas / Labels target rows: pills with resolved-entity-count badges,
 * each row ending in a compact picker used as an "add" trigger. Mirrors the omit-if-empty
 * target-building pattern used elsewhere for HA service call targets.
 */
export function TargetEditor({ target, onChange, className }: TargetEditorProps) {
  const { entities, devices, areas, labels, entityRegistryEntries } = useHass();

  const entityIds = normalizeToArray(target?.entity_id);
  const deviceIds = normalizeToArray(target?.device_id);
  const areaIds = normalizeToArray(target?.area_id);
  const labelIds = normalizeToArray(target?.label_id);

  const entityById = useMemo(() => new Map(entities.map((entity) => [entity.entity_id, entity])), [entities]);
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const areaById = useMemo(() => new Map(areas.map((area) => [area.area_id, area])), [areas]);
  const labelById = useMemo(() => new Map(labels.map((label) => [label.label_id, label])), [labels]);

  const updateRow = (key: keyof TargetIds, values: string[]) => {
    const rows: Record<keyof TargetIds, string[]> = {
      entity_id: key === 'entity_id' ? values : entityIds,
      device_id: key === 'device_id' ? values : deviceIds,
      area_id: key === 'area_id' ? values : areaIds,
      label_id: key === 'label_id' ? values : labelIds,
    };
    const next: Record<string, unknown> = {};
    for (const [field, ids] of Object.entries(rows)) {
      if (ids.length > 0) next[field] = ids;
    }
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <TargetRow icon={Activity} label="Entities">
        {entityIds.map((id) => {
          const entity = entityById.get(id);
          const label = entity ? (entity.attributes.friendly_name as string) || id : id;
          return (
            <TargetPill
              key={id}
              label={label}
              onRemove={() => updateRow('entity_id', entityIds.filter((x) => x !== id))}
            />
          );
        })}
        <EntityPicker
          value=""
          onChange={(id) => {
            if (id && !entityIds.includes(id)) updateRow('entity_id', [...entityIds, id]);
          }}
          placeholder="+ Entity"
          className="w-36"
        />
      </TargetRow>

      <TargetRow icon={Cpu} label="Devices">
        {deviceIds.map((id) => {
          const device = deviceById.get(id);
          const label = device ? device.name_by_user || device.name || id : id;
          const count = entityRegistryEntries.filter((entry) => entry.device_id === id).length;
          return (
            <TargetPill
              key={id}
              label={label}
              count={count}
              onRemove={() => updateRow('device_id', deviceIds.filter((x) => x !== id))}
            />
          );
        })}
        <DevicePicker
          value=""
          onChange={(id) => {
            if (id && !deviceIds.includes(id)) updateRow('device_id', [...deviceIds, id]);
          }}
          placeholder="+ Device"
          className="w-36"
        />
      </TargetRow>

      <TargetRow icon={MapPinned} label="Areas">
        {areaIds.map((id) => {
          const area = areaById.get(id);
          const count = entityRegistryEntries.filter((entry) => {
            const effectiveArea =
              entry.area_id ?? (entry.device_id ? deviceById.get(entry.device_id)?.area_id : undefined);
            return effectiveArea === id;
          }).length;
          return (
            <TargetPill
              key={id}
              label={area ? area.name : id}
              count={count}
              onRemove={() => updateRow('area_id', areaIds.filter((x) => x !== id))}
            />
          );
        })}
        <AreaPicker
          value=""
          onChange={(id) => {
            if (id && !areaIds.includes(id)) updateRow('area_id', [...areaIds, id]);
          }}
          placeholder="+ Area"
          className="w-36"
        />
      </TargetRow>

      <TargetRow icon={Tag} label="Labels">
        {labelIds.map((id) => {
          const label = labelById.get(id);
          const entityCount = entityRegistryEntries.filter((entry) => entry.labels?.includes(id)).length;
          const deviceCount = devices.filter((device) => device.labels?.includes(id)).length;
          return (
            <TargetPill
              key={id}
              label={label ? label.name : id}
              count={entityCount + deviceCount}
              onRemove={() => updateRow('label_id', labelIds.filter((x) => x !== id))}
            />
          );
        })}
        <LabelPicker
          value=""
          onChange={(id) => {
            if (id && !labelIds.includes(id)) updateRow('label_id', [...labelIds, id]);
          }}
          placeholder="+ Label"
          className="w-36"
        />
      </TargetRow>
    </div>
  );
}
