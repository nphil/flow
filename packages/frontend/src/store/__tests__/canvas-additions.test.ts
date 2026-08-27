/**
 * Covers the three Wave-2 store additions: `isDirty`, `autoArrange`, and
 * `openAutomationById`.
 */

import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { generateUUID } from '@/lib/utils';
import { type FlowNodeData, useFlowStore } from '../flow-store';

vi.mock('@flow/transpiler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flow/transpiler')>();
  return {
    ...actual,
    applyHeuristicLayout: vi.fn(async (nodes: { id: string }[]) =>
      nodes.map((n, i) => ({ ...n, position: { x: i * 300, y: i * 50 } }))
    ),
  };
});

vi.mock('@/lib/ha-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ha-api')>();
  return { ...actual, getHomeAssistantAPI: vi.fn() };
});

const triggerNode: Node<FlowNodeData> = {
  id: 'trigger-1',
  type: 'trigger',
  position: { x: 0, y: 0 },
  data: { trigger: 'state' },
};
const actionNode: Node<FlowNodeData> = {
  id: 'action-1',
  type: 'action',
  position: { x: 100, y: 0 },
  data: { service: 'light.turn_on' },
};

function flushDebounce() {
  vi.advanceTimersByTime(300);
}

describe('isDirty', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('is false for a brand-new empty automation', () => {
    expect(useFlowStore.getState().isDirty()).toBe(false);
  });

  it('is true once nodes are added to a new (never-saved) automation', () => {
    useFlowStore.getState().addNode(triggerNode);
    expect(useFlowStore.getState().isDirty()).toBe(true);
  });

  it('is false immediately after loading a graph, true after an edit', () => {
    useFlowStore.getState().fromFlowGraph({
      id: generateUUID(),
      name: 'Loaded automation',
      nodes: [
        { id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: { trigger: 'state' } },
      ],
      edges: [],
      version: 1,
    });
    expect(useFlowStore.getState().isDirty()).toBe(false);

    useFlowStore.getState().updateNodeData('trigger-1', { alias: 'Renamed' });
    expect(useFlowStore.getState().isDirty()).toBe(true);
  });

  it('agrees with hasRealChanges (same underlying comparison)', () => {
    useFlowStore.getState().addNode(triggerNode);
    const state = useFlowStore.getState();
    expect(state.isDirty()).toBe(state.hasRealChanges());
  });
});

describe('autoArrange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    useFlowStore.getState().reset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('is a no-op on an empty canvas', async () => {
    await useFlowStore.getState().autoArrange();
    expect(useFlowStore.getState().nodes).toHaveLength(0);
    expect(useFlowStore.getState().isArranging).toBe(false);
  });

  it('returns positioned nodes and toggles isArranging around the call', async () => {
    useFlowStore.getState().addNode(triggerNode);
    useFlowStore.getState().addNode(actionNode);
    flushDebounce();

    const promise = useFlowStore.getState().autoArrange('RIGHT');
    expect(useFlowStore.getState().isArranging).toBe(true);
    await promise;

    const { nodes } = useFlowStore.getState();
    expect(nodes.find((n) => n.id === 'trigger-1')?.position).toEqual({ x: 0, y: 0 });
    expect(nodes.find((n) => n.id === 'action-1')?.position).toEqual({ x: 300, y: 50 });
    expect(useFlowStore.getState().hasUnsavedChanges).toBe(true);

    // isArranging clears on a short timer after the position set (keeps the
    // CSS transition window open) rather than synchronously.
    await vi.advanceTimersByTimeAsync(250);
    expect(useFlowStore.getState().isArranging).toBe(false);
  });

  it('undo after arrange restores the pre-arrange positions', async () => {
    useFlowStore.getState().addNode(triggerNode);
    useFlowStore.getState().addNode(actionNode);
    flushDebounce();

    await useFlowStore.getState().autoArrange('RIGHT');
    await vi.advanceTimersByTimeAsync(250);
    flushDebounce();

    expect(useFlowStore.getState().nodes.find((n) => n.id === 'action-1')?.position).toEqual({
      x: 300,
      y: 50,
    });

    useFlowStore.temporal.getState().undo();

    expect(useFlowStore.getState().nodes.find((n) => n.id === 'action-1')?.position).toEqual({
      x: 100,
      y: 0,
    });
  });
});

describe('openAutomationById', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('throws when not connected to Home Assistant, without touching the canvas', async () => {
    vi.mocked(getHomeAssistantAPI).mockReturnValue({
      isConnected: () => false,
    } as unknown as ReturnType<typeof getHomeAssistantAPI>);

    await expect(useFlowStore.getState().openAutomationById('automation.test')).rejects.toThrow(
      /not connected/i
    );
    expect(useFlowStore.getState().automationId).toBeNull();
  });

  it('sets name/id from the automation id when the config fetch comes back empty', async () => {
    vi.mocked(getHomeAssistantAPI).mockReturnValue({
      isConnected: () => true,
      getAutomationConfigWithFallback: vi.fn().mockResolvedValue(null),
    } as unknown as ReturnType<typeof getHomeAssistantAPI>);

    await useFlowStore.getState().openAutomationById('automation.missing_config');

    const state = useFlowStore.getState();
    expect(state.automationId).toBe('automation.missing_config');
    expect(state.flowName).toBe('automation.missing_config');
    expect(state.nodes).toHaveLength(0);
  });

  it('parses a fetched YAML config into the canvas via the transpiler and sets id/name from its alias', async () => {
    vi.mocked(getHomeAssistantAPI).mockReturnValue({
      isConnected: () => true,
      getAutomationConfigWithFallback: vi.fn().mockResolvedValue({
        alias: 'Porch light at dusk',
        trigger: [{ platform: 'sun', event: 'sunset' }],
        action: [{ service: 'light.turn_on', target: { entity_id: 'light.porch' } }],
      }),
    } as unknown as ReturnType<typeof getHomeAssistantAPI>);

    await useFlowStore.getState().openAutomationById('automation.porch_light');

    const state = useFlowStore.getState();
    expect(state.automationId).toBe('automation.porch_light');
    expect(state.flowName).toBe('Porch light at dusk');
    expect(state.nodes.some((n) => n.type === 'trigger')).toBe(true);
    expect(state.nodes.some((n) => n.type === 'action')).toBe(true);
  });
});
