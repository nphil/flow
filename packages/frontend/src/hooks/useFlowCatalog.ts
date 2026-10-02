import type { FlowKind } from '@flow/shared';
import { useEffect, useMemo, useState } from 'react';
import type { FlowCatalogItem } from '@/lib/flow-catalog';
import { mapEntityToCatalogItem } from '@/lib/flow-catalog';
import type { AreaRegistryEntry, EntityRegistryEntry, HomeAssistantAPI } from '@/lib/ha-api';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import type { HassEntity, HomeAssistant } from '@/types/hass';

export type FlowFilterChip = 'all' | 'enabled' | 'disabled' | 'running' | 'recent';

/** The filter chips each list offers, in order. A script is never enabled or disabled. */
export const FLOW_CHIPS: Record<FlowKind, FlowFilterChip[]> = {
  automation: ['all', 'enabled', 'disabled', 'recent'],
  script: ['all', 'running', 'recent'],
};

/** Design doc §4: "Recent" filter chip window. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UseFlowCatalogOptions {
  kind: FlowKind;
  hass: HomeAssistant | undefined;
  hassConfig?: { url?: string; token?: string };
  entities: HassEntity[];
}

const byName = (a: FlowCatalogItem, b: FlowCatalogItem) =>
  a.friendly_name.localeCompare(b.friendly_name);

/**
 * Applies one of the list's filter chips (design doc §4). "Recent" both filters to items run
 * within the last 24h *and* sorts most-recent-first, since that ordering is the entire point of
 * the chip; the other chips sort alphabetically for a stable list. "Enabled" and "Running" are the
 * same test (the entity is on), named for what it means for an automation or a script.
 */
export function filterFlowCatalogItemsByChip(
  items: FlowCatalogItem[],
  chip: FlowFilterChip,
  now: number = Date.now()
): FlowCatalogItem[] {
  switch (chip) {
    case 'enabled':
    case 'running':
      return items.filter((item) => item.is_on).sort(byName);
    case 'disabled':
      return items.filter((item) => !item.is_on).sort(byName);
    case 'recent':
      return items
        .filter(
          (item) =>
            !!item.last_triggered &&
            now - new Date(item.last_triggered).getTime() <= RECENT_WINDOW_MS
        )
        .sort(
          (a, b) =>
            new Date(b.last_triggered as string).getTime() -
            new Date(a.last_triggered as string).getTime()
        );
    default:
      return [...items].sort(byName);
  }
}

/**
 * Calls the same `automation.turn_on`/`turn_off` service the row's Switch represents. Takes
 * the API as a narrow, injectable dependency so it's testable without mocking the ha-api module.
 */
export async function setAutomationEnabled(
  api: Pick<HomeAssistantAPI, 'setAutomationState'>,
  item: Pick<FlowCatalogItem, 'entity_id'>,
  enabled: boolean
): Promise<void> {
  await api.setAutomationState(item.entity_id, enabled);
}

export type FlowOpenPlan = {
  action: 'open' | 'confirm';
  kind: FlowKind;
  flowId: string;
};

/**
 * Design doc §0/§4: switching the open automation or script while the canvas has unsaved changes
 * must be confirmed first. Pure so the branch is directly testable; `FlowListTab` wires the
 * 'confirm' outcome to `useDirtyGuard`.
 */
export function planFlowOpen(kind: FlowKind, flowId: string, isDirty: boolean): FlowOpenPlan {
  return { action: isDirty ? 'confirm' : 'open', kind, flowId };
}

/**
 * Data layer for the automation and script lists (design doc §4, the primary workflow). Fetches
 * the area/entity registries once and maps the *live* `entities` array (already pushed reactively
 * by HassContext -- panel mode re-renders with a fresh `hass` on every state change, remote
 * mode via `subscribeEntities`) into the catalog shape, so on/off state and last_triggered
 * stay current without any polling in here. The entity registry also gives a script its key.
 */
export function useFlowCatalog({ kind, hass, hassConfig, entities }: UseFlowCatalogOptions) {
  const [areas, setAreas] = useState<AreaRegistryEntry[]>([]);
  const [entityRegistry, setEntityRegistry] = useState<EntityRegistryEntry[]>([]);
  const [registriesLoaded, setRegistriesLoaded] = useState(false);

  useEffect(() => {
    if (!hass) return;

    const api = getHomeAssistantAPI(hass, hassConfig);
    let cancelled = false;

    (async () => {
      try {
        const [areasResult, entitiesResult] = await Promise.all([
          api.getAreas(),
          api.getEntities(),
        ]);
        if (!cancelled) {
          setAreas(Array.isArray(areasResult) ? (areasResult as AreaRegistryEntry[]) : []);
          setEntityRegistry(
            Array.isArray(entitiesResult) ? (entitiesResult as EntityRegistryEntry[]) : []
          );
        }
      } catch {
        if (!cancelled) {
          setAreas([]);
          setEntityRegistry([]);
        }
      } finally {
        if (!cancelled) setRegistriesLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hass, hassConfig]);

  const registryByEntityId = useMemo(() => {
    const map: Record<string, EntityRegistryEntry | undefined> = {};
    for (const entry of entityRegistry) {
      if (entry.entity_id) {
        map[entry.entity_id] = entry;
      }
    }
    return map;
  }, [entityRegistry]);

  const areaIdToName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const area of areas) {
      if (area.area_id && area.name) {
        map[area.area_id] = area.name;
      }
    }
    return map;
  }, [areas]);

  const catalogItems = useMemo(() => {
    return entities.flatMap((entity) => {
      const entry = registryByEntityId[entity.entity_id];
      const item = mapEntityToCatalogItem(kind, entity, {
        areaId: entry?.area_id ?? undefined,
        uniqueId: entry?.unique_id,
      });
      return item ? [item] : [];
    });
  }, [kind, entities, registryByEntityId]);

  return {
    areaIdToName,
    catalogItems,
    isLoading: !!hass && !registriesLoaded,
  };
}
