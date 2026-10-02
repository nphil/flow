// Rule: device_id in a trigger, condition or action. Fragile, so reported; never auto-fixed.
import { describe, expect, it } from 'vitest';
import {
  conditionNode,
  findingsOf,
  graphOf,
  lightAction,
  node,
  onlyFinding,
} from './lint-test-utils';

const RULE = 'device-id';
const DEVICE = 'ee504a40b987814032d9ec9c29b1a43f';

describe('device-id rule', () => {
  it('flags a device trigger, a device condition and a device action, one finding each', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', {
        trigger: 'device',
        device_id: DEVICE,
        domain: 'light',
        type: 'turned_on',
      }),
      conditionNode({ condition: 'device', device_id: DEVICE, domain: 'light', type: 'is_on' }),
      node('action', 'action_1', {
        service: 'light.turn_on',
        target: { device_id: DEVICE },
      }),
    ]);

    const findings = findingsOf(graph, RULE);
    expect(findings.map((f) => [f.nodeId, f.severity])).toEqual([
      ['trigger_1', 'warning'],
      ['condition_1', 'warning'],
      ['action_1', 'warning'],
    ]);
    expect(findings.map((f) => f.message)).toEqual([
      'This trigger refers to a device by its ID, which is fragile.',
      'This condition refers to a device by its ID, which is fragile.',
      'This action refers to a device by its ID, which is fragile.',
    ]);
    for (const finding of findings) expect(finding.fixes).toEqual([]);
  });

  it('finds a device id wherever it is written, including lists and nested conditions', () => {
    const inTargetList = graphOf([
      node('action', 'action_1', { service: 'light.turn_off', target: { device_id: [DEVICE] } }),
    ]);
    const inGroup = graphOf([
      conditionNode({
        condition: 'and',
        conditions: [{ condition: 'device', device_id: DEVICE, domain: 'light', type: 'is_on' }],
      }),
    ]);
    const inWaitTrigger = graphOf([
      node('wait', 'wait_1', {
        wait_for_trigger: [
          { trigger: 'device', device_id: DEVICE, domain: 'light', type: 'turned_on' },
        ],
      }),
    ]);

    expect(findingsOf(inTargetList, RULE)).toHaveLength(1);
    expect(findingsOf(inGroup, RULE)).toHaveLength(1);
    expect(findingsOf(inWaitTrigger, RULE)).toHaveLength(1);
  });

  it('does not flag entities, areas, or a device id that is computed by a template', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'light.kitchen', to: 'on' }),
      lightAction(),
      node('action', 'action_2', {
        service: 'homeassistant.add_label_to_device',
        data: { label_id: 'x', device_id: '{{ repeat.item }}' },
      }),
      node('action', 'action_3', {
        service: 'light.turn_on',
        target: { area_id: 'kitchen', device_id: '' },
      }),
    ]);

    expect(findingsOf(graph, RULE)).toEqual([]);
  });

  it('gives each finding a stable id per node', () => {
    const graph = graphOf([
      node('trigger', 'trigger_9', {
        trigger: 'device',
        device_id: DEVICE,
        domain: 'x',
        type: 'y',
      }),
    ]);

    expect(onlyFinding(graph, RULE).id).toBe('device-id:trigger_9');
  });
});
