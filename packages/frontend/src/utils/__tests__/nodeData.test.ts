import { describe, expect, it } from 'vitest';
import { getNodeKind } from '../nodeData';

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

  it('classifies a step the parser keeps verbatim as unknown', () => {
    expect(getNodeKind('action', { verbatimStep: { scene: 'scene.movie_night' } })).toBe('unknown');
  });

  it('falls back to unknown for an unrecognized node type', () => {
    expect(getNodeKind('not_a_real_type', {})).toBe('unknown');
    expect(getNodeKind(undefined, {})).toBe('unknown');
  });
});
