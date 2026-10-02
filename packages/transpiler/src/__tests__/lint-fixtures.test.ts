// The readability engine against real automations: every shipped fixture must lint without
// trouble, every fix must produce a graph Flow can still save and open again, and automations
// that follow the house rules must get no findings about them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowGraph } from '@flow/shared';
import { glob } from 'glob';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FlowTranspiler } from '../FlowTranspiler';
import { applySafeFixes, lintFlowGraph } from '../lint';
import { YamlParser } from '../parser/YamlParser';

const FIXTURE_ROOT = join(__dirname, '../../../../__tests__');
const FIXTURE_FILES = glob
  .sync('{yaml-automation-fixtures,ha-roundtrip-fixtures}/**/*.yaml', { cwd: FIXTURE_ROOT })
  .sort();

const parser = new YamlParser();
const transpiler = new FlowTranspiler();

/** The graph a fixture opens as, or null when the parser cannot open it (not this suite's concern). */
async function openGraph(yaml: string): Promise<FlowGraph | null> {
  const result = await parser.parse(yaml);
  return result.success && result.graph ? result.graph : null;
}

async function openFixture(file: string): Promise<FlowGraph | null> {
  return openGraph(readFileSync(join(FIXTURE_ROOT, file), 'utf8'));
}

/** The graph saved to YAML and opened again, or null when that does not work. */
async function saveAndReopen(graph: FlowGraph): Promise<FlowGraph | null> {
  try {
    return await openGraph(transpiler.toYaml(graph));
  } catch {
    return null;
  }
}

/** Findings that are about behaviour or wording of the logic, not about steps lacking a name. */
function logicFindings(graph: FlowGraph) {
  return lintFlowGraph(graph).filter(
    (f) => f.ruleId !== 'missing-alias' && f.ruleId !== 'missing-description'
  );
}

describe('readability engine on every fixture', () => {
  const quiet = vi.spyOn(console, 'error');
  beforeAll(() => {
    // The parser logs every fixture it cannot open; that is the round-trip suite's business.
    quiet.mockImplementation(() => undefined);
  });
  afterAll(() => quiet.mockRestore());

  it('has fixtures to run on', () => {
    expect(FIXTURE_FILES.length).toBeGreaterThan(20);
  });

  for (const file of FIXTURE_FILES) {
    it(`${file}: findings are well-formed and every fix still saves and reopens`, async () => {
      const graph = await openFixture(file);
      if (!graph) return;

      const findings = lintFlowGraph(graph);
      const ids = findings.map((f) => f.id);
      expect(new Set(ids).size, `${file}: duplicate finding ids`).toBe(ids.length);

      const nodeIds = new Set(graph.nodes.map((n) => n.id));
      for (const finding of findings) {
        if (finding.nodeId !== undefined) expect(nodeIds.has(finding.nodeId)).toBe(true);
        if (finding.fixes.length > 0) {
          for (const fix of finding.fixes) {
            if (!fix.safe)
              expect(fix.note, `${finding.id}: unsafe fix without a reason`).toBeTruthy();
          }
        }
      }

      const canSaveAsIs = (await saveAndReopen(graph)) !== null;
      for (const finding of findings) {
        for (const fix of finding.fixes) {
          const fixed = fix.apply(graph);
          expect(fixed, `${finding.id}: "${fix.label}" changed nothing`).not.toBe(graph);
          expect(
            lintFlowGraph(fixed).map((f) => f.id),
            `${finding.id}: "${fix.label}" did not resolve the finding`
          ).not.toContain(finding.id);
          if (canSaveAsIs) {
            expect(
              await saveAndReopen(fixed),
              `${finding.id}: after "${fix.label}" the automation no longer saves and reopens`
            ).not.toBeNull();
          }
        }
      }
    });
  }
});

describe('what the engine says about the older fixtures', () => {
  // [fixture, how many findings per rule (naming rules left out)]
  const EXPECTED: [string, Record<string, number>][] = [
    ['01-simple-trigger-action.yaml', { 'unavailable-restore': 1 }],
    ['02-knx-complex.yaml', { 'device-id': 1 }],
    ['05-delays-and-waits.yaml', { 'unavailable-restore': 1, 'template-native': 1 }],
    ['09-templates.yaml', { 'unavailable-restore': 1 }],
    ['15-open-ccu.yaml', { 'device-id': 7 }],
    ['18-sensor-trigger.yaml', { 'device-id': 1 }],
    ['19-nested-condition.yaml', {}],
    ['21-trigger-to-null.yaml', {}],
    ['24-disabled-choose.yaml', {}],
    ['26-repeat-until.yaml', {}],
  ];

  for (const [name, expected] of EXPECTED) {
    it(`${name}`, async () => {
      const graph = await openFixture(`yaml-automation-fixtures/${name}`);
      expect(graph).not.toBeNull();
      if (!graph) return;

      const counts: Record<string, number> = {};
      for (const finding of logicFindings(graph)) {
        counts[finding.ruleId] = (counts[finding.ruleId] ?? 0) + 1;
      }
      expect(counts).toEqual(expected);
    });
  }

  it('one click on the safe fix of 01-simple-trigger-action makes the finding go away for good', async () => {
    const graph = await openFixture('yaml-automation-fixtures/01-simple-trigger-action.yaml');
    expect(graph).not.toBeNull();
    if (!graph) return;

    const { graph: fixed, applied } = applySafeFixes(graph);
    expect(applied.map((f) => f.ruleId)).toEqual(['unavailable-restore']);

    const yaml = transpiler.toYaml(fixed);
    expect(yaml).toMatch(/not_from:\n\s+- unavailable/);

    const reopened = await openGraph(yaml);
    expect(reopened).not.toBeNull();
    if (reopened) expect(logicFindings(reopened)).toEqual([]);
  });
});

describe('an automation that follows the house rules', () => {
  it('gets no findings at all when opened from YAML', async () => {
    const graph = await openGraph(`
alias: Hallway light follows motion
description: Turns the hallway light on when someone walks in and it is dark.
triggers:
  - alias: Motion starts
    trigger: state
    entity_id: binary_sensor.hallway_motion
    from: "off"
    to: "on"
conditions:
  - alias: It is dark
    condition: numeric_state
    entity_id: sensor.hallway_lux
    below: 20
actions:
  - alias: Light on
    action: light.turn_on
    target:
      entity_id: light.hallway
  - alias: Let it burn
    delay:
      minutes: 5
  - alias: Light off
    action: light.turn_off
    target:
      entity_id: light.hallway
mode: single
`);
    expect(graph).not.toBeNull();
    if (graph) expect(lintFlowGraph(graph)).toEqual([]);
  });
});
