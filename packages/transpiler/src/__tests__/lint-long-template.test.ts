// Rule: a template condition that is long (> 200 characters) or has 3+ {% %} blocks.
import { describe, expect, it } from 'vitest';
import { conditionNode, findingsOf, graphOf, onlyFinding } from './lint-test-utils';

const RULE = 'long-template';

function graphWith(valueTemplate: string, condition = 'template') {
  return graphOf([conditionNode({ condition, value_template: valueTemplate })]);
}

/** A one-line template of exactly this many characters. */
function templateOfLength(length: number): string {
  const frame = '{{  }}';
  return `{{ ${'x'.repeat(length - frame.length)} }}`;
}

describe('long-template rule', () => {
  it('flags a template longer than 200 characters, not one of exactly 200', () => {
    expect(templateOfLength(200)).toHaveLength(200);
    expect(findingsOf(graphWith(templateOfLength(200)), RULE)).toEqual([]);

    const finding = onlyFinding(graphWith(templateOfLength(201)), RULE);
    expect(finding.severity).toBe('info');
    expect(finding.message).toContain('long');
    expect(finding.detail).toContain('splitting it into several steps');
    expect(finding.detail).toContain('helper');
    expect(finding.fixes).toEqual([]);
  });

  it('flags three {% %} blocks but not two', () => {
    const two = "{% if is_state('light.a', 'on') %}true{% endif %}";
    expect(findingsOf(graphWith(two), RULE)).toEqual([]);

    const three = "{% if is_state('light.a', 'on') %}true{% else %}false{% endif %}";
    expect(findingsOf(graphWith(three), RULE)).toHaveLength(1);
  });

  it('looks inside and / or / not groups', () => {
    const graph = graphOf([
      conditionNode({
        condition: 'not',
        conditions: [{ condition: 'template', value_template: templateOfLength(250) }],
      }),
    ]);

    expect(onlyFinding(graph, RULE).id).toBe('long-template:condition_1:0');
  });

  it('only looks at template conditions', () => {
    const graph = graphOf([
      conditionNode({ condition: 'state', entity_id: 'light.a', state: templateOfLength(300) }),
    ]);
    expect(findingsOf(graph, RULE)).toEqual([]);
  });
});
