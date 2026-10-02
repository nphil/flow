/**
 * Applying a readability fix goes through the store's `applyGraphEdit`: one undo step, nothing
 * else on the canvas is disturbed, and a fix that changes nothing leaves no trace.
 */

import type { FlowGraph } from '@flow/shared';
import { FlowTranspiler } from '@flow/transpiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAllSafeReadabilityFixes, applyReadabilityFix } from '@/hooks/useReadability';
import { buildLintGraph, readabilityOf } from '@/lib/readability';
import { useFlowStore } from '../flow-store';

const GRAPH: FlowGraph = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Door light',
  description: 'Lights the hall when the door opens',
  version: 1,
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 10, y: 20 },
      data: {
        alias: 'Door opens',
        trigger: 'state',
        entity_id: 'binary_sensor.front_door',
        to: 'on',
      },
    },
    {
      id: 'condition-1',
      type: 'condition',
      position: { x: 300, y: 20 },
      data: {
        alias: 'Kitchen is off',
        condition: 'template',
        value_template: "{{ is_state('light.kitchen', 'off') }}",
      },
    },
    {
      id: 'action-1',
      type: 'action',
      position: { x: 600, y: 20 },
      data: {
        alias: 'Light on',
        service: 'light.turn_on',
        target: { entity_id: 'light.kitchen' },
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger-1', target: 'condition-1' },
    { id: 'e2', source: 'condition-1', target: 'action-1', sourceHandle: 'true' },
  ],
};

const state = () => useFlowStore.getState();
const nodeById = (id: string) => state().nodes.find((n) => n.id === id);
const pastCount = () => useFlowStore.temporal.getState().pastStates.length;

function flushDebounce() {
  vi.advanceTimersByTime(300);
}

/** The first fix of the first finding of a rule. */
function fixOf(ruleId: string, index = 0) {
  const finding = readabilityOf(state()).findings.find((f) => f.ruleId === ruleId);
  const fix = finding?.fixes[index];
  if (!fix) throw new Error(`no fix ${index} for ${ruleId}`);
  return fix;
}

describe('readability fixes in the store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllTimers();
    state().fromFlowGraph(GRAPH);
    // Select the action so we can check selection survives a fix elsewhere.
    state().setNodes(state().nodes.map((n) => ({ ...n, selected: n.id === 'action-1' })));
    state().selectNode('action-1');
    flushDebounce();
    useFlowStore.temporal.getState().clear();
    state().setUnsavedChanges(false);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('applies one fix as one undo step that undo and redo both walk', () => {
    const trigger = nodeById('trigger-1');
    const fix = fixOf('unavailable-restore');

    expect(applyReadabilityFix(fix)).toBe(true);
    flushDebounce();

    expect(nodeById('trigger-1')?.data).toMatchObject({ not_from: ['unavailable'] });
    expect(state().hasUnsavedChanges).toBe(true);
    expect(pastCount()).toBe(1);

    useFlowStore.temporal.getState().undo();
    expect(nodeById('trigger-1')).toBe(trigger);
    expect(nodeById('trigger-1')?.data).not.toHaveProperty('not_from');

    useFlowStore.temporal.getState().redo();
    expect(nodeById('trigger-1')?.data).toMatchObject({ not_from: ['unavailable'] });
  });

  it('keeps the canvas objects, positions and selection of nodes the fix did not touch', () => {
    const before = { condition: nodeById('condition-1'), action: nodeById('action-1') };
    const edgesBefore = state().edges;

    applyReadabilityFix(fixOf('unavailable-restore'));

    expect(nodeById('condition-1')).toBe(before.condition);
    expect(nodeById('action-1')).toBe(before.action);
    expect(nodeById('action-1')?.selected).toBe(true);
    expect(state().selectedNodeId).toBe('action-1');
    expect(nodeById('trigger-1')?.position).toEqual({ x: 10, y: 20 });
    expect(state().edges).toBe(edgesBefore);
  });

  it('keeps the position of a changed node even when the edited graph carries another one', () => {
    const graph = buildLintGraph(state());
    state().applyGraphEdit({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === 'trigger-1'
          ? { ...n, position: { x: 999, y: 999 }, data: { ...n.data, alias: 'Renamed' } }
          : n
      ),
    });
    expect(nodeById('trigger-1')?.position).toEqual({ x: 10, y: 20 });
    expect(nodeById('trigger-1')?.data).toMatchObject({ alias: 'Renamed' });
  });

  it('does nothing, and records no undo step, when the edit changes nothing', () => {
    const nodes = state().nodes;
    const edges = state().edges;

    state().applyGraphEdit(buildLintGraph(state()));
    flushDebounce();

    expect(state().nodes).toBe(nodes);
    expect(state().edges).toBe(edges);
    expect(state().hasUnsavedChanges).toBe(false);
    expect(pastCount()).toBe(0);
  });

  it('treats a fix that no longer applies as a harmless no-op', () => {
    const fix = fixOf('unavailable-restore');
    applyReadabilityFix(fix);
    flushDebounce();
    const afterFirst = state().nodes;

    expect(applyReadabilityFix(fix)).toBe(false);
    flushDebounce();

    expect(state().nodes).toBe(afterFirst);
    expect(pastCount()).toBe(1);
  });

  it('fixes everything safe in ONE undo step and leaves unsafe fixes alone', () => {
    const original = state().nodes;
    const fixed = applyAllSafeReadabilityFixes();
    flushDebounce();

    // The restore guard and the template that only checks a state.
    expect(fixed).toBe(2);
    expect(pastCount()).toBe(1);
    const report = readabilityOf(state());
    expect(report.safeFixCount).toBe(0);
    expect(nodeById('condition-1')?.data).toMatchObject({
      condition: 'state',
      entity_id: 'light.kitchen',
      state: 'off',
    });

    useFlowStore.temporal.getState().undo();
    expect(state().nodes).toBe(original);
  });

  it('shows the fixed YAML afterwards (every node the fix touched is in the output)', () => {
    const transpiler = new FlowTranspiler();
    const yamlOf = () => transpiler.transpile(state().toFlowGraph()).yaml ?? '';
    expect(yamlOf()).toContain('is_state');

    applyAllSafeReadabilityFixes();
    const fixedYaml = yamlOf();

    expect(fixedYaml).toContain('not_from');
    expect(fixedYaml).not.toContain('is_state');
    expect(fixedYaml).toContain('Lights the hall when the door opens');
  });

  it('drops a node that is not in the edited graph, with its selection and edges', () => {
    const graph = buildLintGraph(state());
    state().applyGraphEdit({
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== 'action-1'),
      edges: graph.edges.filter((e) => e.target !== 'action-1'),
    });

    expect(state().nodes.map((n) => n.id)).toEqual(['trigger-1', 'condition-1']);
    expect(state().edges.map((e) => e.id)).toEqual(['e1']);
    expect(state().selectedNodeId).toBeNull();
  });

  it('re-validates the nodes after the edit', () => {
    const graph = buildLintGraph(state());
    state().applyGraphEdit({
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === 'action-1' ? { ...n, data: { alias: 'Light on' } } : n
      ),
    });
    expect(state().nodeErrors.has('action-1')).toBe(true);
  });
});
