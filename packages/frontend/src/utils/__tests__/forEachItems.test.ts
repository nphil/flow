import { describe, expect, it } from 'vitest';
import {
  forEachItemsToLines,
  forEachItemsToYaml,
  hasComplexForEachItems,
  linesToForEachItems,
  parseForEachYaml,
} from '../forEachItems';

describe('hasComplexForEachItems', () => {
  it('is false for a list of plain scalars', () => {
    expect(hasComplexForEachItems(['light.kitchen', 'light.bedroom', 42, true])).toBe(false);
  });

  it('is true when any item is an object or array', () => {
    expect(
      hasComplexForEachItems(['light.kitchen', { entity: 'light.bedroom', brightness: 80 }])
    ).toBe(true);
    expect(hasComplexForEachItems([[1, 2, 3]])).toBe(true);
  });

  it('is true when any item is a multi-line string, since one line cannot hold it', () => {
    expect(hasComplexForEachItems(['line1\nline2'])).toBe(true);
  });

  it('is false for an empty list', () => {
    expect(hasComplexForEachItems([])).toBe(false);
  });
});

describe('lines <-> array round-trip (scalar editor)', () => {
  it('renders one scalar per line and parses back the same array', () => {
    const items = ['light.kitchen', 'light.bedroom'];
    const text = forEachItemsToLines(items);
    expect(text).toBe('light.kitchen\nlight.bedroom');
    expect(linesToForEachItems(text)).toEqual(items);
  });

  it('preserves numeric and boolean scalar types across the round-trip', () => {
    const items = [1, 2, 3, true, false];
    expect(linesToForEachItems(forEachItemsToLines(items))).toEqual(items);
  });

  it('does not coerce a non-numeric string that merely starts with digits', () => {
    expect(linesToForEachItems('123abc')).toEqual(['123abc']);
  });

  it('drops blank lines but keeps an explicit empty-string item', () => {
    expect(linesToForEachItems('a\n\nb\n')).toEqual(['a', 'b']);
    expect(linesToForEachItems("a\n''\nb")).toEqual(['a', '', 'b']);
  });

  it('parses an empty textarea as an empty array', () => {
    expect(linesToForEachItems('')).toEqual([]);
    expect(linesToForEachItems('   \n  ')).toEqual([]);
  });

  it('falls back to the raw line text if a line fails to parse as YAML', () => {
    // An unterminated flow mapping is invalid YAML on its own line.
    expect(linesToForEachItems('{unterminated')).toEqual(['{unterminated']);
  });
});

describe('YAML block round-trip (complex-items editor)', () => {
  it('dumps and reparses a list of objects to an equal array', () => {
    const items = [{ entity_id: 'light.kitchen', brightness: 80 }, { entity_id: 'light.bedroom' }];
    const yaml = forEachItemsToYaml(items);
    expect(parseForEachYaml(yaml)).toEqual(items);
  });

  it('treats a cleared textarea as an empty array', () => {
    expect(parseForEachYaml('')).toEqual([]);
  });

  it('returns null (not a corrupted empty array) for unparseable or non-array YAML', () => {
    expect(parseForEachYaml('- a\n  - unbalanced: [')).toBeNull();
    expect(parseForEachYaml('just_a_scalar')).toBeNull();
    expect(parseForEachYaml('key: value')).toBeNull();
  });
});
