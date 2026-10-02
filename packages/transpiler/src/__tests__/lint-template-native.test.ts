// Rule: `condition: template` that a normal condition can replace. Only a few exact shapes are
// converted automatically; everything else is reported without a fix.
import { describe, expect, it } from 'vitest';
import {
  conditionNode,
  dataOf,
  deepFreeze,
  findingsOf,
  fixAt,
  graphOf,
  node,
  onlyFinding,
} from './lint-test-utils';

const RULE = 'template-native';

function templateGraph(valueTemplate: string, extra: Record<string, unknown> = {}) {
  return graphOf([
    conditionNode({ condition: 'template', value_template: valueTemplate, ...extra }),
  ]);
}

/** Applies the finding's first fix and returns the data of the converted condition node. */
function convert(valueTemplate: string, extra: Record<string, unknown> = {}) {
  const graph = deepFreeze(templateGraph(valueTemplate, extra));
  const finding = onlyFinding(graph, RULE);
  return { graph, finding, fixed: fixAt(finding, 0).apply(graph) };
}

describe('is_state()', () => {
  it('becomes a state condition, keeping the name and note', () => {
    const { fixed, finding } = convert("{{ is_state('light.kitchen', 'on') }}", {
      note: 'Only at night',
    });

    expect(finding.severity).toBe('info');
    expect(fixAt(finding, 0).safe).toBe(true);
    expect(dataOf(fixed, 'condition_1')).toEqual({
      alias: 'Check',
      condition: 'state',
      note: 'Only at night',
      entity_id: 'light.kitchen',
      state: 'on',
    });
  });

  it('reads the same however the template is written', () => {
    for (const template of [
      '{{is_state("light.kitchen","on")}}',
      "{{- is_state('light.kitchen', 'on') -}}",
      "{{ is_state('light.kitchen', 'on') }}\n",
      "  {{\n  is_state(\n    'light.kitchen',\n    'on'\n  )\n}}  ",
    ]) {
      const { fixed } = convert(template);
      expect(dataOf(fixed, 'condition_1')).toMatchObject({
        condition: 'state',
        entity_id: 'light.kitchen',
        state: 'on',
      });
    }
  });

  it('becomes a not condition around a state condition when negated', () => {
    const { fixed } = convert("{{ not is_state('light.kitchen', 'on') }}");

    expect(dataOf(fixed, 'condition_1')).toEqual({
      alias: 'Check',
      condition: 'not',
      conditions: [{ condition: 'state', entity_id: 'light.kitchen', state: 'on' }],
    });
  });

  it('is left alone when the entity is a variable or a second check is added', () => {
    expect(findingsOf(templateGraph("{{ is_state(target_light, 'on') }}"), RULE)).toEqual([]);
    expect(
      findingsOf(templateGraph("{{ is_state('light.a', 'on') and repeat.index < 3 }}"), RULE)
    ).toEqual([]);
  });
});

describe('numeric comparisons of a sensor state', () => {
  it('> becomes above and < becomes below, with the number as a number', () => {
    const above = convert("{{ states('sensor.room_temp') | float(0) > 25 }}").fixed;
    const below = convert("{{ states('sensor.room_temp') | float > -2.5 }}").fixed;

    expect(dataOf(above, 'condition_1')).toEqual({
      alias: 'Check',
      condition: 'numeric_state',
      entity_id: 'sensor.room_temp',
      above: 25,
    });
    expect(dataOf(below, 'condition_1')).toMatchObject({ above: -2.5 });
    expect(
      dataOf(convert("{{ states('sensor.room_temp')|float(0)<25 }}").fixed, 'condition_1')
    ).toMatchObject({ condition: 'numeric_state', below: 25 });
  });

  it('is safe when the template and the native condition agree about an offline sensor', () => {
    // float(0) > 25: an offline sensor counts as 0, which is not above 25 -- same as "no match".
    const { finding } = convert("{{ states('sensor.room_temp') | float(0) > 25 }}");
    expect(fixAt(finding, 0).safe).toBe(true);
    expect(fixAt(finding, 0).note).toBeUndefined();

    // float with no default fails on an offline sensor, which also means "no match".
    const noDefault = convert("{{ states('sensor.room_temp') | float < 25 }}").finding;
    expect(fixAt(noDefault, 0).safe).toBe(true);
    expect(fixAt(noDefault, 0).note).toBeUndefined();
  });

  it('still converts when the default makes an offline sensor pass, and says so', () => {
    // float(0) < 25: an offline sensor counts as 0, so the template is TRUE while it is offline.
    const { finding } = convert("{{ states('sensor.room_temp') | float(0) < 25 }}");
    const fix = fixAt(finding, 0);

    expect(fix.safe).toBe(true);
    expect(fix.note).toContain('offline');
  });

  it('marks int() unsafe: it cuts off decimals, a numeric condition does not', () => {
    const { finding, fixed } = convert("{{ states('sensor.humidity') | int(0) > 60 }}");
    const fix = fixAt(finding, 0);

    expect(fix.safe).toBe(false);
    expect(fix.note).toContain('decimals');
    expect(dataOf(fixed, 'condition_1')).toMatchObject({ condition: 'numeric_state', above: 60 });
  });

  it('is only recognised for > and <, because above/below are strict', () => {
    const finding = onlyFinding(
      templateGraph("{{ states('sensor.room_temp') | float(0) >= 25 }}"),
      RULE
    );
    expect(finding.fixes).toEqual([]);
    expect(finding.message).toContain('Numeric state');
  });
});

describe('trigger.id', () => {
  it('becomes a trigger condition', () => {
    const { fixed } = convert("{{ trigger.id == 'motion' }}");

    expect(dataOf(fixed, 'condition_1')).toEqual({
      alias: 'Check',
      condition: 'trigger',
      id: 'motion',
    });
  });

  it('other forms are reported without a fix', () => {
    const finding = onlyFinding(templateGraph("{{ trigger.id in ['a', 'b'] }}"), RULE);

    expect(finding.fixes).toEqual([]);
    expect(finding.message).toContain('Trigger condition');
  });
});

describe('is_state_attr()', () => {
  it('becomes a state condition with an attribute', () => {
    const { fixed } = convert("{{ is_state_attr('climate.hall', 'hvac_action', 'heating') }}");

    expect(dataOf(fixed, 'condition_1')).toEqual({
      alias: 'Check',
      condition: 'state',
      entity_id: 'climate.hall',
      attribute: 'hvac_action',
      state: 'heating',
    });
  });

  it('a number to compare with is reported without a fix', () => {
    const finding = onlyFinding(
      templateGraph("{{ is_state_attr('light.hall', 'brightness', 100) }}"),
      RULE
    );
    expect(finding.fixes).toEqual([]);
  });
});

describe('templates a normal condition could replace but Flow does not convert', () => {
  it('time of day and weekday checks point at a Time condition', () => {
    for (const template of [
      '{{ now().hour >= 22 }}',
      '{{ now().hour >= 22 or now().hour < 6 }}',
      '{{ now().weekday() in [5, 6] }}',
      "{{ now().strftime('%H:%M') > '22:00' }}",
    ]) {
      const finding = onlyFinding(templateGraph(template), RULE);
      expect(finding.fixes, template).toEqual([]);
      expect(finding.message, template).toContain('Time condition');
    }
  });

  it('is silent for time checks no Time condition can express', () => {
    expect(findingsOf(templateGraph('{{ now().month == 12 }}'), RULE)).toEqual([]);
    expect(findingsOf(templateGraph('{{ now().hour >= 22 and now().day == 1 }}'), RULE)).toEqual(
      []
    );
  });

  it('negated and listed state checks point at the right native shape', () => {
    const notEqual = onlyFinding(templateGraph("{{ states('cover.blind') != 'closed' }}"), RULE);
    expect(notEqual.message).toContain('Not condition around a State condition');

    const notIn = onlyFinding(
      templateGraph("{{ states('sensor.x') not in ['unavailable', 'unknown'] }}"),
      RULE
    );
    expect(notIn.message).toContain('Not condition around a State condition');

    const isIn = onlyFinding(templateGraph("{{ states('sensor.x') in ['on', 'idle'] }}"), RULE);
    expect(isIn.message).toBe('A State condition could replace this template.');
  });

  it('names every kind of condition a mixed template could be split into', () => {
    const finding = onlyFinding(
      templateGraph("{{ states('sensor.t') | float(0) > 30 and is_state('light.a', 'on') }}"),
      RULE
    );
    expect(finding.message).toBe(
      'A Numeric state condition and a State condition could replace this template.'
    );
    expect(finding.fixes).toEqual([]);
  });

  it('is silent when any part of the template is something else', () => {
    for (const template of [
      "{{ is_state('light.a', 'on') and some_variable }}",
      '{{ trigger.payload == 1 }}',
      '{{ repeat.index >= 3 }}',
      "{% if is_state('light.a', 'on') %}true{% else %}false{% endif %}",
      "{{ is_state('light.a', 'on') }} and more text",
      "{{ states('sensor.t') | float(0) * 2 > 3 }}",
    ]) {
      expect(findingsOf(templateGraph(template), RULE), template).toEqual([]);
    }
  });

  it('ignores conditions that are not templates', () => {
    const graph = graphOf([
      conditionNode({ condition: 'state', entity_id: 'light.kitchen', state: 'on' }),
    ]);
    expect(findingsOf(graph, RULE)).toEqual([]);
  });
});

describe('conditions nested in and / or / not groups', () => {
  const grouped = () =>
    graphOf([
      conditionNode({
        condition: 'or',
        conditions: [
          { condition: 'state', entity_id: 'light.a', state: 'on' },
          {
            condition: 'and',
            conditions: [
              { condition: 'template', value_template: "{{ is_state('light.b', 'off') }}" },
              { condition: 'template', value_template: "{{ trigger.id == 'go' }}" },
            ],
          },
        ],
      }),
    ]);

  it('reports each nested template and converts only the one it names', () => {
    const graph = deepFreeze(grouped());
    const findings = findingsOf(graph, RULE);

    expect(findings.map((f) => f.id)).toEqual([
      'template-native:condition_1:1:0',
      'template-native:condition_1:1:1',
    ]);

    const fixed = fixAt(findings[0], 0).apply(graph);
    const data = dataOf(fixed, 'condition_1');
    expect(data).toEqual({
      alias: 'Check',
      condition: 'or',
      conditions: [
        { condition: 'state', entity_id: 'light.a', state: 'on' },
        {
          condition: 'and',
          conditions: [
            { condition: 'state', entity_id: 'light.b', state: 'off' },
            { condition: 'template', value_template: "{{ trigger.id == 'go' }}" },
          ],
        },
      ],
    });
  });
});

describe('fixes are safe to apply late', () => {
  it('does nothing when the template was edited into something Flow cannot convert', () => {
    const graph = templateGraph("{{ is_state('light.kitchen', 'on') }}");
    const fix = fixAt(onlyFinding(graph, RULE), 0);
    const edited = templateGraph("{{ is_state('light.kitchen', 'on') and now().hour > 5 }}");

    expect(fix.apply(edited)).toBe(edited);
  });

  it('does nothing when the node is gone', () => {
    const graph = templateGraph("{{ is_state('light.kitchen', 'on') }}");
    const fix = fixAt(onlyFinding(graph, RULE), 0);
    const other = graphOf([node('delay', 'delay_1', { alias: 'Wait', delay: '00:00:05' })]);

    expect(fix.apply(other)).toBe(other);
  });
});

describe('wait_template', () => {
  const waitGraph = (template: string) =>
    graphOf([node('wait', 'wait_1', { alias: 'Wait', wait_template: template })]);

  it('explains that is_state() passes straight away when the state already matches', () => {
    const finding = onlyFinding(waitGraph("{{ is_state('binary_sensor.door', 'off') }}"), RULE);

    expect(finding.severity).toBe('info');
    expect(finding.nodeId).toBe('wait_1');
    expect(finding.message).toContain('straight away');
    expect(finding.detail).toContain('Wait for trigger');
    expect(finding.fixes).toEqual([]);
  });

  it('leaves waits that do not use is_state() alone', () => {
    expect(
      findingsOf(waitGraph("{{ states('sensor.x') not in ['unavailable', 'unknown'] }}"), RULE)
    ).toEqual([]);
    expect(findingsOf(waitGraph('{{ wait.remaining < 5 }}'), RULE)).toEqual([]);
  });
});
