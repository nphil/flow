import type { Edge, Node } from '@xyflow/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FlowNodeData } from '@/store/flow-store';
import {
  buildLintGraph,
  type LintGraphSource,
  readabilityOf,
  resetReadabilityCache,
} from '../readability';

const TRIGGER_DATA = {
  alias: 'Door opens',
  trigger: 'state',
  entity_id: 'binary_sensor.front_door',
  to: 'on',
};
const ACTION_DATA = {
  alias: 'Light on',
  service: 'light.turn_on',
  target: { entity_id: 'light.kitchen' },
};

function node(id: string, type: string, data: object, x = 0): Node<FlowNodeData> {
  return { id, type, position: { x, y: 0 }, data: data as FlowNodeData };
}

function source(nodes: Node<FlowNodeData>[], edges: Edge[] = []): LintGraphSource {
  return {
    nodes,
    edges,
    flowId: '11111111-1111-4111-8111-111111111111',
    flowName: 'Test',
    flowDescription: 'Switches the kitchen light',
    flowMetadata: { mode: 'single' },
    userVariables: undefined,
    userTriggerVariables: undefined,
  };
}

const edge = (id: string, from: string, to: string): Edge => ({ id, source: from, target: to });

describe('buildLintGraph', () => {
  it('keeps the very same data object per node, so untouched nodes stay reference-equal', () => {
    const trigger = node('t1', 'trigger', TRIGGER_DATA);
    const graph = buildLintGraph(source([trigger]));
    expect(graph.nodes[0].data).toBe(trigger.data);
  });

  it('does not invent a service for an action that has none (a stop step)', () => {
    const stop = node('a1', 'action', { stop: 'Done' });
    const graph = buildLintGraph(source([stop]));
    expect(graph.nodes[0].data).toEqual({ stop: 'Done' });
  });

  it('leaves out unknown node types and edges that point at a missing node', () => {
    const graph = buildLintGraph(
      source(
        [node('t1', 'trigger', TRIGGER_DATA), node('x1', 'sticky_note', {})],
        [edge('e1', 't1', 'x1'), edge('e2', 't1', 'gone')]
      )
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(['t1']);
    expect(graph.edges).toEqual([]);
  });

  it('carries the automation name, description and an empty description as undefined', () => {
    expect(buildLintGraph(source([])).description).toBe('Switches the kitchen light');
    expect(buildLintGraph({ ...source([]), flowDescription: '' }).description).toBeUndefined();
  });
});

describe('readabilityOf', () => {
  beforeEach(() => resetReadabilityCache());

  const flow = () => [node('t1', 'trigger', TRIGGER_DATA), node('a1', 'action', ACTION_DATA, 300)];

  it('groups findings by severity and indexes them by node', () => {
    const unnamed = node('t2', 'trigger', { ...TRIGGER_DATA, alias: undefined });
    const report = readabilityOf(source([...flow(), unnamed]));

    expect(report.warnings.map((f) => f.ruleId)).toContain('unavailable-restore');
    expect(report.suggestions.map((f) => f.ruleId)).toContain('missing-alias');
    expect(report.findings).toHaveLength(report.warnings.length + report.suggestions.length);
    expect(report.byNodeId.get('t1')?.some((f) => f.ruleId === 'unavailable-restore')).toBe(true);
    expect(report.safeFixCount).toBeGreaterThan(0);
  });

  it('builds the node-dot text from warnings only', () => {
    const unnamed = node('t2', 'trigger', { trigger: 'time', at: '07:00:00' });
    const report = readabilityOf(source([...flow(), unnamed]));

    expect(report.warningSummaryByNodeId.get('t1')).toContain('front_door');
    // t2 only has a suggestion (no name): no dot.
    expect(report.byNodeId.get('t2')?.length).toBeGreaterThan(0);
    expect(report.warningSummaryByNodeId.has('t2')).toBe(false);
  });

  it('does not treat a stop step as something that switches a light', () => {
    const report = readabilityOf(
      source([
        node('t1', 'trigger', TRIGGER_DATA),
        node('a1', 'action', { alias: 'x', stop: 'Done' }),
      ])
    );
    expect(report.findings.some((f) => f.ruleId === 'unavailable-restore')).toBe(false);
  });

  it('returns the same object while nothing the lint reads has changed', () => {
    const nodes = flow();
    const edges = [edge('e1', 't1', 'a1')];
    const first = readabilityOf(source(nodes, edges));
    expect(readabilityOf(source(nodes, edges))).toBe(first);
  });

  it('stays a cache hit when a node is only dragged or selected', () => {
    const nodes = flow();
    const edges = [edge('e1', 't1', 'a1')];
    const first = readabilityOf(source(nodes, edges));
    const moved = nodes.map((n) => ({ ...n, position: { x: 99, y: 42 }, selected: true }));
    expect(readabilityOf(source(moved, edges))).toBe(first);
  });

  it('recomputes when node data, edges, name or description change', () => {
    const nodes = flow();
    const edges = [edge('e1', 't1', 'a1')];
    const first = readabilityOf(source(nodes, edges));

    const edited = nodes.map((n) =>
      n.id === 't1' ? { ...n, data: { ...n.data, from: 'off' } } : n
    );
    const afterEdit = readabilityOf(source(edited as Node<FlowNodeData>[], edges));
    expect(afterEdit).not.toBe(first);

    const afterEdges = readabilityOf(source(edited as Node<FlowNodeData>[], [...edges]));
    expect(afterEdges).not.toBe(afterEdit);

    const afterName = readabilityOf({
      ...source(edited as Node<FlowNodeData>[], [...edges]),
      flowName: 'New',
    });
    expect(afterName).not.toBe(afterEdges);

    const afterDescription = readabilityOf({
      ...source(edited as Node<FlowNodeData>[], [...edges]),
      flowName: 'New',
      flowDescription: '',
    });
    expect(afterDescription).not.toBe(afterName);
    expect(afterDescription.findings.some((f) => f.ruleId === 'missing-description')).toBe(true);
  });

  it('reports an empty canvas as zero nodes and no findings', () => {
    const report = readabilityOf(source([]));
    expect(report.nodeCount).toBe(0);
    expect(report.findings).toEqual([]);
  });
});
