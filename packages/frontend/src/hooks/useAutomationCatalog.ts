import { useEffect, useMemo, useState } from 'react';
import type {
  AreaRegistryEntry,
  AutomationCatalogItem,
  EntityRegistryEntry,
  HomeAssistantAPI,
} from '@/lib/ha-api';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import type { HassEntity, HomeAssistant } from '@/types/hass';

export type AutomationFilterChip = 'all' | 'enabled' | 'disabled' | 'recent';

/** Design doc §4: "Recent" filter chip window. */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UseAutomationCatalogOptions {
  hass: HomeAssistant | undefined;
  hassConfig?: { url?: string; token?: string };
  entities: HassEntity[];
}

export function normalizeAutomationTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === 'string');
  }
  if (typeof tags === 'string' && tags.trim()) {
    return [tags];
  }
  return [];
}

export function mapAutomationEntityToCatalogItem(
  entity: HassEntity,
  areaId?: string
): AutomationCatalogItem | null {
  if (!entity.entity_id.startsWith('automation.')) {
    return null;
  }

  const friendlyName =
    typeof entity.attributes.friendly_name === 'string'
      ? entity.attributes.friendly_name
      : entity.entity_id;
  const automationId =
    typeof entity.attributes.id === 'string' || typeof entity.attributes.id === 'number'
      ? String(entity.attributes.id)
      : entity.entity_id.replace('automation.', '');

  return {
    entity_id: entity.entity_id,
    automation_id: automationId,
    friendly_name: friendlyName,
    enabled: entity.state === 'on',
    last_triggered:
      typeof entity.attributes.last_triggered === 'string'
        ? entity.attributes.last_triggered
        : undefined,
    description:
      typeof entity.attributes.description === 'string' ? entity.attributes.description : '',
    mode: typeof entity.attributes.mode === 'string' ? entity.attributes.mode : undefined,
    area_id: areaId,
    tags: normalizeAutomationTags(entity.attributes.tags),
  };
}

export function buildAutomationSearchText(item: AutomationCatalogItem): string {
  return [
    item.entity_id,
    item.friendly_name,
    item.description,
    item.mode || '',
    item.tags.join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Applies one of the Automations tab's filter chips (design doc §4). "Recent" both filters to
 * automations triggered within the last 24h *and* sorts most-recent-first, since that ordering
 * is the entire point of the chip; the other chips sort alphabetically for a stable list.
 */
export function filterAutomationCatalogItemsByChip(
  items: AutomationCatalogItem[],
  chip: AutomationFilterChip,
  now: number = Date.now()
): AutomationCatalogItem[] {
  switch (chip) {
    case 'enabled':
      return items
        .filter((item) => item.enabled)
        .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
    case 'disabled':
      return items
        .filter((item) => !item.enabled)
        .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
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
      return [...items].sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
  }
}

/**
 * Calls the same `automation.turn_on`/`turn_off` service the row's Switch represents. Takes
 * the API as a narrow, injectable dependency so it's testable without mocking the ha-api module.
 */
export async function setAutomationEnabled(
  api: Pick<HomeAssistantAPI, 'setAutomationState'>,
  item: Pick<AutomationCatalogItem, 'entity_id'>,
  enabled: boolean
): Promise<void> {
  await api.setAutomationState(item.entity_id, enabled);
}

export type AutomationOpenPlan =
  | { action: 'open'; automationId: string }
  | { action: 'confirm'; automationId: string };

/**
 * Design doc §0/§4: switching the open automation while the canvas has unsaved changes must
 * be confirmed first. Pure so the branch is directly testable; `AutomationsTab` wires the
 * 'confirm' outcome to `useDirtyGuard`.
 */
export function planAutomationOpen(automationId: string, isDirty: boolean): AutomationOpenPlan {
  return { action: isDirty ? 'confirm' : 'open', automationId };
}

/**
 * Data layer for the Automations tab (design doc §4, the new primary workflow). Fetches the
 * area/entity registries once and maps the *live* `entities` array (already pushed reactively
 * by HassContext -- panel mode re-renders with a fresh `hass` on every state change, remote
 * mode via `subscribeEntities`) into the catalog shape, so enabled state and last_triggered
 * stay current without any polling in here.
 */
export function useAutomationCatalog({ hass, hassConfig, entities }: UseAutomationCatalogOptions) {
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

  const entityIdToAreaId = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const entry of entityRegistry) {
      if (entry.entity_id && entry.area_id) {
        map[entry.entity_id] = entry.area_id;
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
    return entities
      .map((entity) => mapAutomationEntityToCatalogItem(entity, entityIdToAreaId[entity.entity_id]))
      .filter((item): item is AutomationCatalogItem => item !== null);
  }, [entities, entityIdToAreaId]);

  return {
    areaIdToName,
    catalogItems,
    isLoading: !!hass && !registriesLoaded,
  };
}
