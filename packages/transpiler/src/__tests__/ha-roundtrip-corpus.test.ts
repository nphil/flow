// @vitest-environment node
//
// Semantic round-trip corpus: every file under __tests__/ha-roundtrip-fixtures
// is ONE Home Assistant automation or script config (as stored by HA). Flow
// must open it, save it back out unchanged, and the saved config must mean
// exactly the same thing (see src/semantic/canonicalize.ts for the definition
// of "same"). This is the offline twin of `yarn verify:ha`, which runs the
// same check against a live Home Assistant.
//
// The fixtures are synthetic on purpose: the repository is public, so they use
// generic entity ids and never copy a real installation's automations.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { glob } from 'glob';
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { isJson, roundTripConfig } from '../semantic';

const FIXTURES_DIR = join(__dirname, '../../../../__tests__/ha-roundtrip-fixtures');

/**
 * Fixtures Flow does not round-trip yet, with the reason. Each entry is
 * asserted to STILL fail (`it.fails`), so fixing a construct without removing
 * its entry here turns the suite red -- the list cannot rot. The goal state is
 * an empty list.
 */
const KNOWN_GAPS: Record<string, string> = {};

const fixtureFiles = glob.sync('**/*.yaml', { cwd: FIXTURES_DIR }).sort();
const transpiler = new FlowTranspiler();

function loadFixture(file: string): unknown {
  return yamlLoad(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
}

describe('HA round-trip corpus', () => {
  it('has fixtures', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    const run = file in KNOWN_GAPS ? it.fails : it;

    run(`${file} opens and saves back without semantic change`, async () => {
      const original = loadFixture(file);
      if (!isJson(original)) throw new Error(`${file} is not a plain JSON-compatible document`);

      const result = await roundTripConfig(transpiler, original);

      expect(result.errors, `${file}: ${result.errors.join('\n')}`).toEqual([]);
      expect(result.diffs, `${file} changed meaning:\n${result.diffs.join('\n')}`).toEqual([]);
      expect(result.status).toBe('ok');
      expect(result.lostAliases, `${file} lost aliases`).toEqual([]);
      expect(result.lostNotes, `${file} lost notes`).toEqual([]);
    });
  }

  it('lists only fixtures that exist', () => {
    const known = Object.keys(KNOWN_GAPS).map((f) => relative('.', f));
    for (const gap of known) expect(fixtureFiles).toContain(gap);
  });
});
