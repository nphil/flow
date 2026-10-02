import type { FlowKind } from '@flow/shared';
import type { HassEntity } from '@/types/hass';

/**
 * One automation or script as the lists and the API see it. Built from the live entity plus the
 * two things the entity does not carry: its area and, for a script, the key it is stored under.
 */
export interface FlowCatalogItem {
  entity_id: string;
  /**
   * The id Home Assistant stores the item under. Automation: the `id` attribute. Script: the
   * `unique_id` of its entity registry entry. Both fall back to the entity id without its domain.
   */
  flow_id: string;
  friendly_name: string;
  /** The entity is `on`: an automation that is enabled, a script that is running right now. */
  is_on: boolean;
  /** Last time it ran (an automation's last trigger, a script's last start). */
  last_triggered?: string;
  description: string;
  mode?: string;
  /** The item's own `mdi:` icon, when it has one. */
  icon?: string;
  area_id?: string;
  tags: string[];
}

/** The part of an entity registry entry the catalog needs. */
export interface FlowRegistryEntry {
  entity_id: string;
  unique_id?: string | null;
}

export function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === 'string');
  }
  if (typeof tags === 'string' && tags.trim()) {
    return [tags];
  }
  return [];
}

function stringAttribute(entity: HassEntity, name: string): string | undefined {
  const value = entity.attributes[name];
  return typeof value === 'string' ? value : undefined;
}

/** The id an item is stored under, see {@link FlowCatalogItem.flow_id}. */
function resolveFlowId(kind: FlowKind, entity: HassEntity, uniqueId?: string | null): string {
  if (kind === 'script') {
    return uniqueId || entity.entity_id.replace('script.', '');
  }
  const id = entity.attributes.id;
  return typeof id === 'string' || typeof id === 'number'
    ? String(id)
    : entity.entity_id.replace('automation.', '');
}

export function mapEntityToCatalogItem(
  kind: FlowKind,
  entity: HassEntity,
  extra: { areaId?: string; uniqueId?: string | null } = {}
): FlowCatalogItem | null {
  if (!entity.entity_id.startsWith(`${kind}.`)) {
    return null;
  }

  return {
    entity_id: entity.entity_id,
    flow_id: resolveFlowId(kind, entity, extra.uniqueId),
    friendly_name: stringAttribute(entity, 'friendly_name') ?? entity.entity_id,
    is_on: entity.state === 'on',
    last_triggered: stringAttribute(entity, 'last_triggered'),
    description: stringAttribute(entity, 'description') ?? '',
    mode: stringAttribute(entity, 'mode'),
    icon: stringAttribute(entity, 'icon'),
    area_id: extra.areaId,
    tags: normalizeTags(entity.attributes.tags),
  };
}

/**
 * Finds the live entity behind the item that is open on the canvas. A script's key is the
 * `unique_id` of its registry entry, which differs from the entity id once the entity was renamed.
 */
export function findFlowEntity(
  kind: FlowKind,
  flowId: string | null,
  entities: readonly HassEntity[],
  registry: readonly FlowRegistryEntry[]
): HassEntity | undefined {
  if (!flowId) return undefined;
  const ofKind = entities.filter((entity) => entity.entity_id.startsWith(`${kind}.`));
  if (kind === 'script') {
    const registered = registry.find(
      (entry) => entry.unique_id === flowId && entry.entity_id.startsWith('script.')
    );
    const entityId = registered?.entity_id ?? `script.${flowId}`;
    return ofKind.find((entity) => entity.entity_id === entityId);
  }
  return ofKind.find(
    (entity) =>
      String(entity.attributes.id ?? '') === flowId || entity.entity_id === `automation.${flowId}`
  );
}

/**
 * The key a new script is stored under: its name as a slug (`[a-z0-9_]+`, what Home Assistant
 * requires), with `_2`, `_3`... appended when a script already uses it. Home Assistant's own
 * editor does the same, and a POST to an existing key would overwrite that script.
 */
export function uniqueScriptKey(alias: string, existingKeys: Iterable<string>): string {
  const taken = new Set(existingKeys);
  const base =
    alias
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'script';
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    key = `${base}_${n}`;
  }
  return key;
}
