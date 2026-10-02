// Rule: every trigger, condition and action has a name, and the automation a description.
import { describe, expect, it } from 'vitest';
import { findingsOf, graphOf, node, onlyFinding } from './lint-test-utils';

const ALIAS = 'missing-alias';
const DESCRIPTION = 'missing-description';

describe('missing-alias rule', () => {
  it('names the exact node that has no name, for every kind of node', () => {
    const graph = graphOf([
      node('trigger', 'trigger_1', { trigger: 'state', entity_id: 'light.a' }),
      node('condition', 'condition_1', { condition: 'state', entity_id: 'light.a', state: 'on' }),
      node('action', 'action_1', { service: 'light.turn_on' }),
      node('delay', 'delay_1', { delay: '00:00:05' }),
      node('wait', 'wait_1', { wait_template: "{{ is_state('light.a', 'on') }}" }),
      node('set_variables', 'vars_1', { variables: { a: 1 } }),
    ]);

    const findings = findingsOf(graph, ALIAS);
    expect(findings.map((f) => f.nodeId)).toEqual([
      'trigger_1',
      'condition_1',
      'action_1',
      'delay_1',
      'wait_1',
      'vars_1',
    ]);
    expect(findings.map((f) => f.message)).toEqual([
      'This trigger has no name.',
      'This condition has no name.',
      'This action has no name.',
      'This delay has no name.',
      'This wait step has no name.',
      'This variables step has no name.',
    ]);
    for (const finding of findings) {
      expect(finding.severity).toBe('info');
      expect(finding.fixes).toEqual([]);
    }
  });

  it('accepts any name the canvas can show, and rejects a blank one', () => {
    const graph = graphOf([
      node('trigger', 'named', { trigger: 'state', alias: 'Door opens' }),
      node('condition', 'step_named', {
        condition: 'state',
        stepAlias: 'Only when dark',
        entity_id: 'light.a',
        state: 'on',
      }),
      node('condition', 'own_named', { condition: 'state', conditionAlias: 'Sun is down' }),
      node('condition', 'block_named', { condition: 'state', blockAlias: 'Retry loop' }),
      node('action', 'blank', { service: 'light.turn_on', alias: '   ' }),
      node('action', 'empty', { service: 'light.turn_off', alias: '' }),
    ]);

    expect(findingsOf(graph, ALIAS).map((f) => f.nodeId)).toEqual(['blank', 'empty']);
  });
});

describe('missing-description rule', () => {
  const withDescription = (description: string | undefined) =>
    graphOf([node('action', 'action_1', { alias: 'Do it', service: 'light.turn_on' })], {
      description,
    });

  it('reports a missing or blank description once, for the whole automation', () => {
    for (const description of [undefined, '', '  \n ']) {
      const finding = onlyFinding(withDescription(description), DESCRIPTION);
      expect(finding.nodeId).toBeUndefined();
      expect(finding.severity).toBe('info');
      expect(finding.message).toBe('This automation has no description.');
      expect(finding.fixes).toEqual([]);
    }
  });

  it('is satisfied by any description', () => {
    expect(findingsOf(withDescription('Turns the light on.'), DESCRIPTION)).toEqual([]);
  });

  it('stays quiet on an empty canvas, where there is nothing to describe yet', () => {
    expect(findingsOf(graphOf([], { description: '' }), DESCRIPTION)).toEqual([]);
  });
});
