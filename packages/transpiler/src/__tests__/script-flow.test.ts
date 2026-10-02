// @vitest-environment node
//
// Scripts: a Home Assistant script has no triggers (it starts when it is called), keeps its steps
// under `sequence`, and carries its own settings (icon, fields, variables). The corpus test proves
// every fixture script survives open -> save; these tests cover what a corpus cannot: what the
// graph looks like, canvas positions, trace paths, graphs drawn by hand and the checks around them.
import type { FlowEdge, FlowGraph, FlowNode } from '@flow/shared';
import { detectFlowKind } from '@flow/shared';
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { type Json, roundTripConfig } from '../semantic';
import { resolveTracePath } from '../utils/tracePathMap';

const transpiler = new FlowTranspiler();

async function openScript(yaml: string): Promise<FlowGraph> {
  const parsed = await transpiler.fromYaml(yaml, { kind: 'script' });
  if (!parsed.success || !parsed.graph) throw new Error(parsed.errors?.join('\n'));
  return parsed.graph;
}

function save(graph: FlowGraph): Record<string, unknown> {
  const result = transpiler.transpile(graph);
  if (!result.success || !result.config) throw new Error(result.errors?.join('\n'));
  return result.config;
}

/** A graph the way the canvas builds it: no parser hints, ids of its own. */
function drawn(nodes: FlowNode[], edges: FlowEdge[]): FlowGraph {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Drawn script',
    kind: 'script',
    nodes,
    edges,
    version: 1,
  };
}

const action = (id: string, service: string, x = 0): FlowNode => ({
  id,
  type: 'action',
  position: { x, y: 0 },
  data: { service, target: { entity_id: 'light.hall' } },
});

const stateCondition = (id: string): FlowNode => ({
  id,
  type: 'condition',
  position: { x: 0, y: 0 },
  data: { condition: 'state', entity_id: 'input_boolean.guest_mode', state: 'on' },
});

const edge = (source: string, target: string, sourceHandle?: 'true' | 'false'): FlowEdge => ({
  id: `${source}->${target}:${sourceHandle ?? ''}`,
  source,
  target,
  sourceHandle,
});

describe('opening a script', () => {
  const yaml = `
alias: Wake the house
icon: mdi:weather-sunny
mode: queued
max: 3
fields:
  room:
    name: Room
    selector:
      text: {}
variables:
  greeting: hello
sequence:
  - action: light.turn_on
    target:
      entity_id: light.hall
`;

  it('has no trigger and keeps the script settings on the graph', async () => {
    const graph = await openScript(yaml);

    expect(graph.kind).toBe('script');
    expect(graph.nodes.map((node) => node.type)).toEqual(['action']);
    expect(graph.metadata).toMatchObject({
      mode: 'queued',
      max: 3,
      icon: 'mdi:weather-sunny',
      fields: { room: { name: 'Room', selector: { text: {} } } },
    });
    expect(graph.userVariables).toEqual({ greeting: 'hello' });
  });

  it('is saved as a script: sequence instead of triggers/actions, variables above the steps', async () => {
    const config = save(await openScript(yaml));

    expect(Object.keys(config)).toEqual([
      'alias',
      'icon',
      'mode',
      'max',
      'fields',
      'variables',
      'sequence',
    ]);
    expect(config.variables).toMatchObject({ greeting: 'hello' });
    expect(config.variables).toHaveProperty('_cafe_metadata');
  });

  it('keeps the shape alone from deciding a config made from a blueprint', () => {
    const useBlueprint = { path: 'a/b.yaml', input: {} };
    expect(detectFlowKind({ sequence: [] })).toBe('script');
    expect(detectFlowKind({ sequence: [], actions: [] })).toBe('automation');
    expect(detectFlowKind({ alias: 'x', use_blueprint: useBlueprint })).toBe('automation');
  });

  it('writes no description for a script that has none', async () => {
    const config = save(await openScript('sequence:\n  - delay: 5\n'));
    expect(config).not.toHaveProperty('description');
  });
});

describe('where a script step is on the canvas and in a trace', () => {
  const yaml = `
alias: Positions
sequence:
  - alias: first
    action: notify.a
  - choose:
      - conditions:
          - condition: state
            entity_id: input_boolean.x
            state: "on"
        sequence:
          - alias: second
            action: notify.b
    default:
      - alias: third
        action: notify.c
  - alias: fourth
    action: notify.d
`;

  const positionsByAlias = (graph: FlowGraph) =>
    Object.fromEntries(
      graph.nodes.flatMap((node) =>
        typeof node.data.alias === 'string' ? [[node.data.alias, node.position]] : []
      )
    );

  it('brings every node back to the place it was dragged to', async () => {
    const graph = await openScript(yaml);
    graph.nodes.forEach((node, index) => {
      node.position = { x: 100 * (index + 1), y: 7 * (index + 1) };
    });
    const dragged = positionsByAlias(graph);

    const reopened = await openScript(
      transpiler.toYaml(graph)
    );

    expect(positionsByAlias(reopened)).toEqual(dragged);
  });

  it('maps the paths Home Assistant traces (sequence/N/...) to the steps', async () => {
    const parsed = await transpiler.fromYaml(yaml, { kind: 'script' });
    const graph = parsed.graph;
    const map = parsed.nodePathMap;
    if (!graph || !map) throw new Error('did not open');
    const aliasOf = (path: string) => {
      const id = resolveTracePath(map, path);
      return graph.nodes.find((node) => node.id === id)?.data.alias;
    };

    expect(aliasOf('sequence/0')).toBe('first');
    expect(aliasOf('sequence/1/choose/0/sequence/0')).toBe('second');
    expect(aliasOf('sequence/1/default/0')).toBe('third');
    expect(aliasOf('sequence/2')).toBe('fourth');
    // An automation's `action/...` paths mean nothing in a script.
    expect(map.pathToNode['action/0']).toBeUndefined();
  });
});

describe('a script drawn on the canvas', () => {
  it('starts with a condition written as a condition step, not an if around everything', () => {
    const graph = drawn(
      [stateCondition('condition_a'), action('action_a', 'light.turn_on')],
      [edge('condition_a', 'action_a', 'true')]
    );

    const config = save(graph);

    expect(config.sequence).toEqual([
      { condition: 'state', entity_id: 'input_boolean.guest_mode', state: 'on' },
      { action: 'light.turn_on', target: { entity_id: 'light.hall' } },
    ]);
  });

  it('branches with an if/else', () => {
    const graph = drawn(
      [
        action('action_a', 'light.turn_on'),
        stateCondition('condition_a'),
        action('action_b', 'light.turn_off'),
        action('action_c', 'light.toggle'),
      ],
      [
        edge('action_a', 'condition_a'),
        edge('condition_a', 'action_b', 'true'),
        edge('condition_a', 'action_c', 'false'),
      ]
    );

    const sequence = save(graph).sequence;

    expect(sequence).toEqual([
      { action: 'light.turn_on', target: { entity_id: 'light.hall' } },
      {
        if: [{ condition: 'state', entity_id: 'input_boolean.guest_mode', state: 'on' }],
        then: [{ action: 'light.turn_off', target: { entity_id: 'light.hall' } }],
        else: [{ action: 'light.toggle', target: { entity_id: 'light.hall' } }],
      },
    ]);
  });

  it('starts everything nothing leads to together, as a parallel block', () => {
    const graph = drawn(
      [action('action_a', 'light.turn_on'), action('action_b', 'fan.turn_on')],
      []
    );

    expect(save(graph).sequence).toEqual([
      {
        parallel: [
          { action: 'light.turn_on', target: { entity_id: 'light.hall' } },
          { action: 'fan.turn_on', target: { entity_id: 'light.hall' } },
        ],
      },
    ]);
  });

  it('is written as a state machine when its steps loop back, and opens again as a script', async () => {
    const graph = drawn(
      [action('action_a', 'light.turn_on'), action('action_b', 'light.turn_off')],
      [edge('action_a', 'action_b'), edge('action_b', 'action_a')]
    );

    const result = transpiler.transpile(graph);
    const config = result.config ?? {};

    expect(result.output?.strategy).toBe('state-machine');
    expect(config).toHaveProperty('sequence');
    expect(config).not.toHaveProperty('actions');
    expect(config).not.toHaveProperty('triggers');

    const reopened = await openScript(result.yaml ?? '');
    expect(reopened.kind).toBe('script');
    expect(reopened.nodes.map((node) => node.id).sort()).toEqual(['action_a', 'action_b']);
    expect(reopened.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'action_a->action_b',
      'action_b->action_a',
    ]);
  });
});

describe('what a script and an automation each need', () => {
  const trigger: FlowNode = {
    id: 'trigger_a',
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: { trigger: 'state', entity_id: 'light.hall' },
  };

  it('refuses a script that has a trigger', () => {
    const graph = drawn([trigger, action('action_a', 'light.turn_on')], [edge('trigger_a', 'action_a')]);

    const result = transpiler.validate(graph);

    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message)).toContain(
      'A script has no triggers: it starts when it is called'
    );
  });

  it('still refuses an automation without a trigger', () => {
    const graph: FlowGraph = { ...drawn([action('action_a', 'light.turn_on')], []), kind: 'automation' };

    const result = transpiler.validate(graph);

    expect(result.errors.map((e) => e.message)).toContain('Graph must have at least one trigger node');
  });

  it('does not take a half-written use_blueprint for a blueprint instance', async () => {
    const parsed = await transpiler.fromYaml('alias: x\nuse_blueprint: {}\n');

    expect(parsed.success).toBe(false);
  });
});

describe('what is stored for an automation', () => {
  it('keeps the root variables and trigger variables the user wrote', async () => {
    const parsed = await transpiler.fromYaml(`
alias: With variables
trigger_variables:
  limit: 3
variables:
  who: Alex
  greeting: "Hello {{ who }}"
triggers:
  - trigger: state
    entity_id: light.hall
actions:
  - action: notify.x
    data:
      message: "{{ greeting }}"
`);
    if (!parsed.graph) throw new Error(parsed.errors?.join('\n'));

    const { config } = transpiler.transpile(parsed.graph);

    expect(config?.variables).toMatchObject({ who: 'Alex', greeting: 'Hello {{ who }}' });
    expect(config?.variables).toHaveProperty('_cafe_metadata');
    expect(config?.trigger_variables).toEqual({ limit: 3 });
    // What the strategy generated is not what gets stored: it does not carry the variables.
    expect(yamlLoad(transpiler.toYaml(parsed.graph))).toEqual(config);
  });
});

describe('an if with no else, followed by a parallel block', () => {
  // The usual "refuse bad input, then do several things at once". The parallel block opens with
  // one node per branch, all hanging off the if's false handle: they are what runs AFTER the if,
  // not an else (an else would make the later steps run only when the guard passes, and move them).
  const steps = `
  - alias: guard
    if:
      - condition: template
        value_template: "{{ room is not defined }}"
    then:
      - stop: Choose a room.
        error: true
  - parallel:
      - action: notify.a
      - action: notify.b
  - delay:
      seconds: 5
  - action: notify.c
`;

  it.each([
    ['script', `alias: G\nsequence:${steps}`],
    [
      'automation',
      `alias: G\ntriggers:\n  - trigger: state\n    entity_id: light.a\nactions:${steps}`,
    ],
  ] as const)('is saved as it was written (%s)', async (kind, yaml) => {
    const result = await roundTripConfig(transpiler, yamlLoad(yaml) as Json, { kind, strict: true });

    expect(result.diffs).toEqual([]);
    expect(result.status).toBe('ok');
  });
});

describe('a script that starts with a parallel block', () => {
  it('keeps the block alias and note, which the branches carry', async () => {
    const config = yamlLoad(`
alias: Release links
sequence:
  - alias: Release every link
    note: Each one is isolated from the others.
    parallel:
      - action: notify.a
      - action: notify.b
  - delay:
      seconds: 5
`) as Json;

    const result = await roundTripConfig(transpiler, config, { kind: 'script', strict: true });

    expect(result.status).toBe('ok');
    expect(result.lostAliases).toEqual([]);
    expect(result.lostNotes).toEqual([]);
  });
});
