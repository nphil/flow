// House rule 3: sensors going unavailable must never actuate, and neither may a restore from
// `unavailable`/`unknown` count as a real trigger.
import { describe, expect, it } from 'vitest';
import {
  conditionNode,
  dataOf,
  deepFreeze,
  findingsOf,
  fixAt,
  graphOf,
  lightAction,
  node,
  onlyFinding,
  stateTriggerGraph,
} from './lint-test-utils';

const RULE = 'unavailable-restore';

describe('state trigger that fires when an entity comes back from unavailable', () => {
  it('flags a trigger with only `to:` on an automation that switches something', () => {
    const finding = onlyFinding(stateTriggerGraph({ to: 'on' }), RULE);

    expect(finding.severity).toBe('warning');
    expect(finding.nodeId).toBe('trigger_1');
    expect(finding.message).toContain('binary_sensor.front_door');
    expect(finding.message).toContain('unavailable');
  });

  it('offers `not_from: [unavailable]` as the safe first fix, without touching anything else', () => {
    const graph = deepFreeze(stateTriggerGraph({ to: 'on' }));
    const finding = onlyFinding(graph, RULE);
    const fix = fixAt(finding, 0);

    expect(fix.safe).toBe(true);
    const fixed = fix.apply(graph);

    expect(dataOf(fixed, 'trigger_1')).toEqual({
      ...dataOf(graph, 'trigger_1'),
      not_from: ['unavailable'],
    });
    expect(dataOf(graph, 'trigger_1')).not.toHaveProperty('not_from');
    expect(fixed.nodes[1]).toBe(graph.nodes[1]);
    expect(findingsOf(fixed, RULE)).toEqual([]);
  });

  it('offers `not_from: [unavailable, unknown]` as the second fix', () => {
    const graph = stateTriggerGraph({ to: 'on' });
    const fixed = fixAt(onlyFinding(graph, RULE), 1).apply(graph);

    expect(dataOf(fixed, 'trigger_1').not_from).toEqual(['unavailable', 'unknown']);
    expect(findingsOf(fixed, RULE)).toEqual([]);
  });

  it('applying a fix twice changes nothing the second time', () => {
    const graph = stateTriggerGraph({ to: 'on' });
    const fix = fixAt(onlyFinding(graph, RULE), 0);
    const once = fix.apply(graph);

    expect(fix.apply(once)).toBe(once);
  });

  it('drops a `from: null` key, which Home Assistant refuses next to `not_from`', () => {
    const graph = stateTriggerGraph({ from: null, to: 'on' });
    const fixed = fixAt(onlyFinding(graph, RULE), 0).apply(graph);

    expect(dataOf(fixed, 'trigger_1')).not.toHaveProperty('from');
    expect(dataOf(fixed, 'trigger_1').not_from).toEqual(['unavailable']);
  });

  it('does not flag a trigger that pins `from:`', () => {
    expect(findingsOf(stateTriggerGraph({ from: 'off', to: 'on' }), RULE)).toEqual([]);
    expect(findingsOf(stateTriggerGraph({ from: ['off', 'idle'] }), RULE)).toEqual([]);
  });

  it('does not flag a trigger that already ignores unavailable (string or list)', () => {
    expect(findingsOf(stateTriggerGraph({ to: 'on', not_from: 'unavailable' }), RULE)).toEqual([]);
    expect(
      findingsOf(stateTriggerGraph({ to: 'on', not_from: ['unavailable', 'unknown'] }), RULE)
    ).toEqual([]);
  });

  it('adds `unavailable` to a `not_from` that only ignores `unknown`', () => {
    const graph = stateTriggerGraph({ to: 'on', not_from: ['unknown'] });
    const finding = onlyFinding(graph, RULE);

    expect(finding.fixes).toHaveLength(1);
    const fixed = fixAt(finding, 0).apply(graph);
    expect(dataOf(fixed, 'trigger_1').not_from).toEqual(['unknown', 'unavailable']);
  });

  it('only checks automations that switch something', () => {
    const quiet = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }),
      node('action', 'action_1', { service: 'notify.mobile_app_phone' }),
      node('action', 'action_2', { service: 'persistent_notification.create' }),
      node('action', 'action_3', { service: 'logbook.log' }),
      node('action', 'action_4', { service: 'system_log.write' }),
      node('action', 'action_5', { service: 'tts.speak' }),
    ]);
    expect(findingsOf(quiet, RULE)).toEqual([]);
  });

  it('counts any other service, including one hidden inside a repeat or a choose', () => {
    const nested = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }),
      node('action', 'action_1', {
        repeat: {
          count: 2,
          sequence: [{ service: 'notify.mobile_app_phone' }, { service: 'switch.turn_on' }],
        },
      }),
    ]);
    expect(findingsOf(nested, RULE)).toHaveLength(1);
  });

  it('ignores steps that are switched off', () => {
    const disabledAction = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'binary_sensor.door', to: 'on' }),
      node('action', 'action_1', { service: 'light.turn_on', enabled: false }),
    ]);
    const disabledTrigger = graphOf([
      node('trigger', 'trigger_1', {
        trigger: 'state',
        entity_id: 'binary_sensor.door',
        to: 'on',
        enabled: false,
      }),
      lightAction(),
    ]);

    expect(findingsOf(disabledAction, RULE)).toEqual([]);
    expect(findingsOf(disabledTrigger, RULE)).toEqual([]);
  });

  it('is satisfied by a condition that already skips triggers coming from unavailable', () => {
    const guarded = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'sensor.door', to: 'on' }),
      conditionNode({
        condition: 'template',
        value_template: "{{ trigger.from_state.state not in ['unavailable', 'unknown'] }}",
      }),
      lightAction(),
    ]);
    expect(findingsOf(guarded, RULE)).toEqual([]);
  });

  it('is not satisfied by a guard that is switched off', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'sensor.door', to: 'on' }),
      conditionNode({
        condition: 'template',
        enabled: false,
        value_template: "{{ trigger.from_state.state not in ['unavailable', 'unknown'] }}",
      }),
      lightAction(),
    ]);
    expect(findingsOf(graph, RULE)).toHaveLength(1);
  });

  it('names every entity of a multi-entity trigger and keeps the sentence grammatical', () => {
    const finding = onlyFinding(
      stateTriggerGraph({ entity_id: ['sensor.a', 'sensor.b', 'sensor.c'], to: 'on' }),
      RULE
    );
    expect(finding.message).toContain('sensor.a, sensor.b or 1 more comes back');
  });
});

describe('trigger fixes that would change more than the restore behaviour', () => {
  it('marks ignoring "unknown" unsafe for buttons and events, and says why', () => {
    const graph = stateTriggerGraph({ entity_id: 'input_button.doorbell', to: null });
    const finding = onlyFinding(graph, RULE);

    expect(fixAt(finding, 0).safe).toBe(true);
    const second = fixAt(finding, 1);
    expect(second.safe).toBe(false);
    expect(second.note).toContain('input_button.doorbell');
    expect(second.note).toContain('first');
  });

  it('keeps ignoring "unknown" safe for a plain sensor', () => {
    const graph = stateTriggerGraph({ entity_id: 'sensor.garage_temp', to: 'on' });
    const finding = onlyFinding(graph, RULE);

    expect(fixAt(finding, 1).safe).toBe(true);
  });

  it('treats an unrecognisable entity as possibly a button', () => {
    const graph = stateTriggerGraph({ entity_id: [], to: 'on' });
    expect(fixAt(onlyFinding(graph, RULE), 1).safe).toBe(false);
  });

  it('warns that a trigger with no to/from also reacts to attribute changes before ignoring unavailable', () => {
    const graph = stateTriggerGraph({ entity_id: 'media_player.tv' });
    const finding = onlyFinding(graph, RULE);

    for (const fix of finding.fixes) {
      expect(fix.safe).toBe(false);
      expect(fix.note).toContain('attribute');
    }
  });
});

describe('triggers where ignoring `from` cannot help', () => {
  it('reports a trigger that starts when the entity goes unavailable, without a fix', () => {
    const goesOffline = onlyFinding(stateTriggerGraph({ to: ['off', 'unavailable'] }), RULE);
    expect(goesOffline.severity).toBe('warning');
    expect(goesOffline.message).toContain('goes “unavailable”');
    expect(goesOffline.fixes).toEqual([]);

    const toUnknown = onlyFinding(stateTriggerGraph({ from: 'on', to: 'unknown' }), RULE);
    expect(toUnknown.fixes).toEqual([]);
  });

  it('reports a trigger that deliberately starts on the way back from unavailable', () => {
    const finding = onlyFinding(stateTriggerGraph({ from: 'unavailable', to: 'on' }), RULE);

    expect(finding.message).toContain('comes back from “unavailable”');
    expect(finding.fixes).toEqual([]);
  });

  it('points an attribute trigger at a guard condition instead of a fix', () => {
    const finding = onlyFinding(
      stateTriggerGraph({ entity_id: 'climate.hall', attribute: 'hvac_action', to: 'heating' }),
      RULE
    );
    expect(finding.fixes).toEqual([]);
    expect(finding.detail).toContain('trigger.from_state.state');
  });
});

describe('numeric_state trigger', () => {
  const numeric = (data: Record<string, unknown> = {}) =>
    graphOf([
      node('trigger', 'trigger_1', {
        alias: 'Temperature',
        trigger: 'numeric_state',
        entity_id: 'sensor.room_a_temp',
        above: 25,
        ...data,
      }),
      lightAction(),
    ]);

  it('gets a suggestion (never a warning) and no automatic fix', () => {
    const finding = onlyFinding(numeric(), RULE);

    expect(finding.severity).toBe('info');
    expect(finding.fixes).toEqual([]);
    expect(finding.detail).toContain('trigger.from_state.state not in ["unavailable", "unknown"]');
  });

  it('is left alone when the automation only notifies', () => {
    const quiet = graphOf([
      node('trigger', 'trigger_1', { trigger: 'numeric_state', entity_id: 'sensor.t', above: 25 }),
      node('action', 'action_1', { service: 'notify.mobile_app_phone' }),
    ]);
    expect(findingsOf(quiet, RULE)).toEqual([]);
  });

  it('is satisfied by a from_state guard condition', () => {
    const guarded = graphOf([
      node('trigger', 'trigger_1', { trigger: 'numeric_state', entity_id: 'sensor.t', above: 25 }),
      conditionNode({
        condition: 'template',
        value_template: "{{ trigger.from_state.state not in ['unavailable', 'unknown'] }}",
      }),
      lightAction(),
    ]);
    expect(findingsOf(guarded, RULE)).toEqual([]);
  });
});

describe('other trigger kinds', () => {
  it('never reports time, event or device triggers', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', { trigger: 'time', at: '07:00:00' }),
      node('trigger', 'trigger_2', { trigger: 'event', event_type: 'my_event' }),
      node('trigger', 'trigger_3', {
        trigger: 'device',
        device_id: 'abc',
        domain: 'light',
        type: 'turned_on',
      }),
      lightAction(),
    ]);
    expect(findingsOf(graph, RULE)).toEqual([]);
  });
});
