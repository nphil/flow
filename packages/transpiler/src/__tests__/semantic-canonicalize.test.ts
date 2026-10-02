// @vitest-environment node
//
// The semantic canonicalizer defines what "saving from Flow changed nothing"
// means (the live gate and the offline corpus both rely on it). It must be
// loose about spellings Home Assistant treats as identical and strict about
// everything that changes what an automation DOES, in both directions.
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { canonicalizeConfig, isJson, type Json, semanticDiff } from '../semantic';

function config(yaml: string): Json {
  const loaded: unknown = yamlLoad(yaml);
  if (!isJson(loaded)) throw new Error('fixture is not plain JSON data');
  return loaded;
}

function sameMeaning(a: string, b: string): string[] {
  return semanticDiff(canonicalizeConfig(config(a)).canon, canonicalizeConfig(config(b)).canon);
}

const TRIGGER = `
triggers:
  - trigger: time_pattern
    minutes: /5
`;

describe('spellings Home Assistant treats as identical', () => {
  it('singular and plural keys, platform/trigger and service/action', () => {
    expect(
      sameMeaning(
        `
trigger:
  - platform: time_pattern
    minutes: /5
condition:
  - condition: state
    entity_id: light.a
    state: "on"
action:
  - service: light.turn_off
    target: { entity_id: light.a }
`,
        `
triggers:
  - trigger: time_pattern
    minutes: /5
conditions:
  - condition: state
    entity_id: light.a
    state: "on"
actions:
  - action: light.turn_off
    target: { entity_id: light.a }
`
      )
    ).toEqual([]);
  });

  it('shorthand conditions equal their long form', () => {
    expect(
      sameMeaning(
        `${TRIGGER}
conditions:
  - "{{ is_state('light.a', 'on') }}"
  - or:
      - "{{ true }}"
      - condition: state
        entity_id: light.b
        state: "on"
actions: []
`,
        `${TRIGGER}
conditions:
  - condition: template
    value_template: "{{ is_state('light.a', 'on') }}"
  - condition: or
    conditions:
      - condition: template
        value_template: "{{ true }}"
      - condition: state
        entity_id: light.b
        state: "on"
actions: []
`
      )
    ).toEqual([]);
  });

  it('choose with default equals a nested if/else ladder', () => {
    expect(
      sameMeaning(
        `${TRIGGER}
actions:
  - choose:
      - conditions: [{ condition: state, entity_id: light.a, state: "on" }]
        sequence: [{ action: light.turn_off, target: { entity_id: light.a } }]
      - conditions: [{ condition: state, entity_id: light.b, state: "on" }]
        sequence: [{ action: light.turn_off, target: { entity_id: light.b } }]
    default:
      - action: light.turn_on
        target: { entity_id: light.c }
`,
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ action: light.turn_off, target: { entity_id: light.a } }]
    else:
      - if: [{ condition: state, entity_id: light.b, state: "on" }]
        then: [{ action: light.turn_off, target: { entity_id: light.b } }]
        else: [{ action: light.turn_on, target: { entity_id: light.c } }]
`
      )
    ).toEqual([]);
  });

  it('a guard that stops equals the same if with the rest in else', () => {
    expect(
      sameMeaning(
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then:
      - action: notify.example
      - stop: already on
  - action: light.turn_on
    target: { entity_id: light.a }
  - action: light.turn_on
    target: { entity_id: light.b }
`,
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then:
      - action: notify.example
      - stop: already on
    else:
      - action: light.turn_on
        target: { entity_id: light.a }
      - action: light.turn_on
        target: { entity_id: light.b }
`
      )
    ).toEqual([]);
  });

  it('durations, default enabled/continue_on_timeout and parallel branch wrappers', () => {
    expect(
      sameMeaning(
        `${TRIGGER}
actions:
  - delay: "00:00:30"
  - wait_template: "{{ true }}"
    timeout: { minutes: 5 }
    continue_on_timeout: true
    enabled: true
  - parallel:
      - sequence:
          - action: light.turn_on
          - action: light.turn_off
      - action: fan.turn_on
`,
        `${TRIGGER}
actions:
  - delay: { seconds: 30 }
  - wait_template: "{{ true }}"
    timeout: "00:05:00"
  - parallel:
      - - action: light.turn_on
        - action: light.turn_off
      - - action: fan.turn_on
`
      )
    ).toEqual([]);
  });
});

describe('changes that alter behavior are always reported', () => {
  it('step order', () => {
    expect(
      sameMeaning(
        `${TRIGGER}
actions: [{ action: light.turn_on }, { action: light.turn_off }]
`,
        `${TRIGGER}
actions: [{ action: light.turn_off }, { action: light.turn_on }]
`
      ).length
    ).toBeGreaterThan(0);
  });

  it('a dropped wait timeout or a flipped continue_on_timeout', () => {
    const base = `${TRIGGER}
actions:
  - wait_template: "{{ true }}"
`;
    expect(sameMeaning(`${base}    timeout: { minutes: 5 }\n`, base).length).toBeGreaterThan(0);
    expect(
      sameMeaning(
        `${base}    timeout: { minutes: 5 }\n`,
        `${base}    timeout: { minutes: 5 }\n    continue_on_timeout: false\n`
      ).length
    ).toBeGreaterThan(0);
  });

  it('dropped root conditions, variables, max and mode', () => {
    const full = `${TRIGGER}
conditions: [{ condition: state, entity_id: light.a, state: "on" }]
actions: []
variables: { limit: 3 }
mode: parallel
max: 9
max_exceeded: silent
`;
    for (const gone of ['conditions', 'variables', 'mode', 'max', 'max_exceeded']) {
      const trimmed = yamlLoad(full) as Record<string, unknown>;
      delete trimmed[gone];
      expect(
        semanticDiff(
          canonicalizeConfig(config(full)).canon,
          canonicalizeConfig(config(JSON.stringify(trimmed))).canon
        ).length,
        `dropping ${gone} must be reported`
      ).toBeGreaterThan(0);
    }
  });

  it('a stop that no longer ends its branch', () => {
    expect(
      sameMeaning(
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ stop: bail }]
  - action: light.turn_on
`,
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ action: notify.example }]
  - action: light.turn_on
`
      ).length
    ).toBeGreaterThan(0);
  });

  it('loop conditions are not merged with surrounding guards', () => {
    // `until: [a, b]` then `if c` is NOT `until: [a, b, c]`: the second keeps looping.
    expect(
      sameMeaning(
        `${TRIGGER}
actions:
  - repeat:
      sequence: [{ delay: "00:00:01" }]
      until:
        - { condition: state, entity_id: light.a, state: "on" }
        - { condition: state, entity_id: light.b, state: "on" }
  - if: [{ condition: state, entity_id: light.c, state: "on" }]
    then: [{ action: light.turn_on }]
`,
        `${TRIGGER}
actions:
  - repeat:
      sequence: [{ delay: "00:00:01" }]
      until:
        - { condition: state, entity_id: light.a, state: "on" }
        - { condition: state, entity_id: light.b, state: "on" }
        - { condition: state, entity_id: light.c, state: "on" }
  - action: light.turn_on
`
      ).length
    ).toBeGreaterThan(0);
  });

  it('a decision with two open branches is not merged with what follows', () => {
    // After `if A then X else Y` both branches continue, so `Z` is not part of either.
    expect(
      sameMeaning(
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ action: light.turn_on }]
    else: [{ action: light.turn_off }]
  - action: notify.example
`,
        `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ action: light.turn_on }]
    else: [{ action: light.turn_off }, { action: notify.example }]
`
      ).length
    ).toBeGreaterThan(0);
  });
});

describe('prose', () => {
  it('is collected separately and never counts as a behavior change', () => {
    const withProse = canonicalizeConfig(
      config(`
alias: Named
description: Says what it is for
${TRIGGER}
actions:
  - alias: Turn it on
    note: Because the room is dark
    action: light.turn_on
`)
    );
    const withoutProse = canonicalizeConfig(
      config(`
${TRIGGER}
actions:
  - action: light.turn_on
`)
    );
    expect(semanticDiff(withProse.canon, withoutProse.canon)).toEqual([]);
    expect(withProse.prose.aliases).toEqual(expect.arrayContaining(['Named', 'Turn it on']));
    expect(withProse.prose.notes).toEqual(
      expect.arrayContaining(['Because the room is dark', 'Says what it is for'])
    );
  });
});

describe("strict mode keeps the author's spelling apart", () => {
  function strictDiff(a: string, b: string): string[] {
    const strict = { strict: true };
    return semanticDiff(
      canonicalizeConfig(config(a), strict).canon,
      canonicalizeConfig(config(b), strict).canon
    );
  }

  const CHOOSE = `${TRIGGER}
actions:
  - choose:
      - conditions: [{ condition: state, entity_id: light.a, state: "on" }]
        sequence: [{ action: light.turn_off, target: { entity_id: light.a } }]
    default:
      - action: light.turn_on
        target: { entity_id: light.c }
`;
  const IF_ELSE = `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ action: light.turn_off, target: { entity_id: light.a } }]
    else: [{ action: light.turn_on, target: { entity_id: light.c } }]
`;

  it('a choose and the equivalent if/else are the same behavior but not the same shape', () => {
    expect(sameMeaning(CHOOSE, IF_ELSE)).toEqual([]);
    expect(strictDiff(CHOOSE, IF_ELSE)).not.toEqual([]);
    expect(strictDiff(CHOOSE, CHOOSE)).toEqual([]);
  });

  it('a guard that stops keeps its shape instead of folding the rest into else', () => {
    const guard = `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ stop: already on }]
  - action: light.turn_on
    target: { entity_id: light.a }
`;
    const folded = `${TRIGGER}
actions:
  - if: [{ condition: state, entity_id: light.a, state: "on" }]
    then: [{ stop: already on }]
    else: [{ action: light.turn_on, target: { entity_id: light.a } }]
`;
    expect(sameMeaning(guard, folded)).toEqual([]);
    expect(strictDiff(guard, folded)).not.toEqual([]);
  });

  it('service: and action: are the same step but not the same spelling', () => {
    const legacy = `${TRIGGER}
actions:
  - service: light.turn_on
    target: { entity_id: light.a }
`;
    const current = `${TRIGGER}
actions:
  - action: light.turn_on
    target: { entity_id: light.a }
`;
    expect(sameMeaning(legacy, current)).toEqual([]);
    expect(strictDiff(legacy, current)).not.toEqual([]);
  });
});
