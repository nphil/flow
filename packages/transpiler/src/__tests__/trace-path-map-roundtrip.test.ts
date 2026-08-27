import type { FlowGraph } from '@flow/shared';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';
import { resolveTracePath } from '../utils/tracePathMap';

// trigger -> root condition (single true edge, promotable to root `conditions:`
// by the native strategy) -> if-condition -> then(delay, action) / else(action)
const graph: FlowGraph = {
  id: '9b1f6a2e-2222-4a5b-9c3d-1a2b3c4d5e6f',
  version: 1,
  name: 'Trace Path Roundtrip',
  description: '',
  nodes: [
    {
      id: 'trigger_1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { trigger: 'state', entity_id: 'binary_sensor.motion', to: 'on' },
    },
    {
      id: 'cond_root',
      type: 'condition',
      position: { x: 200, y: 0 },
      data: { condition: 'state', entity_id: 'input_boolean.armed', state: 'on' },
    },
    {
      id: 'cond_if',
      type: 'condition',
      position: { x: 400, y: 0 },
      data: { condition: 'state', entity_id: 'light.living_room', state: 'off' },
    },
    {
      id: 'delay_1',
      type: 'delay',
      position: { x: 600, y: -100 },
      data: { delay: '00:00:05' },
    },
    {
      id: 'action_then',
      type: 'action',
      position: { x: 800, y: -100 },
      data: { service: 'light.turn_on', target: { entity_id: 'light.living_room' } },
    },
    {
      id: 'action_else',
      type: 'action',
      position: { x: 600, y: 100 },
      data: { service: 'notify.mobile_app', data: { message: 'Already on' } },
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger_1', target: 'cond_root' },
    { id: 'e2', source: 'cond_root', target: 'cond_if', sourceHandle: 'true' },
    { id: 'e3', source: 'cond_if', target: 'delay_1', sourceHandle: 'true' },
    { id: 'e4', source: 'cond_if', target: 'action_else', sourceHandle: 'false' },
    { id: 'e5', source: 'delay_1', target: 'action_then' },
  ],
  metadata: { mode: 'single', initial_state: true },
};

describe('nodePathMap roundtrip — native strategy', () => {
  it('restores original node ids via metadata and maps every trace path to them', async () => {
    const transpiler = new FlowTranspiler();
    const parser = new YamlParser();

    const transpileResult = transpiler.transpile(graph, { forceStrategy: 'native' });
    expect(transpileResult.success).toBe(true);
    expect(transpileResult.output?.strategy).toBe('native');

    const parseResult = await parser.parse(transpileResult.yaml!);
    expect(parseResult.success).toBe(true);
    expect(parseResult.hadMetadata).toBe(true);
    expect(parseResult.nodePathMap).toBeDefined();

    const reparsedGraph = parseResult.graph!;
    const map = parseResult.nodePathMap!;

    // Metadata restoration round-trips every node id exactly.
    expect(new Set(reparsedGraph.nodes.map((n) => n.id))).toEqual(
      new Set(graph.nodes.map((n) => n.id))
    );

    expect(map.pathToNode).toEqual({
      'trigger/0': 'trigger_1',
      'condition/0': 'cond_root',
      'action/0': 'cond_if',
      'action/0/if/condition/0': 'cond_if',
      'action/0/then/0': 'delay_1',
      'action/0/then/1': 'action_then',
      'action/0/else/0': 'action_else',
    });

    expect(resolveTracePath(map, 'action/0')).toBe('cond_if');
    expect(resolveTracePath(map, 'action/0/then/0')).toBe('delay_1');
  });
});

describe('nodePathMap roundtrip — state-machine strategy', () => {
  it('embeds original node ids directly and maps every dispatcher branch to them', async () => {
    const transpiler = new FlowTranspiler();
    const parser = new YamlParser();

    const transpileResult = transpiler.transpile(graph, { forceStrategy: 'state-machine' });
    expect(transpileResult.success).toBe(true);
    expect(transpileResult.output?.strategy).toBe('state-machine');

    const parseResult = await parser.parse(transpileResult.yaml!);
    expect(parseResult.success).toBe(true);
    expect(parseResult.nodePathMap).toBeDefined();

    const reparsedGraph = parseResult.graph!;
    const map = parseResult.nodePathMap!;

    // State-machine format embeds each node's own id directly in the YAML
    // text (`current_node == "<id>"`), so ids round-trip even without
    // relying on metadata restoration.
    expect(new Set(reparsedGraph.nodes.map((n) => n.id))).toEqual(
      new Set(graph.nodes.map((n) => n.id))
    );

    // Every non-trigger node becomes its own dispatcher choose-block entry;
    // branch order follows the original flow.nodes order (minus the trigger).
    const nonTriggerIds = graph.nodes.filter((n) => n.type !== 'trigger').map((n) => n.id);
    const branchOf = (nodeId: string): number => nonTriggerIds.indexOf(nodeId);

    for (const nodeId of nonTriggerIds) {
      const basePath = `action/1/repeat/sequence/0/choose/${branchOf(nodeId)}`;
      expect(map.pathToNode[`${basePath}/conditions/0`]).toBe(nodeId);
      expect(map.pathToNode[`${basePath}/sequence/0`]).toBe(nodeId);
      // The branch's own bare path isn't recorded directly, but resolves
      // unambiguously since every path nested under it agrees on the node id.
      expect(resolveTracePath(map, basePath)).toBe(nodeId);
    }

    expect(map.pathToNode['trigger/0']).toBe('trigger_1');
  });
});

describe('nodePathMap roundtrip — state-machine strategy, trigger with parallel targets', () => {
  // A trigger with more than one outgoing edge forces the state-machine
  // strategy to synthesize a `__parallel_trigger_*` dispatcher branch that
  // inlines both targets — the deepest path-recording case, since node ids
  // are recovered from `cafe_node:` aliases nested inside `parallel:`. A
  // second, single-target trigger is included so the generated entry-node
  // expression is a `trigger.idx` Jinja routing template rather than a bare
  // node id — the code path that actually expands the synthetic entry back
  // into direct edges (a bare single-trigger `__parallel_trigger_*` id hits
  // a pre-existing, unrelated parser bug that also reproduces against the
  // pristine, unmodified YamlParser.ts and is out of scope here).
  const parallelGraph: FlowGraph = {
    id: '1c2d3e4f-5566-4a5b-9c3d-1a2b3c4d5e6f',
    version: 1,
    name: 'Parallel Trigger Roundtrip',
    description: '',
    nodes: [
      {
        id: 'trigger_1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: { trigger: 'state', entity_id: 'binary_sensor.motion', to: 'on' },
      },
      {
        id: 'action_fan',
        type: 'action',
        position: { x: 200, y: -50 },
        data: { service: 'switch.turn_on', target: { entity_id: 'switch.fan' } },
      },
      {
        id: 'action_humidifier',
        type: 'action',
        position: { x: 200, y: 50 },
        data: { service: 'switch.turn_on', target: { entity_id: 'switch.humidifier' } },
      },
      {
        id: 'trigger_2',
        type: 'trigger',
        position: { x: 0, y: 200 },
        data: { trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' },
      },
      {
        id: 'action_other',
        type: 'action',
        position: { x: 200, y: 200 },
        data: { service: 'light.turn_off', target: { entity_id: 'light.other' } },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger_1', target: 'action_fan' },
      { id: 'e2', source: 'trigger_1', target: 'action_humidifier' },
      { id: 'e3', source: 'trigger_2', target: 'action_other' },
    ],
    metadata: { mode: 'single', initial_state: true },
  };

  it('maps both inlined parallel branch targets to their original node ids', async () => {
    const transpiler = new FlowTranspiler();
    const parser = new YamlParser();

    const transpileResult = transpiler.transpile(parallelGraph, { forceStrategy: 'state-machine' });
    expect(transpileResult.success).toBe(true);
    expect(transpileResult.yaml).toContain('__parallel_trigger_0');
    expect(transpileResult.yaml).toContain('trigger.idx');

    const parseResult = await parser.parse(transpileResult.yaml!);
    expect(parseResult.success).toBe(true);
    expect(parseResult.errors ?? []).toHaveLength(0);

    const reparsedGraph = parseResult.graph!;
    const map = parseResult.nodePathMap!;

    expect(new Set(reparsedGraph.nodes.map((n) => n.id))).toEqual(
      new Set(parallelGraph.nodes.map((n) => n.id))
    );

    expect(map.pathToNode['trigger/0']).toBe('trigger_1');
    expect(map.pathToNode['trigger/1']).toBe('trigger_2');

    const parallelBase = 'action/1/repeat/sequence/0/choose/0/sequence/0/parallel';
    expect(map.pathToNode[`${parallelBase}/0/sequence/0`]).toBe('action_fan');
    expect(map.pathToNode[`${parallelBase}/1/sequence/0`]).toBe('action_humidifier');
    expect(resolveTracePath(map, `${parallelBase}/0/sequence/0`)).toBe('action_fan');
    expect(resolveTracePath(map, `${parallelBase}/1/sequence/0`)).toBe('action_humidifier');

    // action_other is a normal (non-parallel) dispatcher branch alongside the
    // synthetic parallel entry.
    expect(map.pathToNode['action/1/repeat/sequence/0/choose/1/conditions/0']).toBe('action_other');
    expect(map.pathToNode['action/1/repeat/sequence/0/choose/1/sequence/0']).toBe('action_other');
  });
});
