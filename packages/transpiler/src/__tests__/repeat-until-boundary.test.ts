/**
 * Regression: an `if → then(stop)` guard followed by `repeat.until` used to
 * produce a handle-less edge from the if-condition into the loop body, which
 * failed graph validation and made the automation impossible to open
 * ("Edge ... from condition node must have sourceHandle 'true' or 'false'").
 *
 * Also covers the round-trip boundary: conditions that FOLLOW the loop
 * (trailing guard) must not be absorbed into `repeat.until`.
 *
 * Shape distilled from the live "Back Deck - Door auto-lock" automation.
 */
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../index';

const YAML = `
alias: Guarded until loop
triggers:
  - trigger: state
    entity_id: binary_sensor.door
    to: "off"
actions:
  - alias: Already locked? Done.
    if:
      - condition: state
        entity_id: lock.door
        state: locked
    then:
      - stop: locked by hand
  - repeat:
      sequence:
        - delay: "00:00:30"
      until:
        - condition: state
          entity_id: binary_sensor.deck
          state: "off"
          for: "00:05:00"
        - condition: state
          entity_id: binary_sensor.yard
          state: "off"
          for: "00:05:00"
  - alias: Still unlocked? Lock it.
    if:
      - condition: state
        entity_id: lock.door
        state: unlocked
    then:
      - service: lock.lock
        target:
          entity_id: lock.door
`;

describe('repeat.until after an if-guard', () => {
  it('opens: every condition edge carries a boolean handle', async () => {
    const t = new FlowTranspiler();
    const res = await t.fromYaml(YAML);
    expect(res.success).toBe(true);
    expect(res.errors ?? []).toEqual([]);
    const g = res.graph!;
    const conditionIds = new Set(
      g.nodes.filter((n) => n.type === 'condition').map((n) => n.id)
    );
    for (const e of g.edges) {
      if (!conditionIds.has(e.source)) continue;
      expect(['true', 'false']).toContain(e.sourceHandle);
    }
  });

  it('routes the if-guard FALSE path into the loop body', async () => {
    const t = new FlowTranspiler();
    const res = await t.fromYaml(YAML);
    const g = res.graph!;
    const delay = g.nodes.find((n) => n.type === 'delay')!;
    const guard = g.nodes.find((n) => {
      if (n.type !== 'condition') return false;
      const alias = 'alias' in n.data ? n.data.alias : undefined;
      return typeof alias === 'string' && alias.includes('locked');
    })!;
    const edge = g.edges.find((e) => e.source === guard.id && e.target === delay.id)!;
    expect(edge.sourceHandle).toBe('false');
  });

  it('emits a false back-edge from every until condition', async () => {
    const t = new FlowTranspiler();
    const res = await t.fromYaml(YAML);
    const g = res.graph!;
    const delay = g.nodes.find((n) => n.type === 'delay')!;
    // Until conditions are the ones testing deck/yard; each must loop back.
    const untilConds = g.nodes.filter((n) => {
      if (n.type !== 'condition') return false;
      const entity = 'entity_id' in n.data ? n.data.entity_id : undefined;
      return entity === 'binary_sensor.deck' || entity === 'binary_sensor.yard';
    });
    expect(untilConds.length).toBe(2);
    for (const cond of untilConds) {
      const back = g.edges.find(
        (e) => e.source === cond.id && e.target === delay.id && e.sourceHandle === 'false'
      );
      expect(back).toBeDefined();
    }
  });

  it('round-trips without absorbing the trailing guard into until', async () => {
    const t = new FlowTranspiler();
    const res = await t.fromYaml(YAML);
    const yaml = t.toYaml(res.graph!);
    const untilBlock = /until:([\s\S]*?)sequence:/.exec(yaml)?.[1] ?? '';
    expect(untilBlock).toContain('binary_sensor.deck');
    expect(untilBlock).toContain('binary_sensor.yard');
    expect(untilBlock).not.toContain('lock.door');

    // The trailing guard survives as a conditional, and the lock action
    // remains guarded (never a bare top-level lock.lock).
    expect(yaml).toContain('state: unlocked');
    const roundTripped = await t.fromYaml(yaml);
    expect(roundTripped.success).toBe(true);
  });
});
