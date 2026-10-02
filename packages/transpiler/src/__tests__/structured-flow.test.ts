// @vitest-environment node
//
// A flow graph can be written back as nested YAML exactly when it is made of
// properly nested blocks: every branch opens a region that closes again at one
// join (or ends the run), and nothing crosses between regions. Anything else
// must stay on the state-machine strategy.
import type { FlowEdge, FlowGraph, FlowNode } from '@flow/shared';
import { describe, expect, it } from 'vitest';
import { computePostDominators, isStructuredFlow } from '../analyzer/structure';
import { analyzeTopology } from '../analyzer/topology';

function node(id: string, type: FlowNode['type'], data: Record<string, unknown> = {}): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as FlowNode;
}

const trigger = (id: string) => node(id, 'trigger', { trigger: 'time_pattern', minutes: '/5' });
const cond = (id: string) =>
  node(id, 'condition', { condition: 'template', value_template: `{{ ${id} }}` });
const act = (id: string) => node(id, 'action', { service: `light.${id}` });
const stop = (id: string) => node(id, 'action', { stop: 'done' });

function edge(source: string, target: string, sourceHandle?: 'true' | 'false'): FlowEdge {
  return {
    id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
    source,
    target,
    sourceHandle,
  };
}

function graph(nodes: FlowNode[], edges: FlowEdge[]): FlowGraph {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    name: 'test',
    nodes,
    edges,
    version: 1,
    metadata: { mode: 'single' },
  };
}

describe('join of a branch', () => {
  it('is the nearest node both branches pass through', () => {
    const g = graph(
      [trigger('t'), cond('c'), act('a'), act('b'), act('k'), act('after')],
      [
        edge('t', 'c'),
        edge('c', 'a', 'true'),
        edge('c', 'b', 'false'),
        edge('a', 'k'),
        edge('b', 'k'),
        edge('k', 'after'),
      ]
    );
    expect(computePostDominators(g).joinOf(['a', 'b'])).toBe('k');
  });

  it('does not exist when one branch stops the run', () => {
    const g = graph(
      [trigger('t'), cond('c'), act('a'), stop('s'), act('rest')],
      [edge('t', 'c'), edge('c', 'a', 'true'), edge('a', 's'), edge('c', 'rest', 'false')]
    );
    expect(computePostDominators(g).joinOf(['a', 'rest'])).toBeNull();
  });
});

describe('structured flows take the native strategy', () => {
  it('a long then-branch that stops, followed by more steps', () => {
    const g = graph(
      [trigger('t'), cond('c'), act('n1'), act('n2'), stop('s'), act('rest1'), act('rest2')],
      [
        edge('t', 'c'),
        edge('c', 'n1', 'true'),
        edge('n1', 'n2'),
        edge('n2', 's'),
        edge('c', 'rest1', 'false'),
        edge('rest1', 'rest2'),
      ]
    );
    const analysis = analyzeTopology(g);
    expect(analysis.isStructured).toBe(true);
    expect(analysis.recommendedStrategy).toBe('native');
  });

  it('a block nested inside a branch that joins with the outer block at the same node', () => {
    const g = graph(
      [trigger('t'), cond('outer'), cond('inner'), act('x'), act('y'), act('z'), act('k')],
      [
        edge('t', 'outer'),
        edge('outer', 'inner', 'true'),
        edge('inner', 'x', 'true'),
        edge('inner', 'y', 'false'),
        edge('x', 'k'),
        edge('y', 'k'),
        edge('outer', 'z', 'false'),
        edge('z', 'k'),
      ]
    );
    expect(analyzeTopology(g).recommendedStrategy).toBe('native');
  });
});

describe('crossing paths stay on the state machine', () => {
  it('an edge from inside one branch into the other branch is not a nested block', () => {
    const g = graph(
      [trigger('t'), cond('c'), act('a1'), act('a2'), act('b1'), act('end')],
      [
        edge('t', 'c'),
        edge('c', 'a1', 'true'),
        edge('c', 'b1', 'false'),
        edge('a1', 'a2'),
        edge('a1', 'b1'), // crosses into the else branch
        edge('a2', 'end'),
        edge('b1', 'end'),
      ]
    );
    const postDominators = computePostDominators(g);
    expect(isStructuredFlow(g, new Set(), postDominators)).toBe(false);
    expect(analyzeTopology(g).recommendedStrategy).toBe('state-machine');
  });
});
