/**
 * Contract for the exported HA step `id:` (node.data.id — a field entirely
 * separate from the node's own graph id): Home Assistant permits multiple
 * triggers to SHARE an id (it groups them for `condition: trigger` routing),
 * and a trigger-condition's `id` is a reference to a trigger id, never an
 * identity. Upstream CAFE blocked saves on any shared `data.id` (#170); that
 * check rejected unmodified real-world automations and was removed in
 * Flow 1.0.1. These tests pin the corrected behavior.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '../flow-store';

describe('Node ID validation (HA semantics)', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('allows two triggers sharing the same data.id (HA trigger grouping)', () => {
    const { addNode, validateAllNodes } = useFlowStore.getState();
    addNode({
      id: 'n1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'state', entity_id: 'binary_sensor.a', id: 'shared' },
    });
    addNode({
      id: 'n2',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'state', entity_id: 'binary_sensor.b', id: 'shared' },
    });

    validateAllNodes();

    const state = useFlowStore.getState();
    expect(state.nodeErrors.get('n1')).toBeUndefined();
    expect(state.nodeErrors.get('n2')).toBeUndefined();
  });

  it('allows a trigger-condition to reference a trigger id without a clash', () => {
    const { addNode, validateAllNodes } = useFlowStore.getState();
    addNode({
      id: 'n1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'sun', event: 'sunset', id: 'sunset' },
    });
    addNode({
      id: 'n2',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: { condition: 'trigger', id: 'sunset' },
    });

    validateAllNodes();

    const state = useFlowStore.getState();
    expect(state.nodeErrors.get('n1')).toBeUndefined();
    expect(state.nodeErrors.get('n2')).toBeUndefined();
    expect(state.hasValidationErrors()).toBe(false);
  });

  it('still surfaces per-node schema errors through validateAllNodes', () => {
    const { addNode, validateAllNodes } = useFlowStore.getState();
    // A device trigger with no device_id is genuinely invalid per-node.
    addNode({
      id: 'n1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'device' },
    });

    validateAllNodes();

    const state = useFlowStore.getState();
    expect((state.nodeErrors.get('n1') ?? []).length).toBeGreaterThan(0);
  });
});
