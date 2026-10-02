import { describe, expect, it, vi } from 'vitest';
import {
  type FlowCatalogItem,
  findFlowEntity,
  mapEntityToCatalogItem,
  uniqueScriptKey,
} from '@/lib/flow-catalog';
import type { HassEntity } from '@/types/hass';
import {
  FLOW_CHIPS,
  filterFlowCatalogItemsByChip,
  planFlowOpen,
  setAutomationEnabled,
} from '../useFlowCatalog';

function createEntity(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>
): HassEntity {
  return {
    entity_id: entityId,
    state,
    attributes,
    last_changed: '2026-02-22T00:00:00.000Z',
    last_updated: '2026-02-22T00:00:00.000Z',
    context: { id: 'context-id', user_id: null, parent_id: null },
  };
}

const automationEntity = (overrides: { entityId?: string; state?: string; attrs?: object } = {}) =>
  createEntity(overrides.entityId ?? 'automation.living_room_lights', overrides.state ?? 'on', {
    id: '1001',
    friendly_name: 'Living Room Lights',
    description: 'Turn lights on when motion is detected',
    mode: 'single',
    tags: ['lights', 'motion'],
    ...overrides.attrs,
  });

const scriptEntity = (overrides: { entityId?: string; state?: string; attrs?: object } = {}) =>
  createEntity(overrides.entityId ?? 'script.goodnight', overrides.state ?? 'off', {
    friendly_name: 'Goodnight',
    icon: 'mdi:weather-night',
    mode: 'queued',
    last_triggered: '2026-02-22T10:00:00.000Z',
    ...overrides.attrs,
  });

describe('mapEntityToCatalogItem', () => {
  it('maps an automation entity to the normalized catalog model', () => {
    expect(
      mapEntityToCatalogItem('automation', automationEntity(), { areaId: 'living_room' })
    ).toEqual({
      entity_id: 'automation.living_room_lights',
      flow_id: '1001',
      friendly_name: 'Living Room Lights',
      is_on: true,
      last_triggered: undefined,
      description: 'Turn lights on when motion is detected',
      mode: 'single',
      icon: undefined,
      area_id: 'living_room',
      tags: ['lights', 'motion'],
    });
  });

  it('takes a script id from the entity registry unique_id, not from the entity id', () => {
    // The entity was renamed after the script was created: the key is still the old one.
    const entity = scriptEntity({ entityId: 'script.good_night_routine' });
    const item = mapEntityToCatalogItem('script', entity, { uniqueId: 'goodnight' });
    expect(item?.flow_id).toBe('goodnight');
    expect(item?.entity_id).toBe('script.good_night_routine');
  });

  it('falls back to the entity id suffix when a script has no registry entry', () => {
    expect(mapEntityToCatalogItem('script', scriptEntity())?.flow_id).toBe('goodnight');
  });

  it('reports a running script as on and keeps its own icon, mode and last run', () => {
    const item = mapEntityToCatalogItem('script', scriptEntity({ state: 'on' }));
    expect(item).toMatchObject({
      is_on: true,
      icon: 'mdi:weather-night',
      mode: 'queued',
      last_triggered: '2026-02-22T10:00:00.000Z',
    });
  });

  it('returns null for entities of another domain, including the other kind', () => {
    expect(mapEntityToCatalogItem('automation', createEntity('light.x', 'on', {}))).toBeNull();
    expect(mapEntityToCatalogItem('script', automationEntity())).toBeNull();
  });
});

describe('filterFlowCatalogItemsByChip (list renders)', () => {
  const now = new Date('2026-02-22T12:00:00.000Z').getTime();
  const script = (id: string, state: string, lastTriggered?: string): FlowCatalogItem => {
    const item = mapEntityToCatalogItem(
      'script',
      scriptEntity({
        entityId: `script.${id}`,
        state,
        attrs: { friendly_name: id.toUpperCase(), last_triggered: lastTriggered },
      })
    );
    if (!item) throw new Error('not a script');
    return item;
  };
  const items = [
    script('b_idle', 'off', '2026-02-20T00:00:00.000Z'),
    script('a_running', 'on', '2026-02-22T11:59:00.000Z'),
    script('c_recent', 'off', '2026-02-22T09:00:00.000Z'),
  ];

  it("'all' returns every item sorted alphabetically", () => {
    expect(filterFlowCatalogItemsByChip(items, 'all', now).map((i) => i.flow_id)).toEqual([
      'a_running',
      'b_idle',
      'c_recent',
    ]);
  });

  it("'running' keeps only scripts whose entity is on", () => {
    expect(filterFlowCatalogItemsByChip(items, 'running', now).map((i) => i.flow_id)).toEqual([
      'a_running',
    ]);
  });

  it("'recent' keeps only items run within 24h, most recent first", () => {
    expect(filterFlowCatalogItemsByChip(items, 'recent', now).map((i) => i.flow_id)).toEqual([
      'a_running',
      'c_recent',
    ]);
  });

  it("'enabled' and 'disabled' split automations by state", () => {
    const automations = [
      mapEntityToCatalogItem('automation', automationEntity({ state: 'off' })),
      mapEntityToCatalogItem(
        'automation',
        automationEntity({ entityId: 'automation.b', attrs: { id: 'b', friendly_name: 'B' } })
      ),
    ].filter((item): item is FlowCatalogItem => item !== null);
    expect(filterFlowCatalogItemsByChip(automations, 'enabled', now).map((i) => i.flow_id)).toEqual(
      ['b']
    );
    expect(
      filterFlowCatalogItemsByChip(automations, 'disabled', now).map((i) => i.flow_id)
    ).toEqual(['1001']);
  });

  it('offers scripts no enabled/disabled chips', () => {
    expect(FLOW_CHIPS.script).toEqual(['all', 'running', 'recent']);
    expect(FLOW_CHIPS.automation).not.toContain('running');
  });
});

describe('setAutomationEnabled (toggle calls service)', () => {
  it('calls setAutomationState with the entity id and requested state', async () => {
    const setAutomationState = vi.fn().mockResolvedValue(undefined);
    const item = mapEntityToCatalogItem('automation', automationEntity());
    if (!item) throw new Error('not an automation');

    await setAutomationEnabled({ setAutomationState }, item, false);

    expect(setAutomationState).toHaveBeenCalledTimes(1);
    expect(setAutomationState).toHaveBeenCalledWith('automation.living_room_lights', false);
  });
});

describe('planFlowOpen (dirty guard blocks switch)', () => {
  it('opens directly when the canvas is clean', () => {
    expect(planFlowOpen('script', 'goodnight', false)).toEqual({
      action: 'open',
      kind: 'script',
      flowId: 'goodnight',
    });
  });

  it('requires confirmation when the canvas has unsaved changes', () => {
    expect(planFlowOpen('automation', '1001', true)).toEqual({
      action: 'confirm',
      kind: 'automation',
      flowId: '1001',
    });
  });
});

describe('findFlowEntity', () => {
  const entities = [scriptEntity({ entityId: 'script.good_night_routine' }), automationEntity()];
  const registry = [{ entity_id: 'script.good_night_routine', unique_id: 'goodnight' }];

  it('finds a renamed script through its registry unique_id', () => {
    expect(findFlowEntity('script', 'goodnight', entities, registry)?.entity_id).toBe(
      'script.good_night_routine'
    );
  });

  it('never returns an entity of the other kind', () => {
    expect(findFlowEntity('script', '1001', entities, registry)).toBeUndefined();
    expect(findFlowEntity('automation', 'goodnight', entities, registry)).toBeUndefined();
  });

  it('finds an automation by its id attribute', () => {
    expect(findFlowEntity('automation', '1001', entities, registry)?.entity_id).toBe(
      'automation.living_room_lights'
    );
  });
});

describe('uniqueScriptKey', () => {
  it('slugs the alias into [a-z0-9_]', () => {
    expect(uniqueScriptKey('Good Night — Café!', [])).toBe('good_night_cafe');
  });

  it('appends _2, _3 ... instead of reusing an existing key', () => {
    expect(uniqueScriptKey('Lights', ['lights'])).toBe('lights_2');
    expect(uniqueScriptKey('Lights', ['lights', 'lights_2'])).toBe('lights_3');
  });

  it('still yields a valid key for an alias with no usable characters', () => {
    expect(uniqueScriptKey('日本語', [])).toBe('script');
  });
});
