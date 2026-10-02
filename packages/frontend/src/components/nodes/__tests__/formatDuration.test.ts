import { describe, expect, it } from 'vitest';
import { durationToMs, formatDuration } from '../formatDuration';

describe('formatDuration', () => {
  it('spells out HA time strings, numbers and objects', () => {
    expect(formatDuration('00:05:00')).toBe('5 min');
    expect(formatDuration('01:30')).toBe('1 h 30 min');
    expect(formatDuration(90)).toBe('1 min 30 s');
    expect(formatDuration({ hours: 2 })).toBe('2 h');
    expect(formatDuration({ seconds: 1, milliseconds: 500 })).toBe('1 s 500 ms');
    expect(formatDuration({})).toBe('0 s');
  });

  it('returns an empty string when unset', () => {
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration('')).toBe('');
  });

  it('keeps templated values as written', () => {
    expect(formatDuration('{{ x }}')).toBe('{{ x }}');
    expect(formatDuration({ minutes: '{{ x }}' })).toBe('{{ x }} min');
  });
});

describe('durationToMs', () => {
  it('reads numeric strings inside duration objects as numbers, not text', () => {
    expect(durationToMs({ minutes: '5', milliseconds: '250' })).toBe(300_250);
  });

  it('returns null for templates', () => {
    expect(durationToMs({ minutes: '{{ x }}' })).toBeNull();
    expect(durationToMs('{{ x }}')).toBeNull();
  });
});
