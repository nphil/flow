import type { FlowNode } from '@cafe/shared';
import {
  isActionNode,
  isConditionNode,
  isDelayNode,
  isSetVariablesNode,
  isTriggerNode,
} from '@cafe/shared';
import { describe, expect, it } from 'vitest';
import { YamlParser } from '../parser/YamlParser';
import { resolveTracePath } from '../utils/tracePathMap';

const parser = new YamlParser();

/** Find the single node matching `predicate`, failing loudly if it's not unique. */
function findNode(nodes: FlowNode[], predicate: (node: FlowNode) => boolean): FlowNode {
  const matches = nodes.filter(predicate);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe('nodePathMap — native format', () => {
  // trigger -> root condition -> if/then(delay, action)/else(action) -> parallel -> repeat.while
  const yaml = `
alias: Nested Trace Test
description: Trigger, condition, if/then/else with delay, parallel, and repeat
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
conditions:
  - condition: state
    entity_id: input_boolean.armed
    state: "on"
actions:
  - if:
      - condition: state
        entity_id: light.living_room
        state: "off"
    then:
      - delay:
          seconds: 5
      - service: light.turn_on
        target:
          entity_id: light.living_room
    else:
      - service: notify.mobile_app
        data:
          message: "Already on"
  - parallel:
      - service: switch.turn_on
        target:
          entity_id: switch.fan
      - service: switch.turn_on
        target:
          entity_id: switch.humidifier
  - repeat:
      while:
        - condition: state
          entity_id: binary_sensor.motion
          state: "on"
      sequence:
        - service: light.turn_on
          target:
            entity_id: light.hallway
mode: single
`;

  it('parses successfully with a fully populated nodePathMap', async () => {
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.errors ?? []).toHaveLength(0);
    expect(result.graph).toBeDefined();
    expect(result.nodePathMap).toBeDefined();

    const graph = result.graph!;
    const map = result.nodePathMap!;

    // Every node this automation produces, located by its distinguishing data
    // (ids are freshly generated, so we can't assert literal id strings).
    const trigger = findNode(graph.nodes, isTriggerNode);
    const rootCondition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.entity_id === 'input_boolean.armed'
    );
    const ifCondition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.entity_id === 'light.living_room'
    );
    const delayNode = findNode(graph.nodes, isDelayNode);
    const thenAction = findNode(
      graph.nodes,
      (n) =>
        isActionNode(n) &&
        n.data.service === 'light.turn_on' &&
        n.data.target?.entity_id === 'light.living_room'
    );
    const elseAction = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.service === 'notify.mobile_app'
    );
    const parallelFan = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.target?.entity_id === 'switch.fan'
    );
    const parallelHumidifier = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.target?.entity_id === 'switch.humidifier'
    );
    const whileCondition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.entity_id === 'binary_sensor.motion'
    );
    const repeatBodyAction = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.target?.entity_id === 'light.hallway'
    );

    // Exactly these 10 nodes should exist.
    expect(graph.nodes).toHaveLength(10);

    const expectedPathToNode: Record<string, string> = {
      'trigger/0': trigger.id,
      'condition/0': rootCondition.id,
      'action/0': ifCondition.id,
      'action/0/if/condition/0': ifCondition.id,
      'action/0/then/0': delayNode.id,
      'action/0/then/1': thenAction.id,
      'action/0/else/0': elseAction.id,
      'action/1/parallel/0/sequence/0': parallelFan.id,
      'action/1/parallel/1/sequence/0': parallelHumidifier.id,
      'action/2': whileCondition.id,
      'action/2/repeat/while/0': whileCondition.id,
      'action/2/repeat/sequence/0': repeatBodyAction.id,
    };

    expect(map.pathToNode).toEqual(expectedPathToNode);

    // nodeToPaths is the exact inverse. The most specific path for a node
    // (its own condition-check step) is recorded before the coarser
    // wrapper-action step, so it is each node's primary (first) path.
    expect(map.nodeToPaths[ifCondition.id]).toEqual(['action/0/if/condition/0', 'action/0']);
    expect(map.nodeToPaths[whileCondition.id]).toEqual(['action/2/repeat/while/0', 'action/2']);
    expect(map.nodeToPaths[trigger.id]).toEqual(['trigger/0']);
    expect(map.nodeToPaths[repeatBodyAction.id]).toEqual(['action/2/repeat/sequence/0']);

    // resolveTracePath sanity checks against the real, parser-produced map.
    expect(resolveTracePath(map, 'action/0')).toBe(ifCondition.id);
    // A path HA could plausibly emit that wasn't recorded directly (the
    // then-branch's own synthetic wrapper) still resolves via ancestor walk.
    expect(resolveTracePath(map, 'action/0/then')).toBe(ifCondition.id);
    expect(resolveTracePath(map, 'action/9/does/not/exist')).toBeNull();
  });
});

describe('nodePathMap — native format, choose block with no metadata', () => {
  // Hand-written foreign automation (no _cafe_metadata): every node id is
  // freshly generated, not restored, exercising the `choose/{b}` grammar.
  const yaml = `
alias: Climate Control Based on Presence
description: Adjust temperature based on occupancy and time
trigger:
  - platform: state
    entity_id: binary_sensor.occupancy
action:
  - choose:
      - conditions:
          - condition: state
            entity_id: binary_sensor.occupancy
            state: "on"
        sequence:
          - service: climate.set_temperature
            target:
              entity_id: climate.main
            data:
              temperature: 22
      - conditions:
          - condition: state
            entity_id: binary_sensor.occupancy
            state: "off"
        sequence:
          - service: climate.set_temperature
            target:
              entity_id: climate.main
            data:
              temperature: 18
    default:
      - service: climate.set_temperature
        target:
          entity_id: climate.main
        data:
          temperature: 20
mode: restart
`;

  it('maps every choose branch to its freshly-generated node id', async () => {
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.hadMetadata).toBe(false);

    const graph = result.graph!;
    const map = result.nodePathMap!;

    const branch0Condition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.state === 'on'
    );
    const branch0Action = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.data?.temperature === 22
    );
    const branch1Condition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.state === 'off'
    );
    const branch1Action = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.data?.temperature === 18
    );
    const defaultAction = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.data?.temperature === 20
    );

    expect(map.pathToNode['action/0']).toBe(branch0Condition.id);
    expect(map.pathToNode['action/0/choose/0/conditions/0']).toBe(branch0Condition.id);
    expect(map.pathToNode['action/0/choose/0/sequence/0']).toBe(branch0Action.id);
    expect(map.pathToNode['action/0/choose/1/conditions/0']).toBe(branch1Condition.id);
    expect(map.pathToNode['action/0/choose/1/sequence/0']).toBe(branch1Action.id);
    expect(map.pathToNode['action/0/choose/default/0']).toBe(defaultAction.id);

    // resolveTracePath resolves an unrecorded child of a mapped branch via ancestor walk.
    expect(resolveTracePath(map, 'action/0/choose/0/sequence/0/extra')).toBe(branch0Action.id);
  });
});

describe('nodePathMap — native format, repeat.until and repeat.count entry points', () => {
  // `until` is a post-test loop (body runs before the first check), so its
  // entry point is the first body node; `count` synthesizes its own counter
  // init node that runs before the body, so that node is the entry point.
  const yaml = `
alias: Repeat Variants Trace Test
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
actions:
  - repeat:
      until:
        - condition: state
          entity_id: binary_sensor.door
          state: "off"
      sequence:
        - service: notify.mobile_app
          data:
            message: "Door is still open"
  - repeat:
      count: 3
      sequence:
        - service: light.turn_on
          target:
            entity_id: light.strobe
mode: single
`;

  it('maps repeat.until entry to the first body node and repeat.count entry to the counter node', async () => {
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.errors ?? []).toHaveLength(0);

    const graph = result.graph!;
    const map = result.nodePathMap!;

    const untilBodyAction = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.service === 'notify.mobile_app'
    );
    const untilCondition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.entity_id === 'binary_sensor.door'
    );
    const countBodyAction = findNode(
      graph.nodes,
      (n) => isActionNode(n) && n.data.target?.entity_id === 'light.strobe'
    );
    // The count-repeat's synthetic counter-init node is a set_variables node
    // whose single variable starts at 0; the increment node (also
    // set_variables) sets it to a `{{ ... + 1 }}` template instead.
    const counterNode = findNode(
      graph.nodes,
      (n) => isSetVariablesNode(n) && Object.values(n.data.variables)[0] === 0
    );

    // repeat.until: body node is action/0/repeat/sequence/0 AND the bare
    // wrapper action/0 (post-test loop — body executes before the check).
    expect(map.pathToNode['action/0']).toBe(untilBodyAction.id);
    expect(map.pathToNode['action/0/repeat/sequence/0']).toBe(untilBodyAction.id);
    expect(map.pathToNode['action/0/repeat/until/0']).toBe(untilCondition.id);

    // repeat.count: the counter-init node is the entry (action/1 bare); its
    // increment and comparison nodes are synthetic bookkeeping with no real
    // HA trace correlate, so they receive no recorded path at all.
    expect(map.pathToNode['action/1']).toBe(counterNode.id);
    expect(map.pathToNode['action/1/repeat/sequence/0']).toBe(countBodyAction.id);
    const incrNode = findNode(
      graph.nodes,
      (n) => isSetVariablesNode(n) && typeof Object.values(n.data.variables)[0] === 'string'
    );
    const counterCheckCondition = findNode(
      graph.nodes,
      (n) => isConditionNode(n) && n.data.condition === 'template'
    );
    expect(map.nodeToPaths[incrNode.id]).toBeUndefined();
    expect(map.nodeToPaths[counterCheckCondition.id]).toBeUndefined();
  });
});
