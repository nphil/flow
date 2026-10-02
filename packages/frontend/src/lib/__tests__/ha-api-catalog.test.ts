import { describe, expect, it, vi } from 'vitest';
import type { HomeAssistant } from '@/types/hass';
import { HomeAssistantAPI } from '../ha-api';

describe('HomeAssistantAPI catalog helpers', () => {
  it('extracts zone entities from states', async () => {
    const mockHass = {
      states: {
        'zone.home': {
          entity_id: 'zone.home',
          state: 'zoning',
          attributes: {
            friendly_name: 'Home',
            latitude: 1,
            longitude: 2,
            radius: 100,
            passive: false,
          },
        },
        'light.kitchen': {
          entity_id: 'light.kitchen',
          state: 'on',
          attributes: {},
        },
      },
    } as unknown as HomeAssistant;

    const api = new HomeAssistantAPI(mockHass);
    const zones = await api.getZones();

    expect(zones).toEqual([
      {
        entity_id: 'zone.home',
        zone_id: 'home',
        name: 'Home',
        latitude: 1,
        longitude: 2,
        radius: 100,
        passive: false,
      },
    ]);
  });

  it('builds a normalized automation catalog with area assignments', async () => {
    const sendMessagePromise = vi.fn(async (message: { type: string }) => {
      if (message.type === 'config/entity_registry/list') {
        return [
          {
            entity_id: 'automation.morning',
            area_id: 'living_room',
          },
        ];
      }
      return [];
    });

    const mockHass = {
      connection: {
        sendMessagePromise,
      },
      states: {
        'automation.morning': {
          entity_id: 'automation.morning',
          state: 'on',
          attributes: {
            id: '42',
            friendly_name: 'Morning Routine',
            description: 'Test automation',
            mode: 'single',
            tags: ['morning'],
          },
        },
      },
    } as unknown as HomeAssistant;

    const api = new HomeAssistantAPI(mockHass);
    const catalog = await api.getFlowCatalog('automation');

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      entity_id: 'automation.morning',
      flow_id: '42',
      friendly_name: 'Morning Routine',
      is_on: true,
      description: 'Test automation',
      mode: 'single',
      area_id: 'living_room',
      tags: ['morning'],
    });
  });

  it('creates a script under a new key instead of overwriting an existing one', async () => {
    const callApi = vi.fn().mockResolvedValue({});
    const mockHass = {
      connection: {
        sendMessagePromise: vi.fn(async (message: { type: string }) =>
          message.type === 'config/entity_registry/list'
            ? [{ entity_id: 'script.goodnight', unique_id: 'goodnight' }]
            : []
        ),
      },
      callApi,
      states: {
        'script.goodnight': {
          entity_id: 'script.goodnight',
          state: 'off',
          attributes: { friendly_name: 'Goodnight' },
        },
      },
    } as unknown as HomeAssistant;

    const api = new HomeAssistantAPI(mockHass);
    const key = await api.createFlow('script', {
      alias: 'Goodnight',
      sequence: [{ delay: '00:00:01' }],
    });

    expect(key).toBe('goodnight_2');
    expect(callApi).toHaveBeenCalledWith(
      'POST',
      'config/script/config/goodnight_2',
      expect.objectContaining({ alias: 'Goodnight', sequence: [{ delay: '00:00:01' }] })
    );
    expect(callApi.mock.calls[0][2]).not.toHaveProperty('triggers');
  });
});
