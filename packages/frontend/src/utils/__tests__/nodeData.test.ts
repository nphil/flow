import { describe, expect, it } from 'vitest';
import { getNodeKind, getNodeSummary } from '../nodeData';

describe('getNodeKind', () => {
  it('maps delay and wait to the shared timing kind', () => {
    expect(getNodeKind('delay', {})).toBe('timing');
    expect(getNodeKind('wait', {})).toBe('timing');
  });

  it('classifies a plain service-call action as action', () => {
    expect(getNodeKind('action', { service: 'light.turn_on' })).toBe('action');
  });

  it('classifies a stop action as flowctl, not action', () => {
    expect(getNodeKind('action', { stop: 'Halt', error: false })).toBe('flowctl');
  });

  it('classifies an opaque preserved repeat/parallel block as flowctl', () => {
    expect(getNodeKind('action', { repeat: { count: 3 } })).toBe('flowctl');
    expect(getNodeKind('action', { parallel: [] })).toBe('flowctl');
  });

  it("classifies YamlParser's unknown-node placeholder as unknown", () => {
    expect(getNodeKind('action', { service: 'unknown.unknown', data: {} })).toBe('unknown');
  });

  it('falls back to unknown for an unrecognized node type', () => {
    expect(getNodeKind('not_a_real_type', {})).toBe('unknown');
    expect(getNodeKind(undefined, {})).toBe('unknown');
  });
});

describe('getNodeSummary', () => {
  it('prefers alias for the title, falling back to the trigger platform label', () => {
    expect(getNodeSummary('trigger', { trigger: 'state', entity_id: 'light.kitchen' })).toEqual({
      title: 'State Change',
      subtitle: 'light.kitchen',
    });
    expect(
      getNodeSummary('trigger', {
        trigger: 'state',
        entity_id: 'light.kitchen',
        alias: 'Kitchen on',
      })
    ).toEqual({ title: 'Kitchen on', subtitle: 'light.kitchen' });
  });

  it('summarizes multiple trigger entities as a count', () => {
    expect(
      getNodeSummary('trigger', { trigger: 'state', entity_id: ['light.a', 'light.b', 'light.c'] })
    ).toEqual({ title: 'State Change', subtitle: '3 entities' });
  });

  it('derives a condition subtitle from entity_id, falling back through template/zone/comparators', () => {
    expect(
      getNodeSummary('condition', { condition: 'state', entity_id: 'binary_sensor.door' })
    ).toEqual({ title: 'State', subtitle: 'binary_sensor.door' });
    expect(getNodeSummary('condition', { condition: 'numeric_state', above: 20 })).toEqual({
      title: 'Numeric',
      subtitle: '> 20',
    });
  });

  it('splits an action service into domain.service for the subtitle when no target entity is set', () => {
    expect(getNodeSummary('action', { service: 'light.turn_on' })).toEqual({
      title: 'turn_on',
      subtitle: 'light.turn_on',
    });
  });

  it('prefers the target entity over the raw service string for the subtitle', () => {
    expect(
      getNodeSummary('action', {
        service: 'light.turn_on',
        target: { entity_id: 'light.living_room' },
      })
    ).toEqual({ title: 'turn_on', subtitle: 'light.living_room' });
  });

  it('renders a stop action distinctly, using its message as the subtitle', () => {
    expect(getNodeSummary('action', { stop: 'Door still open' })).toEqual({
      title: 'Stop',
      subtitle: 'Door still open',
    });
    expect(getNodeSummary('action', { stop: '', error: true })).toEqual({
      title: 'Stop (error)',
      subtitle: 'Halts the automation',
    });
  });

  it('labels the unknown-node placeholder without leaking its raw preserved payload', () => {
    expect(getNodeSummary('action', { service: 'unknown.unknown', data: { foo: 'bar' } })).toEqual({
      title: 'Unknown Node',
      subtitle: 'Unrecognized — preserved',
    });
  });
});
