// @vitest-environment node
//
// Semantic round-trip corpus: every file under __tests__/ha-roundtrip-fixtures
// is ONE Home Assistant automation or script config (as stored by HA). Flow
// must open it, save it back out unchanged, and the saved config must mean
// exactly the same thing (see src/semantic/canonicalize.ts for the definition
// of "same"). This is the offline twin of `yarn verify:ha`, which runs the
// same check against a live Home Assistant.
//
// The comparison is STRICT: besides what the config does, it keeps the author's spelling of the
// constructs Flow could silently rewrite (`choose` stays `choose`, `service:` stays `service:`).
//
// The fixtures are synthetic on purpose: the repository is public, so they use
// generic entity ids and never copy a real installation's automations.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FlowKind } from '@flow/shared';
import { glob } from 'glob';
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { isJson, isJsonObject, roundTripConfig } from '../semantic';

const FIXTURES_DIR = join(__dirname, '../../../../__tests__/ha-roundtrip-fixtures');

/**
 * Fixtures Flow does not round-trip yet, with the reason. Each entry is
 * asserted to STILL fail (`it.fails`), so fixing a construct without removing
 * its entry here turns the suite red -- the list cannot rot. The goal state is
 * an empty list, and that is where it is.
 */
const KNOWN_GAPS: Record<string, string> = {};

const fixtureFiles = glob.sync('**/*.yaml', { cwd: FIXTURES_DIR }).sort();
const transpiler = new FlowTranspiler();

function loadFixture(file: string): unknown {
  return yamlLoad(readFileSync(join(FIXTURES_DIR, file), 'utf8'));
}

/** What the config is saved as, known from the folder like the app knows it from the list. */
function kindOf(file: string): FlowKind {
  return file.startsWith('scripts/') ? 'script' : 'automation';
}

/** The fixtures made from a blueprint: Home Assistant fills in their steps, Flow has none to show. */
const blueprintFiles = fixtureFiles.filter((file) => {
  const config = loadFixture(file);
  return isJson(config) && isJsonObject(config) && 'use_blueprint' in config;
});

describe('HA round-trip corpus', () => {
  it('has fixtures', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    const run = file in KNOWN_GAPS ? it.fails : it;

    run(`${file} opens and saves back without semantic change`, async () => {
      const original = loadFixture(file);
      if (!isJson(original)) throw new Error(`${file} is not a plain JSON-compatible document`);

      const result = await roundTripConfig(transpiler, original, {
        strict: true,
        kind: kindOf(file),
      });

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

describe('HA round-trip corpus: configs made from a blueprint', () => {
  it('has blueprint instances of both kinds', () => {
    expect(blueprintFiles.map(kindOf)).toContain('automation');
    expect(blueprintFiles.map(kindOf)).toContain('script');
  });

  for (const file of blueprintFiles) {
    it(`${file} opens read-only, with the blueprint named and no steps`, async () => {
      const original = loadFixture(file);
      if (!isJson(original) || !isJsonObject(original)) throw new Error(`${file} is not a mapping`);

      const parsed = await transpiler.fromYaml(JSON.stringify(original), { kind: kindOf(file) });

      expect(parsed.success, parsed.errors?.join('\n')).toBe(true);
      const graph = parsed.graph;
      expect(graph?.kind).toBe(kindOf(file));
      expect(graph?.blueprint?.use_blueprint).toEqual(original.use_blueprint);
      // Home Assistant builds the steps from the blueprint: there is nothing to draw or edit.
      expect(graph?.nodes).toEqual([]);
      expect(graph?.edges).toEqual([]);
    });

    it(`${file} is written back exactly as read, without the settings Flow adds to its own`, async () => {
      const original = loadFixture(file);
      if (!isJson(original) || !isJsonObject(original)) throw new Error(`${file} is not a mapping`);

      const parsed = await transpiler.fromYaml(JSON.stringify(original), { kind: kindOf(file) });
      if (!parsed.graph) throw new Error('did not open');
      const result = transpiler.transpile(parsed.graph);

      // No mode, no variables, no canvas layout: any of them would override the blueprint's own.
      const { id: _id, ...expected } = original;
      const config = result.config ?? {};
      expect(config.use_blueprint).toEqual(original.use_blueprint);
      expect(Object.keys(config).sort()).toEqual(
        Object.keys(expected)
          .filter((key) => key !== 'description' || expected.description !== '')
          .sort()
      );
    });
  }
});

describe('HA round-trip corpus: canvas positions', () => {
  // Positions are saved in `_cafe_metadata` by node id, and the ids are handed out again in the
  // order the parser meets the nodes: the saved order has to be that order or nodes trade places.
  for (const file of fixtureFiles.filter((f) => !blueprintFiles.includes(f))) {
    it(`${file} keeps every node where it was dragged to`, async () => {
      const kind = kindOf(file);
      const original = loadFixture(file);
      if (!isJson(original)) throw new Error(`${file} is not a plain JSON-compatible document`);

      const opened = await transpiler.fromYaml(JSON.stringify(original), { kind });
      const { graph, nodePathMap } = opened;
      if (!graph || !nodePathMap) throw new Error(`${file} did not open`);

      // Drag every node somewhere of its own; a node is told apart by the step it stands for.
      const draggedTo = new Map<string, { x: number; y: number }>();
      graph.nodes.forEach((node, index) => {
        node.position = { x: 1000 + index * 37, y: 5 + index * 11 };
        const path = nodePathMap.nodeToPaths[node.id]?.[0];
        if (path !== undefined) draggedTo.set(path, node.position);
      });

      const reopened = await transpiler.fromYaml(transpiler.toYaml(graph), { kind });
      const reopenedPaths = reopened.nodePathMap;
      if (!reopened.graph || !reopenedPaths) throw new Error(`${file} did not open again`);
      const placedAt = new Map<string, { x: number; y: number }>();
      for (const node of reopened.graph.nodes) {
        const path = reopenedPaths.nodeToPaths[node.id]?.[0];
        if (path !== undefined) placedAt.set(path, node.position);
      }

      expect(placedAt).toEqual(draggedTo);
    });
  }
});
