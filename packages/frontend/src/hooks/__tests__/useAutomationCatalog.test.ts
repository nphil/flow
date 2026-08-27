import { describe, expect, it, vi } from 'vitest';
import type { HassEntity } from '@/types/hass';
import {
  filterAutomationCatalogItemsByChip,
  mapAutomationEntityToCatalogItem,
  planAutomationOpen,
  setAutomationEnabled,
} from '../useAutomationCatalog';

function createAutomationEntity(overrides: Partial<HassEntity> = {}): HassEntity {
  return {
    entity_id: 'automation.living_room_lights',
    state: 'on',
    attributes: {
      id: '1001',
      friendly_name: 'Living Room Lights',
      description: 'Turn lights on when motion is detected',
      mode: 'single',
      tags: ['lights', 'motion'],
      ...overrides.attributes,
    },
    last_changed: '2026-02-22T00:00:00.000Z',
    last_updated: '2026-02-22T00:00:00.000Z',
    context: {
      id: 'context-id',
      user_id: null,
      parent_id: null,
    },
    ...overrides,
  };
}

describe('useAutomationCatalog helpers', () => {
  it('maps an automation entity to the normalized catalog model', () => {
    const entity = createAutomationEntity();
    const item = mapAutomationEntityToCatalogItem(entity, 'living_room');

    expect(item).toEqual({
      entity_id: 'automation.living_room_lights',
      automation_id: '1001',
      friendly_name: 'Living Room Lights',
      enabled: true,
      last_triggered: undefined,
      description: 'Turn lights on when motion is detected',
      mode: 'single',
      area_id: 'living_room',
      tags: ['lights', 'motion'],
    });
  });

  it('returns null for non-automation entities', () => {
    const entity = createAutomationEntity({ entity_id: 'light.living_room' });
    expect(mapAutomationEntityToCatalogItem(entity)).toBeNull();
  });

  describe('filterAutomationCatalogItemsByChip (list renders)', () => {
    const now = new Date('2026-02-22T12:00:00.000Z').getTime();
    const items = [
      mapAutomationEntityToCatalogItem(
        createAutomationEntity({
          entity_id: 'automation.b_disabled',
          state: 'off',
          attributes: { id: 'b', friendly_name: 'B Disabled', description: '', tags: [] },
        })
      )!,
      {
        ...mapAutomationEntityToCatalogItem(
          createAutomationEntity({
            entity_id: 'automation.a_recent',
            attributes: { id: 'a', friendly_name: 'A Recent', description: '', tags: [] },
          })
        )!,
        last_triggered: new Date(now - 60 * 60 * 1000).toISOString(), // 1h ago
      },
      {
        ...mapAutomationEntityToCatalogItem(
          createAutomationEntity({
            entity_id: 'automation.c_stale',
            attributes: { id: 'c', friendly_name: 'C Stale', description: '', tags: [] },
          })
        )!,
        last_triggered: new Date(now - 48 * 60 * 60 * 1000).toISOString(), // 2 days ago
      },
    ];

    it("'all' returns every item sorted alphabetically", () => {
      const result = filterAutomationCatalogItemsByChip(items, 'all', now);
      expect(result.map((item) => item.friendly_name)).toEqual([
        'A Recent',
        'B Disabled',
        'C Stale',
      ]);
    });

    it("'enabled' keeps only enabled automations", () => {
      const result = filterAutomationCatalogItemsByChip(items, 'enabled', now);
      expect(result.map((item) => item.automation_id)).toEqual(['a', 'c']);
    });

    it("'disabled' keeps only disabled automations", () => {
      const result = filterAutomationCatalogItemsByChip(items, 'disabled', now);
      expect(result.map((item) => item.automation_id)).toEqual(['b']);
    });

    it("'recent' keeps only automations triggered within 24h, most recent first", () => {
      const result = filterAutomationCatalogItemsByChip(items, 'recent', now);
      expect(result.map((item) => item.automation_id)).toEqual(['a']);
    });
  });

  describe('setAutomationEnabled (toggle calls service)', () => {
    it('calls setAutomationState with the entity id and requested state', async () => {
      const setAutomationState = vi.fn().mockResolvedValue(undefined);
      const item = mapAutomationEntityToCatalogItem(createAutomationEntity())!;

      await setAutomationEnabled({ setAutomationState }, item, false);

      expect(setAutomationState).toHaveBeenCalledTimes(1);
      expect(setAutomationState).toHaveBeenCalledWith('automation.living_room_lights', false);
    });
  });

  describe('planAutomationOpen (dirty guard blocks switch)', () => {
    it('opens directly when the canvas is clean', () => {
      expect(planAutomationOpen('1001', false)).toEqual({ action: 'open', automationId: '1001' });
    });

    it('requires confirmation when the canvas has unsaved changes', () => {
      expect(planAutomationOpen('1001', true)).toEqual({
        action: 'confirm',
        automationId: '1001',
      });
    });
  });
});
