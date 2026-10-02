// @vitest-environment node
//
// Step structure: what the parser writes into the graph (hints), how the generator reads them,
// and what happens when the graph is edited on the canvas. The corpus test proves that every
// fixture comes back unchanged; these tests cover what a round trip alone cannot show.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERNAL_NODE_KEYS } from '@flow/shared';
import { glob } from 'glob';
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { isJson, roundTripConfig } from '../semantic';

const FIXTURES_DIR = join(__dirname, '../../../../__tests__/ha-roundtrip-fixtures/automations');
const transpiler = new FlowTranspiler();

const HEADER = `
alias: structure test
triggers:
  - trigger: state
    entity_id: binary_sensor.door
    to: "on"
`;

type Step = Record<string, unknown>;

async function open(actions: string) {
  const parsed = await transpiler.fromYaml(`${HEADER}actions:\n${actions}\nmode: single\n`);
  if (!parsed.graph) throw new Error(`did not open: ${parsed.errors?.join('; ')}`);
  return parsed.graph;
}

function save(graph: Awaited<ReturnType<typeof open>>): Step[] {
  const saved = yamlLoad(transpiler.toYaml(graph)) as { actions: Step[] };
  return saved.actions;
}

function actionByService(graph: Awaited<ReturnType<typeof open>>, service: string) {
  const node = graph.nodes.find((n) => n.type === 'action' && n.data.service === service);
  if (!node) throw new Error(`no node for ${service}`);
  return node;
}

describe('hints stay inside the graph', () => {
  const files = glob.sync('**/*.yaml', { cwd: FIXTURES_DIR }).sort();

  it('never reach the saved YAML, and every fixture that opens is saved natively', async () => {
    for (const file of files) {
      const original = yamlLoad(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
      if (!isJson(original)) continue;
      const parsed = await transpiler.fromYaml(JSON.stringify(original));
      if (!parsed.graph) continue;
      const result = transpiler.transpile(parsed.graph);
      expect(result.output?.strategy, file).toBe('native');
      const keys = INTERNAL_NODE_KEYS.filter((key) =>
        new RegExp(`^\\s*-?\\s*${key}:`, 'm').test(result.yaml ?? '')
      );
      expect(keys, `${file} leaked hint keys`).toEqual([]);
    }
  }, 120_000);
});

describe('edited graphs still save valid, behavior-correct YAML', () => {
  const CHOOSE = `
  - choose:
      - conditions:
          - condition: state
            entity_id: input_boolean.a
            state: "on"
        sequence:
          - action: light.turn_on
            target: { entity_id: light.a }
      - conditions:
          - condition: state
            entity_id: input_boolean.b
            state: "on"
        sequence:
          - action: light.turn_off
            target: { entity_id: light.b }
    default:
      - action: notify.nobody
  - action: persistent_notification.create
`;

  it('a step added at the end of a choose branch lands in that branch', async () => {
    const graph = await open(CHOOSE);
    const last = actionByService(graph, 'light.turn_on');
    graph.nodes.push({
      id: 'added',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { service: 'switch.turn_on', target: { entity_id: 'switch.new' } },
    });
    // Insert the step between the branch's last step and whatever followed it.
    for (const edge of graph.edges) {
      if (edge.source === last.id) {
        graph.edges.push({ id: 'e-after-added', source: 'added', target: edge.target });
        edge.target = 'added';
      }
    }

    const [choose, after] = save(graph) as [Step & { choose: Step[]; default: Step[] }, Step];
    expect(choose.choose).toHaveLength(2);
    expect((choose.choose[0].sequence as Step[]).map((s) => s.action)).toEqual([
      'light.turn_on',
      'switch.turn_on',
    ]);
    expect((choose.choose[1].sequence as Step[]).map((s) => s.action)).toEqual(['light.turn_off']);
    expect(choose.default).toHaveLength(1);
    expect(after.action).toBe('persistent_notification.create');
  });

  it('deleting an inline condition lets the steps around it run in a row', async () => {
    const graph = await open(`
  - action: light.turn_on
  - condition: state
    entity_id: input_boolean.gate
    state: "on"
  - action: light.turn_off
`);
    const gate = graph.nodes.find((n) => n.type === 'condition');
    const first = actionByService(graph, 'light.turn_on');
    const second = actionByService(graph, 'light.turn_off');
    if (!gate) throw new Error('no gate');
    graph.nodes = graph.nodes.filter((n) => n.id !== gate.id);
    graph.edges = graph.edges.filter((e) => e.source !== gate.id && e.target !== gate.id);
    graph.edges.push({ id: 'e-rejoin', source: first.id, target: second.id });

    expect(save(graph).map((s) => s.action)).toEqual(['light.turn_on', 'light.turn_off']);
  });

  it('dropping or adding a branch of a parallel block changes the block, nothing else', async () => {
    const graph = await open(`
  - parallel:
      - action: light.turn_on
      - action: light.turn_off
  - action: persistent_notification.create
`);
    const trigger = graph.nodes.find((n) => n.type === 'trigger');
    if (!trigger) throw new Error('no trigger');
    graph.nodes.push({
      id: 'third',
      type: 'action',
      position: { x: 0, y: 0 },
      data: { service: 'switch.toggle' },
    });
    graph.edges.push({ id: 'e-third', source: trigger.id, target: 'third' });
    graph.edges.push({
      id: 'e-third-after',
      source: 'third',
      target: actionByService(graph, 'persistent_notification.create').id,
    });

    const [block, after] = save(graph) as [{ parallel: Step[] }, Step];
    expect(block.parallel.map((b) => b.action)).toEqual([
      'light.turn_on',
      'light.turn_off',
      'switch.toggle',
    ]);
    expect(after.action).toBe('persistent_notification.create');

    const off = actionByService(graph, 'light.turn_off');
    graph.nodes = graph.nodes.filter((n) => n.id !== off.id);
    graph.edges = graph.edges.filter((e) => e.source !== off.id && e.target !== off.id);
    const [reduced] = save(graph) as [{ parallel: Step[] }];
    expect(reduced.parallel.map((b) => b.action)).toEqual(['light.turn_on', 'switch.toggle']);
  });

  it('a hint that no longer fits the graph is ignored', async () => {
    // An `if` with an else is not an inline condition, whatever a stale hint says.
    const graph = await open(`
  - if:
      - condition: state
        entity_id: input_boolean.a
        state: "on"
    then:
      - action: light.turn_on
    else:
      - action: light.turn_off
`);
    const condition = graph.nodes.find((n) => n.type === 'condition');
    if (!condition) throw new Error('no condition');
    Object.assign(condition.data, { gateStep: true });

    const [step] = save(graph);
    expect(step.if).toBeDefined();
    expect(step.else).toBeDefined();
  });
});

describe('automations that end the run in odd places', () => {
  const cases: Record<string, string> = {
    'an if with nothing in it, then a stop': `
actions:
  - if:
      - condition: state
        entity_id: input_boolean.a
        state: "on"
    then: []
  - stop: done
`,
    'steps after a block whose branches all stop': `
actions:
  - if:
      - condition: state
        entity_id: input_boolean.a
        state: "on"
    then:
      - stop: one
    else:
      - stop: two
  - action: light.turn_on
`,
    'a condition as the very last step': `
actions:
  - action: light.turn_on
  - condition: state
    entity_id: input_boolean.a
    state: "on"
`,
    'a loop whose body always stops': `
actions:
  - repeat:
      until:
        - condition: state
          entity_id: input_boolean.a
          state: "on"
      sequence:
        - action: light.turn_on
        - stop: never loops
`,
  };

  for (const [name, actions] of Object.entries(cases)) {
    it(`${name} keeps its shape`, async () => {
      const config = yamlLoad(`${HEADER}${actions}\nmode: single\n`);
      if (!isJson(config)) throw new Error('not json');
      const result = await roundTripConfig(transpiler, config, { strict: true });
      expect(result.errors).toEqual([]);
      expect(result.diffs).toEqual([]);
    });
  }
});

describe('steps Flow has no node for', () => {
  it('are saved exactly as written, and an edited alias still wins', async () => {
    const graph = await open(`
  - alias: Movie time
    scene: scene.movie_night
  - alias: Group
    sequence:
      - action: light.turn_on
`);
    expect(save(graph)).toEqual([
      { alias: 'Movie time', scene: 'scene.movie_night' },
      { alias: 'Group', sequence: [{ action: 'light.turn_on' }] },
    ]);

    const scene = graph.nodes.find((n) => n.type === 'action' && n.data.alias === 'Movie time');
    if (!scene) throw new Error('no scene node');
    scene.data.alias = 'Renamed';
    expect(save(graph)[0]).toEqual({ alias: 'Renamed', scene: 'scene.movie_night' });
  });
});
