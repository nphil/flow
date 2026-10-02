import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getHomeAssistantAPI, type HomeAssistantAPI } from '@/lib/ha-api';
import type { FlowConfig, HomeAssistant } from '@/types/hass';
import { useFlowStore } from '../flow-store';

vi.mock('@/lib/ha-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ha-api')>();
  return { ...actual, getHomeAssistantAPI: vi.fn() };
});

const hass = {} as HomeAssistant;

interface FakeApi {
  isConnected: () => boolean;
  getFlowConfigWithFallback: ReturnType<typeof vi.fn>;
  createFlow: ReturnType<typeof vi.fn>;
  updateFlow: ReturnType<typeof vi.fn>;
}

/** An API whose stored config for the opened item is `config`; records what is written. */
function fakeApi(config: FlowConfig): FakeApi {
  const api: FakeApi = {
    isConnected: () => true,
    getFlowConfigWithFallback: vi.fn().mockResolvedValue(config),
    createFlow: vi.fn().mockResolvedValue('new_key'),
    updateFlow: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(getHomeAssistantAPI).mockReturnValue(api as unknown as HomeAssistantAPI);
  return api;
}

function lastWritten(call: unknown[]): Record<string, unknown> {
  return call[call.length - 1] as Record<string, unknown>;
}

describe('saving an automation keeps its root variables', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('hands the API the variables and trigger_variables it was opened with', async () => {
    const api = fakeApi({
      alias: 'Porch light',
      variables: { threshold: 20, room: 'porch' },
      trigger_variables: { tv: 1 },
      triggers: [{ trigger: 'sun', event: 'sunset' }],
      actions: [{ action: 'light.turn_on', target: { entity_id: 'light.porch' } }],
    });

    await useFlowStore.getState().openFlowById('automation', '123');
    useFlowStore.getState().setFlowDescription('Edited');
    await useFlowStore.getState().updateFlow(hass);

    expect(api.updateFlow).toHaveBeenCalledTimes(1);
    const [kind, id] = api.updateFlow.mock.calls[0];
    expect([kind, id]).toEqual(['automation', '123']);
    const stored = lastWritten(api.updateFlow.mock.calls[0]);
    expect(stored.variables).toMatchObject({ threshold: 20, room: 'porch' });
    expect(stored.trigger_variables).toEqual({ tv: 1 });
    expect(stored.description).toBe('Edited');
  });
});

describe('scripts', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('opens as a script and saves a sequence with no triggers, keeping icon and fields', async () => {
    const api = fakeApi({
      alias: 'Goodnight',
      icon: 'mdi:weather-night',
      fields: { room: { name: 'Room', required: true } },
      sequence: [{ action: 'light.turn_off', target: { entity_id: 'light.bedroom' } }],
    });

    await useFlowStore.getState().openFlowById('script', 'goodnight');
    const opened = useFlowStore.getState();
    expect(opened.flowKind).toBe('script');
    expect(opened.automationId).toBe('goodnight');
    expect(opened.nodes.some((n) => n.type === 'trigger')).toBe(false);

    useFlowStore.getState().setFlowDescription('Lights out');
    await useFlowStore.getState().updateFlow(hass);

    const [kind, id] = api.updateFlow.mock.calls[0];
    expect([kind, id]).toEqual(['script', 'goodnight']);
    const stored = lastWritten(api.updateFlow.mock.calls[0]);
    expect(stored.sequence).toHaveLength(1);
    expect(stored).not.toHaveProperty('triggers');
    expect(stored).not.toHaveProperty('trigger');
    expect(stored.icon).toBe('mdi:weather-night');
    expect(stored.fields).toEqual({ room: { name: 'Room', required: true } });
  });

  it('falls back to the key as the name when the script has no alias', async () => {
    fakeApi({ sequence: [{ delay: '00:00:05' }] });
    await useFlowStore.getState().openFlowById('script', 'no_alias');
    expect(useFlowStore.getState().flowName).toBe('no_alias');
  });

  it('refuses to save a script that has a trigger node', async () => {
    const api = fakeApi({ alias: 'S', sequence: [{ delay: '00:00:05' }] });
    await useFlowStore.getState().openFlowById('script', 's');
    useFlowStore.getState().addNode({
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'state', entity_id: 'light.a' },
    });

    await expect(useFlowStore.getState().saveFlow(hass)).rejects.toThrow(/no triggers/i);
    expect(api.createFlow).not.toHaveBeenCalled();
  });

  it('creates a new script through createFlow', async () => {
    const api = fakeApi({ alias: 'S', sequence: [{ delay: '00:00:05' }] });
    await useFlowStore.getState().openFlowById('script', 's');
    useFlowStore.getState().setAutomationId(null);

    await expect(useFlowStore.getState().saveFlow(hass)).resolves.toBe('new_key');
    expect(api.createFlow.mock.calls[0][0]).toBe('script');
    expect(useFlowStore.getState().automationId).toBe('new_key');
  });
});

describe('blueprint instances', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('opens read-only and is never written', async () => {
    const api = fakeApi({
      alias: 'From blueprint',
      use_blueprint: { path: 'motion_light.yaml', input: { light: 'light.hall' } },
    });

    await useFlowStore.getState().openFlowById('automation', '777');
    const state = useFlowStore.getState();
    expect(state.blueprint?.use_blueprint.path).toBe('motion_light.yaml');
    expect(state.nodes).toHaveLength(0);

    await expect(state.updateFlow(hass)).rejects.toThrow(/blueprint/i);
    useFlowStore.getState().setAutomationId(null);
    await expect(useFlowStore.getState().saveFlow(hass)).rejects.toThrow(/blueprint/i);
    expect(api.createFlow).not.toHaveBeenCalled();
    expect(api.updateFlow).not.toHaveBeenCalled();
  });
});
