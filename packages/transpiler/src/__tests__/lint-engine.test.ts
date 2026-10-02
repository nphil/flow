// The engine around the rules: ordering, the data-driven rule list, and "fix all safe".
import { describe, expect, it } from 'vitest';
import {
  applySafeFixes,
  firstSafeFix,
  lintFlowGraph,
  READABILITY_RULES,
  type ReadabilityRule,
} from '../lint';
import {
  conditionNode,
  dataOf,
  deepFreeze,
  graphOf,
  lightAction,
  node,
  stateTriggerGraph,
} from './lint-test-utils';

describe('lintFlowGraph', () => {
  it('lists warnings before suggestions, then follows the canvas order', () => {
    const graph = graphOf(
      [
        node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'light.a', to: 'on' }),
        conditionNode({ condition: 'template', value_template: "{{ is_state('light.b', 'on') }}" }),
        node('action', 'action_1', { service: 'light.turn_on', target: { device_id: 'abc123' } }),
      ],
      { description: '' }
    );

    expect(lintFlowGraph(graph).map((f) => `${f.severity} ${f.ruleId} ${f.nodeId ?? '-'}`)).toEqual(
      [
        'warning unavailable-restore trigger_1',
        'warning device-id action_1',
        'info missing-alias trigger_1',
        'info template-native condition_1',
        'info missing-alias action_1',
        'info missing-description -',
      ]
    );
  });

  it('gives every finding a different id', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'light.a', to: 'on' }),
      node('trigger', 'trigger_2', { trigger: 'state', entity_id: 'light.a', to: 'off' }),
      conditionNode({
        condition: 'and',
        conditions: [
          { condition: 'template', value_template: "{{ is_state('a.b', 'on') }}" },
          { condition: 'template', value_template: "{{ is_state('a.c', 'on') }}" },
        ],
      }),
      lightAction(),
    ]);
    const ids = lintFlowGraph(graph).map((f) => f.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds nothing to say about an automation that follows the rules', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', {
        alias: 'Front door opens',
        trigger: 'state',
        entity_id: 'binary_sensor.front_door',
        from: 'off',
        to: 'on',
      }),
      conditionNode({
        alias: 'Someone is home',
        condition: 'state',
        entity_id: 'person.a',
        state: 'home',
      }),
      lightAction(),
      node('delay', 'delay_1', { alias: 'Let it burn', delay: '00:05:00' }),
    ]);

    expect(lintFlowGraph(graph)).toEqual([]);
  });

  it('never changes the graph it inspects', () => {
    const graph = deepFreeze(stateTriggerGraph({ to: 'on' }));
    expect(() => lintFlowGraph(graph)).not.toThrow();
  });

  it('runs exactly the rules it is given, so a rule can be added without touching the engine', () => {
    const everyNode: ReadabilityRule = {
      id: 'every-node',
      title: 'Test rule',
      check: ({ graph }) =>
        graph.nodes.map((n) => ({
          id: `every-node:${n.id}`,
          ruleId: 'every-node',
          severity: 'info',
          nodeId: n.id,
          message: `Saw ${n.id}`,
          fixes: [],
        })),
    };
    const graph = stateTriggerGraph({ to: 'on' });

    expect(lintFlowGraph(graph, [everyNode]).map((f) => f.message)).toEqual([
      'Saw trigger_1',
      'Saw action_1',
    ]);
    expect(lintFlowGraph(graph, [])).toEqual([]);
  });

  it('does not crash on odd values in the keys it reads', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', {
        trigger: 'state',
        entity_id: 'light.a',
        to: 'on',
        not_from: 5,
        device_id: { odd: true },
      }),
      conditionNode({
        condition: 'template',
        value_template: "{{ is_state('light.a', 'on') }}",
        extra: [1, null],
      }),
      lightAction(),
    ]);

    expect(() => lintFlowGraph(graph)).not.toThrow();
    expect(lintFlowGraph(graph).map((f) => f.ruleId)).toContain('unavailable-restore');
  });

  it('has one uniquely named rule per module', () => {
    const ids = READABILITY_RULES.map((rule) => rule.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([
      'device-id',
      'long-template',
      'missing-alias',
      'missing-description',
      'template-native',
      'unavailable-restore',
    ]);
  });
});

describe('applySafeFixes', () => {
  const messy = () =>
    graphOf([
      node('trigger', 'trigger_1', {
        alias: 'Door',
        trigger: 'state',
        entity_id: 'binary_sensor.front_door',
        to: 'on',
      }),
      node('trigger', 'trigger_2', {
        alias: 'Doorbell',
        trigger: 'state',
        entity_id: 'input_button.doorbell',
        to: null,
      }),
      conditionNode({ condition: 'template', value_template: "{{ is_state('light.a', 'on') }}" }),
      conditionNode(
        { condition: 'template', value_template: "{{ states('sensor.h') | int(0) > 60 }}" },
        'condition_2'
      ),
      lightAction(),
    ]);

  it('applies every safe fix and leaves the ones that need a human decision', () => {
    const graph = deepFreeze(messy());
    const { graph: fixed, applied } = applySafeFixes(graph);

    expect(applied.map((f) => f.id).sort()).toEqual([
      'template-native:condition_1',
      'unavailable-restore:trigger_1',
      'unavailable-restore:trigger_2',
    ]);
    expect(dataOf(fixed, 'trigger_1').not_from).toEqual(['unavailable']);
    // Only the safe fix (ignoring "unavailable") was used for the button, not "and unknown".
    expect(dataOf(fixed, 'trigger_2').not_from).toEqual(['unavailable']);
    expect(dataOf(fixed, 'condition_1')).toMatchObject({ condition: 'state', state: 'on' });
    // int(0) > 60 is not safe: it is still a template.
    expect(dataOf(fixed, 'condition_2')).toMatchObject({ condition: 'template' });
  });

  it('is finished after one call: running it again changes nothing', () => {
    const first = applySafeFixes(messy()).graph;
    const second = applySafeFixes(first);

    expect(second.graph).toBe(first);
    expect(second.applied).toEqual([]);
  });

  it('hands back the very same graph when there is nothing safe to do', () => {
    const graph = stateTriggerGraph({ from: 'off', to: 'on' });
    const result = applySafeFixes(graph);

    expect(result.graph).toBe(graph);
    expect(result.applied).toEqual([]);
  });

  it('uses the first safe fix of a finding, skipping unsafe ones before it', () => {
    const finding = lintFlowGraph(stateTriggerGraph({ to: 'on' }))[0];
    expect(finding && firstSafeFix(finding)?.label).toBe('Ignore restores from “unavailable”');

    const attributeTrigger = lintFlowGraph(stateTriggerGraph({ entity_id: 'media_player.tv' }))[0];
    expect(attributeTrigger && firstSafeFix(attributeTrigger)).toBeUndefined();
  });
});
