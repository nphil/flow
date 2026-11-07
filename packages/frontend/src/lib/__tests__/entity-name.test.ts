import { describe, expect, it, vi } from 'vitest';
import type { HassEntity } from '@/types/hass';
import { entityDisplayName } from '../entity-name';

const entity = (attributes: Record<string, unknown> = {}): HassEntity =>
  ({
    entity_id: 'sensor.kitchen_temperature',
    state: '21',
    attributes,
    last_changed: '',
    last_updated: '',
    context: { id: '', user_id: null, parent_id: null },
  }) as HassEntity;

describe('entityDisplayName', () => {
  it('uses hass.formatEntityName (device then entity) when Home Assistant provides it', () => {
    const formatEntityName = vi.fn(() => 'Kitchen Temperature');
    const name = entityDisplayName({ formatEntityName }, entity({ friendly_name: 'old' }));
    expect(name).toBe('Kitchen Temperature');
    expect(formatEntityName).toHaveBeenCalledWith(
      expect.anything(),
      [{ type: 'device' }, { type: 'entity' }],
      { separator: ' ' }
    );
  });

  it('falls back to the friendly_name attribute when there is no helper', () => {
    expect(entityDisplayName({}, entity({ friendly_name: 'Kitchen temp' }))).toBe('Kitchen temp');
    expect(entityDisplayName(undefined, entity({ friendly_name: 'Kitchen temp' }))).toBe(
      'Kitchen temp'
    );
  });

  it('falls back to the attribute when the helper throws or returns nothing', () => {
    const throws = () => {
      throw new Error('boom');
    };
    expect(entityDisplayName({ formatEntityName: throws }, entity({ friendly_name: 'A' }))).toBe(
      'A'
    );
    expect(entityDisplayName({ formatEntityName: () => ' ' }, entity({ friendly_name: 'B' }))).toBe(
      'B'
    );
  });

  it('falls back to the entity id last', () => {
    expect(entityDisplayName(null, entity())).toBe('sensor.kitchen_temperature');
  });
});
