// @vitest-environment node
//
// `stop` ends the run, so nothing after it in the same branch can happen. The
// flow graph must say so (no edge leaves a stop node), otherwise an
// `if ... then: [..., stop]` guard followed by more steps looks like a tangle
// of crossing paths and falls back to the lossy state-machine strategy.
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';

const transpiler = new FlowTranspiler();

type Step = Record<string, unknown>;

async function roundTrip(yaml: string): Promise<{ actions: Step[]; out: Record<string, unknown> }> {
  const parsed = await transpiler.fromYaml(yaml);
  expect(parsed.errors ?? []).toEqual([]);
  if (!parsed.graph) throw new Error('did not parse');
  const analysis = transpiler.analyzeTopology(parsed.graph);
  expect(analysis.recommendedStrategy).toBe('native');
  const out = yamlLoad(transpiler.toYaml(parsed.graph)) as Record<string, unknown>;
  return { actions: out.actions as Step[], out };
}

const HEADER = `
alias: guard test
triggers:
  - trigger: time_pattern
    minutes: /5
`;

describe('stop is terminal in the flow graph', () => {
  it('no edge leaves a stop node', async () => {
    const parsed = await transpiler.fromYaml(`${HEADER}
actions:
  - alias: bail out
    if:
      - condition: state
        entity_id: light.a
        state: "on"
    then:
      - stop: done
  - action: light.turn_on
    target:
      entity_id: light.b
`);
    const graph = parsed.graph;
    if (!graph) throw new Error('did not parse');
    const stopNode = graph.nodes.find((n) => 'stop' in n.data);
    expect(stopNode).toBeDefined();
    expect(graph.edges.filter((e) => e.source === stopNode?.id)).toEqual([]);
  });
});

describe('guard clause (then ends in stop)', () => {
  it('keeps the steps after the guard as siblings instead of nesting them in else', async () => {
    const { actions } = await roundTrip(`${HEADER}
actions:
  - alias: bail out when already on
    if:
      - condition: state
        entity_id: light.a
        state: "on"
    then:
      - action: persistent_notification.create
        data:
          message: already on
      - stop: nothing to do
  - alias: turn b on
    action: light.turn_on
    target:
      entity_id: light.b
  - alias: turn c on
    action: light.turn_on
    target:
      entity_id: light.c
`);

    expect(actions).toHaveLength(3);
    expect(actions[0].alias).toBe('bail out when already on');
    expect(actions[0].else).toBeUndefined();
    const thenSteps = actions[0].then as Step[];
    expect(thenSteps.at(-1)).toMatchObject({ stop: 'nothing to do' });
    expect(actions[1].alias).toBe('turn b on');
    expect(actions[2].alias).toBe('turn c on');
  });

  it('a guard nested in a guard still closes each block where it opened', async () => {
    const { actions } = await roundTrip(`${HEADER}
actions:
  - alias: outer guard
    if:
      - condition: state
        entity_id: input_boolean.rail
        state: "off"
    then:
      - alias: inner notice
        if:
          - condition: template
            value_template: "{{ not is_recheck }}"
        then:
          - action: notify.example
            data:
              message: held back
      - stop: held back by a rail
  - alias: after both guards
    action: light.turn_on
    target:
      entity_id: light.b
`);

    expect(actions).toHaveLength(2);
    const outerThen = actions[0].then as Step[];
    // inner `if` has no else and is followed by the stop, inside the outer then
    expect(outerThen).toHaveLength(2);
    expect(outerThen[0].alias).toBe('inner notice');
    expect(outerThen[0].else).toBeUndefined();
    expect(outerThen[1]).toMatchObject({ stop: 'held back by a rail' });
    expect(actions[1].alias).toBe('after both guards');
  });

  it('keeps root conditions, wait timeout and continue_on_timeout (stays native)', async () => {
    const { actions, out } = await roundTrip(`${HEADER}
conditions:
  - alias: only while the bridge is down
    condition: state
    entity_id: binary_sensor.bridge
    state: "off"
actions:
  - alias: give up after two hours
    if:
      - condition: template
        value_template: "{{ true }}"
    then:
      - action: persistent_notification.create
        data:
          message: gave up
      - stop: too long
  - alias: wait for the coordinator (up to 30 min)
    wait_template: "{{ states('sensor.t') != 'unavailable' }}"
    timeout:
      minutes: 30
    continue_on_timeout: true
  - action: light.turn_on
    target:
      entity_id: light.b
`);

    expect(out.conditions).toEqual([
      {
        condition: 'state',
        entity_id: 'binary_sensor.bridge',
        state: 'off',
        alias: 'only while the bridge is down',
      },
    ]);
    expect(actions[1]).toMatchObject({
      wait_template: "{{ states('sensor.t') != 'unavailable' }}",
      timeout: { minutes: 30 },
      continue_on_timeout: true,
    });
  });
});

describe('stop elsewhere', () => {
  it('a branch of an if/else that stops does not feed the step that follows the block', async () => {
    const { actions } = await roundTrip(`${HEADER}
actions:
  - if:
      - condition: state
        entity_id: light.a
        state: "on"
    then:
      - action: light.turn_off
        target:
          entity_id: light.a
    else:
      - stop: already off
  - alias: only reached through the then-branch
    action: light.turn_on
    target:
      entity_id: light.b
`);

    // The only path to the last step is through `then`, so it may live inside
    // it or follow the block, but it must never be reachable from the stopping else.
    const flat = JSON.stringify(actions);
    expect(flat).toContain('only reached through the then-branch');
    const first = actions[0];
    const elseSteps = (first.else ?? []) as Step[];
    expect(elseSteps.map((s) => s.stop)).toEqual(['already off']);
  });

  it('keeps response_variable on a stop', async () => {
    const { actions } = await roundTrip(`
alias: script-like
triggers:
  - trigger: time_pattern
    minutes: /5
actions:
  - stop: all done
    response_variable: result
`);
    expect(actions[0]).toMatchObject({ stop: 'all done', response_variable: 'result' });
  });

  it('a disabled stop does not end the branch', async () => {
    const parsed = await transpiler.fromYaml(`${HEADER}
actions:
  - stop: never runs
    enabled: false
  - action: light.turn_on
    target:
      entity_id: light.b
`);
    const graph = parsed.graph;
    if (!graph) throw new Error('did not parse');
    const stopNode = graph.nodes.find((n) => 'stop' in n.data);
    expect(graph.edges.some((e) => e.source === stopNode?.id)).toBe(true);
  });

  it('a choose branch that stops does not feed the steps after the choose', async () => {
    const parsed = await transpiler.fromYaml(`${HEADER}
actions:
  - choose:
      - conditions:
          - condition: state
            entity_id: light.a
            state: "on"
        sequence:
          - stop: stays on
    default:
      - action: light.turn_on
        target:
          entity_id: light.a
  - action: notify.example
    data:
      message: reached
`);
    const graph = parsed.graph;
    if (!graph) throw new Error('did not parse');
    const stopNode = graph.nodes.find((n) => 'stop' in n.data);
    expect(graph.edges.filter((e) => e.source === stopNode?.id)).toEqual([]);
    const notify = graph.nodes.find(
      (n) => n.type === 'action' && n.data.service === 'notify.example'
    );
    const incoming = graph.edges.filter((e) => e.target === notify?.id).map((e) => e.source);
    expect(incoming).not.toContain(stopNode?.id);
    expect(incoming.length).toBeGreaterThan(0);
  });
});
