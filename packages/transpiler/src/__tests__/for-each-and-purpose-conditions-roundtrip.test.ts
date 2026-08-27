import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { YamlParser } from '../parser/YamlParser';

describe('repeat.for_each (additive, alongside count/while/until)', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  const yaml = `
alias: For Each Loop
description: Test for_each
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      for_each:
        - light.kitchen
        - light.living_room
        - light.bedroom
      sequence:
        - action: light.turn_on
          target:
            entity_id: "{{ repeat.item }}"
mode: single
`;

  it('parses repeat.for_each into a single editable action node (not the generic unknown fallback)', async () => {
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.graph).toBeDefined();

    const graph = result.graph!;
    // 1 trigger + 1 action (the for_each node itself, sequence stays opaque)
    expect(graph.nodes.length).toBe(2);

    const actionNode = graph.nodes.find((n) => n.type === 'action')!;
    expect(actionNode).toBeDefined();
    const repeat = actionNode.data.repeat as { for_each?: unknown[]; sequence?: unknown[] };
    expect(repeat).toBeDefined();
    expect(repeat.for_each).toEqual(['light.kitchen', 'light.living_room', 'light.bedroom']);
    expect(Array.isArray(repeat.sequence)).toBe(true);
    expect(repeat.sequence).toHaveLength(1);
  });

  it('transpiles back to YAML with repeat.for_each intact, byte-stable modulo formatting', async () => {
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);

    const outputYaml = transpiler.toYaml(result.graph!);
    expect(outputYaml).toContain('for_each');
    expect(outputYaml).toContain('light.kitchen');
    expect(outputYaml).toContain('light.living_room');
    expect(outputYaml).toContain('light.bedroom');
    expect(outputYaml).toContain('sequence');
    expect(outputYaml).toContain('light.turn_on');
    expect(outputYaml).toContain('repeat.item');
    // Must NOT silently drop for_each in favor of an incomplete repeat block —
    // this was the real bug found while implementing this feature: the
    // pre-existing opaque-repeat build path only whitelisted count/while/until.
    expect(outputYaml).not.toMatch(/repeat:\s*\n\s*sequence:/); // repeat: with ONLY sequence (for_each missing)
  });

  it('supports complex (object) items alongside scalar items', async () => {
    const complexYaml = `
alias: For Each Complex
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      for_each:
        - entity: light.kitchen
          brightness: 100
        - entity: light.bedroom
          brightness: 40
      sequence:
        - action: light.turn_on
          target:
            entity_id: "{{ repeat.item.entity }}"
          data:
            brightness_pct: "{{ repeat.item.brightness }}"
mode: single
`;
    const result = await parser.parse(complexYaml);
    expect(result.success).toBe(true);
    const actionNode = result.graph!.nodes.find((n) => n.type === 'action')!;
    const repeat = actionNode.data.repeat as { for_each?: unknown[] };
    expect(repeat.for_each).toEqual([
      { entity: 'light.kitchen', brightness: 100 },
      { entity: 'light.bedroom', brightness: 40 },
    ]);

    const outputYaml = transpiler.toYaml(result.graph!);
    expect(outputYaml).toContain('brightness: 100');
    expect(outputYaml).toContain('brightness: 40');
  });

  it('does not regress the pre-existing "unknown repeat type" fallback for a genuinely malformed repeat block', async () => {
    // No count/while/until/for_each key at all — must still fall into the
    // generic opaque fallback (existing behavior, untouched by this change).
    const malformedYaml = `
alias: Malformed Repeat
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
actions:
  - repeat:
      sequence:
        - action: light.turn_on
mode: single
`;
    const result = await parser.parse(malformedYaml);
    expect(result.success).toBe(true);
    const actionNode = result.graph!.nodes.find((n) => n.type === 'action')!;
    expect(actionNode.data.repeat).toBeDefined();
  });
});

describe('A3: purpose-specific ("integration") conditions round-trip byte-identical', () => {
  const parser = new YamlParser();
  const transpiler = new FlowTranspiler();

  async function roundTrip(conditionYaml: string) {
    const yaml = `
alias: Integration Condition Test
triggers:
  - trigger: state
    entity_id: sensor.probe
    to: "on"
conditions:
${conditionYaml}
actions:
  - action: light.turn_on
    target:
      entity_id: light.kitchen
mode: single
`;
    const result = await parser.parse(yaml);
    expect(result.success).toBe(true);
    const graph = result.graph!;
    const conditionNode = graph.nodes.find((n) => n.type === 'condition');
    expect(conditionNode).toBeDefined();
    const outputYaml = transpiler.toYaml(graph);
    return { graph, conditionNode: conditionNode!, outputYaml };
  }

  it('climate.is_heating: keeps its real condition type, not template', async () => {
    const { conditionNode, outputYaml } = await roundTrip(
      [
        '  - condition: climate.is_heating',
        '    target:',
        '      entity_id: climate.living_room',
      ].join('\n')
    );

    expect(conditionNode.data.condition).toBe('climate.is_heating');
    expect((conditionNode.data as { target?: { entity_id?: string } }).target?.entity_id).toBe(
      'climate.living_room'
    );

    expect(outputYaml).toContain('condition: climate.is_heating');
    expect(outputYaml).toContain('climate.living_room');
    // The old bug: unrecognized types got coerced to `condition: template`
    // while keeping unrelated fields, producing invalid template conditions.
    expect(outputYaml).not.toContain('condition: template');
  });

  it('battery.is_level: keeps target + nested options.threshold intact', async () => {
    const { conditionNode, outputYaml } = await roundTrip(
      [
        '  - condition: battery.is_level',
        '    target:',
        '      entity_id: sensor.front_door_sensor_battery',
        '    options:',
        '      threshold:',
        '        type: below',
        '        value:',
        '          number: 20',
      ].join('\n')
    );

    expect(conditionNode.data.condition).toBe('battery.is_level');
    const options = (conditionNode.data as { options?: Record<string, unknown> }).options;
    expect(options).toEqual({ threshold: { type: 'below', value: { number: 20 } } });

    expect(outputYaml).toContain('condition: battery.is_level');
    expect(outputYaml).toContain('threshold');
    expect(outputYaml).toContain('type: below');
    expect(outputYaml).not.toContain('condition: template');
  });

  it('motion.is_detected: round-trips a label-based target', async () => {
    const { conditionNode, outputYaml } = await roundTrip(
      ['  - condition: motion.is_detected', '    target:', '      label_id: entryway_sensors'].join(
        '\n'
      )
    );

    expect(conditionNode.data.condition).toBe('motion.is_detected');
    expect((conditionNode.data as { target?: { label_id?: string } }).target?.label_id).toBe(
      'entryway_sensors'
    );
    expect(outputYaml).toContain('condition: motion.is_detected');
    expect(outputYaml).toContain('entryway_sensors');
    expect(outputYaml).not.toContain('condition: template');
  });

  it('a genuinely unlisted condition type still round-trips (top-level conditions list uses schema passthrough, not the VALID_CONDITIONS-gated choose/nested-group path)', async () => {
    const { conditionNode, outputYaml } = await roundTrip(
      ['  - condition: totally_made_up_thing', '    entity_id: sensor.x'].join('\n')
    );
    // This specific path (top-level `conditions:` array) parses each entry
    // directly via HAConditionSchema, which never coerces `condition` at all
    // — VALID_CONDITIONS-gated coercion to 'template' only happens in the
    // and/or/not nested-group transform and the choose-block condition
    // builder (both fixed by the A3 catalog extension above). Documenting
    // the actual (already-safe) behavior here rather than a wrong assumption.
    expect(conditionNode.data.condition).toBe('totally_made_up_thing');
    expect(outputYaml).toContain('condition: totally_made_up_thing');
  });

  it('legacy structural condition types are unaffected (state still works exactly as before)', async () => {
    const { conditionNode, outputYaml } = await roundTrip(
      ['  - condition: state', '    entity_id: sensor.x', '    state: "on"'].join('\n')
    );
    expect(conditionNode.data.condition).toBe('state');
    expect(outputYaml).toContain('condition: state');
  });

  it('battery.is_level nested inside an `and` group keeps its real type (the VALID_CONDITIONS-gated path)', async () => {
    const { conditionNode, outputYaml } = await roundTrip(
      [
        '  - condition: and',
        '    conditions:',
        '      - condition: battery.is_level',
        '        target:',
        '          entity_id: sensor.front_door_sensor_battery',
        '        options:',
        '          threshold:',
        '            type: below',
        '            value:',
        '              number: 20',
        '      - condition: state',
        '        entity_id: sensor.x',
        '        state: "on"',
      ].join('\n')
    );
    expect(conditionNode.data.condition).toBe('and');
    const nested = conditionNode.data.conditions as Array<{ condition: string }>;
    expect(nested[0].condition).toBe('battery.is_level');
    expect(nested[1].condition).toBe('state');
    expect(outputYaml).toContain('condition: battery.is_level');
    expect(outputYaml).not.toContain('condition: template');
  });
});
