import type { HassEntity } from '@/types/hass';

/** The slice of the Home Assistant frontend `hass` object (2026.4+) that composes entity names. */
type EntityNameFormatter = {
  formatEntityName?: (
    stateObj: HassEntity,
    type: { type: 'entity' | 'device' | 'area' | 'floor' }[],
    options?: { separator?: string }
  ) => string;
};

/**
 * The name to show for an entity. Home Assistant 2026.11 composes names from the device and the
 * entity and plans to deprecate the `friendly_name` attribute, so ask Home Assistant's own
 * `hass.formatEntityName` first, the same helper its tile card uses, and fall back to
 * `friendly_name` (older Home Assistant, or the standalone mode that has no such helper), and
 * finally to the entity id.
 */
export function entityDisplayName(hass: object | null | undefined, entity: HassEntity): string {
  const formatEntityName = (hass as EntityNameFormatter | null | undefined)?.formatEntityName;
  if (typeof formatEntityName === 'function') {
    try {
      const name = formatEntityName.call(hass, entity, [{ type: 'device' }, { type: 'entity' }], {
        separator: ' ',
      });
      if (typeof name === 'string' && name.trim()) return name;
    } catch {
      // fall through to the attribute
    }
  }
  const friendly = entity.attributes?.friendly_name;
  return typeof friendly === 'string' && friendly ? friendly : entity.entity_id;
}
