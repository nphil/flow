// Regression coverage for the three confirmed sources of lost human prose
// (alias/note) diagnosed against live Home Assistant automations:
//
//   1. GENERATOR: `buildCondition`/`mapSingleCondition` in native.ts used to
//      destructure `alias` off a condition's data and never re-add it, so
//      every condition inside an `if:`/`choose[].conditions:` list lost its
//      own alias on save.
//   2. GENERATOR: `buildRepeatBlock`'s `until` branch declared a local
//      `alias` variable but never assigned it (dead code), and never read a
//      `note` at all, so a repeat block's own alias/note never made it into
//      the regenerated YAML for any loop type.
//   3. PARSER: some step-level prose (a non-empty-body repeat block's own
//      alias/note, and a `note:` on a `stop:` step) was dropped before it
//      ever reached a node, so no generator fix could recover it.
//
// The fix separates *display* alias (`data.alias`, unchanged: the canvas
// title, preferring an enclosing step's alias when present) from *source*
// prose (`conditionAlias`/`stepAlias`/`stepNote`/`blockAlias`/`blockNote`),
// so the generator never has to guess — and never fabricates one kind of
// prose as another.
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';

type YamlCondition = Record<string, unknown>;
type YamlStep = Record<string, unknown>;

describe('condition alias vs. step alias (no fabrication)', () => {
  // Shape distilled from the live "Back Deck - Door auto-lock" automation:
  // a step with its own alias wrapping a single condition with a DIFFERENT
  // alias of its own. A trailing action after the if-block keeps the
  // condition from being promoted to the root `conditions:` block, so this
  // exercises the same `if:` code path the live automation uses.
  const YAML = `
alias: Trap test
triggers:
  - trigger: state
    entity_id: binary_sensor.door
    to: "off"
actions:
  - alias: Already locked manually? Done.
    if:
      - alias: Lock reads locked
        condition: state
        entity_id: lock.door
        state: locked
    then:
      - stop: Locked manually - nothing to automate
  - action: lock.lock
    target:
      entity_id: lock.door
mode: single
`;

  it('parses the step alias and condition alias into separate fields, neither overwriting the other', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    expect(result.success).toBe(true);

    const condition = result.graph!.nodes.find((n) => n.type === 'condition')!;
    const data = condition.data as Record<string, unknown>;

    // Display alias is UNCHANGED behavior: the enclosing step's alias wins
    // for the canvas title.
    expect(data.alias).toBe('Already locked manually? Done.');
    // But the condition's own alias and the step's alias are now both
    // recoverable, independently, from the same node.
    expect(data.conditionAlias).toBe('Lock reads locked');
    expect(data.stepAlias).toBe('Already locked manually? Done.');
  });

  it('round-trips both aliases into their original positions with neither fabricated nor dropped', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    const yaml = transpiler.toYaml(result.graph!);

    const parsed = yamlLoad(yaml) as { actions: YamlStep[] };
    const step = parsed.actions[0];
    const ifConditions = step.if as YamlCondition[];

    // The step keeps its own alias...
    expect(step.alias).toBe('Already locked manually? Done.');
    // ...and the condition inside `if:` keeps ITS own alias...
    expect(ifConditions[0].alias).toBe('Lock reads locked');
    // ...and critically, they are not the same value copied twice: the
    // step's alias was never fabricated onto the condition.
    expect(ifConditions[0].alias).not.toBe(step.alias);

    // Idempotent: re-parsing the regenerated YAML must reproduce the exact
    // same split, not slowly erode or duplicate prose on repeated saves.
    const reparsed = await transpiler.fromYaml(yaml);
    const condition2 = reparsed.graph!.nodes.find((n) => n.type === 'condition')!;
    const data2 = condition2.data as Record<string, unknown>;
    expect(data2.alias).toBe('Already locked manually? Done.');
    expect(data2.conditionAlias).toBe('Lock reads locked');
    expect(data2.stepAlias).toBe('Already locked manually? Done.');
  });
});

describe('repeat block prose (alias, note, and per-condition aliases)', () => {
  // Shape distilled from the live "Back Deck - Door auto-lock" automation's
  // `repeat.until` block: the block has its own alias AND note, the loop
  // body is non-empty (a delay), and both until-conditions carry their own
  // aliases too. This is exactly the combination the parser used to drop
  // (block prose) or the generator used to drop (per-condition aliases).
  const YAML = `
alias: Repeat prose test
triggers:
  - trigger: state
    entity_id: binary_sensor.door
    to: "off"
actions:
  - alias: Wait until deck AND yard are clear for 5 min
    note: Checks every 30s. Uses held state, so occupancy already clear counts immediately.
    repeat:
      sequence:
        - alias: Check again in 30 seconds
          delay: "00:00:30"
      until:
        - alias: Back Deck clear 5 min
          condition: state
          entity_id: binary_sensor.back_deck_occupancy
          state: "off"
          for: "00:05:00"
        - alias: Backyard clear 5 min
          condition: state
          entity_id: binary_sensor.backyard_occupancy
          state: "off"
          for: "00:05:00"
mode: single
`;

  it('carries the block alias/note and every until-condition alias on the parsed graph', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    expect(result.success).toBe(true);

    const conditions = result.graph!.nodes.filter((n) => n.type === 'condition');
    expect(conditions).toHaveLength(2);
    const [first, second] = conditions.map((n) => n.data as Record<string, unknown>);

    // The block's own prose rides on the loop's first condition node (the
    // repeat step itself has no dedicated canvas node), regardless of the
    // non-empty loop body.
    expect(first.blockAlias).toBe('Wait until deck AND yard are clear for 5 min');
    expect(first.blockNote).toBe(
      'Checks every 30s. Uses held state, so occupancy already clear counts immediately.'
    );
    // Every until-condition keeps its own alias, independent of the block.
    expect(first.conditionAlias).toBe('Back Deck clear 5 min');
    expect(second.conditionAlias).toBe('Backyard clear 5 min');
    // Only the first condition carries the block's prose.
    expect(second.blockAlias).toBeUndefined();
    expect(second.blockNote).toBeUndefined();
  });

  it('round-trips the block alias, block note, and both until-condition aliases', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    const yaml = transpiler.toYaml(result.graph!);

    const parsed = yamlLoad(yaml) as { actions: YamlStep[] };
    const step = parsed.actions[0];
    const repeat = step.repeat as { until: YamlCondition[] };

    expect(step.alias).toBe('Wait until deck AND yard are clear for 5 min');
    expect(step.note).toBe(
      'Checks every 30s. Uses held state, so occupancy already clear counts immediately.'
    );
    expect(repeat.until[0].alias).toBe('Back Deck clear 5 min');
    expect(repeat.until[1].alias).toBe('Backyard clear 5 min');

    // Idempotent across a second round-trip.
    const reparsed = await transpiler.fromYaml(yaml);
    const yaml2 = transpiler.toYaml(reparsed.graph!);
    expect(yamlLoad(yaml2)).toEqual(yamlLoad(yaml));
  });
});

describe('stop step note inside a choose branch', () => {
  // Shape distilled from the live "Back Deck - Door auto-lock" automation's
  // first choose branch: a `stop:` step carries a `note:` explaining why the
  // branch is a safe no-op. A second branch keeps the choose block from
  // collapsing to a single promoted condition, matching the live shape.
  const YAML = `
alias: Stop note test
triggers:
  - trigger: state
    entity_id: binary_sensor.door
    to: "on"
    id: door_opened
  - trigger: state
    entity_id: binary_sensor.door
    to: "off"
    id: door_closed
actions:
  - choose:
      - alias: Door opened - cancel any pending auto-lock
        conditions:
          - condition: trigger
            id: door_opened
        sequence:
          - alias: Stop - door is open, nothing to lock
            note: mode restart already killed any run that was mid-wait.
            stop: Door reopened - pending auto-lock cancelled
      - alias: Door closed - lock once outside is clear
        conditions:
          - condition: trigger
            id: door_closed
        sequence:
          - action: lock.lock
            target:
              entity_id: lock.door
mode: restart
`;

  it('parses the note onto the stop action node', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    expect(result.success).toBe(true);

    const stopNode = result.graph!.nodes.find(
      (n) => n.type === 'action' && (n.data as Record<string, unknown>).stop !== undefined
    )!;
    const data = stopNode.data as Record<string, unknown>;
    expect(data.stop).toBe('Door reopened - pending auto-lock cancelled');
    expect(data.alias).toBe('Stop - door is open, nothing to lock');
    expect(data.note).toBe('mode restart already killed any run that was mid-wait.');
  });

  it('keeps the note next to `stop:` in the regenerated YAML', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    const yaml = transpiler.toYaml(result.graph!);

    expect(yaml).toContain('stop: Door reopened - pending auto-lock cancelled');
    expect(yaml).toContain('note: mode restart already killed any run that was mid-wait.');
  });
});

describe('nested and/or/not condition groups (no fabrication, bonus coverage)', () => {
  // A condition GROUP (here `or`) can itself carry its own alias, distinct
  // from the wrapping step's alias — the exact same trap as a simple
  // condition, just one level deeper in the `mapCondition` recursion.
  const YAML = `
alias: Nested group test
triggers:
  - trigger: state
    entity_id: binary_sensor.motion
    to: "on"
    id: motion
actions:
  - alias: Motion while dark or armed
    if:
      - alias: Dark or armed
        condition: or
        conditions:
          - condition: numeric_state
            entity_id: sensor.lux
            below: 10
          - condition: state
            entity_id: alarm_control_panel.home
            state: armed_away
    then:
      - action: light.turn_on
  - action: light.turn_off
mode: single
`;

  it('keeps the group alias distinct from the step alias, in the graph and in YAML', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    expect(result.success).toBe(true);

    const orNode = result.graph!.nodes.find(
      (n) => n.type === 'condition' && (n.data as Record<string, unknown>).condition === 'or'
    )!;
    const data = orNode.data as Record<string, unknown>;
    expect(data.alias).toBe('Motion while dark or armed');
    expect(data.conditionAlias).toBe('Dark or armed');

    const yaml = transpiler.toYaml(result.graph!);
    const parsed = yamlLoad(yaml) as { actions: YamlStep[] };
    const ifConditions = parsed.actions[0].if as YamlCondition[];
    expect(ifConditions[0].alias).toBe('Dark or armed');
    expect(parsed.actions[0].alias).toBe('Motion while dark or armed');
  });
});

describe("a choose branch's own note (bonus coverage)", () => {
  // Flow canonically converts `choose:`/`default:` into nested if/then/else
  // on save; a choose branch's own `note:` must survive that conversion the
  // same way its `alias:` already did, riding on the converted if-step.
  const YAML = `
alias: Choose note test
triggers:
  - trigger: state
    entity_id: binary_sensor.a
    to: "on"
    id: a_on
  - trigger: state
    entity_id: binary_sensor.b
    to: "on"
    id: b_on
actions:
  - choose:
      - alias: Branch A
        note: Explains branch A reasoning
        conditions:
          - condition: trigger
            id: a_on
        sequence:
          - action: light.turn_on
      - alias: Branch B
        conditions:
          - condition: trigger
            id: b_on
        sequence:
          - action: light.turn_off
mode: single
`;

  it('round-trips the branch note via the converted if-step', async () => {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(YAML);
    expect(result.success).toBe(true);

    const yaml = transpiler.toYaml(result.graph!);
    const parsed = yamlLoad(yaml) as { actions: YamlStep[] };
    const step = parsed.actions[0];
    expect(step.alias).toBe('Branch A');
    expect(step.note).toBe('Explains branch A reasoning');
  });
});
