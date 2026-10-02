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
const KNOWN_GAPS: Record<string, string> = {
  'automations/action-scene-activate.yaml': 'scene step replaced by unknown.unknown',
  'automations/action-service-service-template-legacy.yaml':
    'service_template step replaced by unknown.unknown',
  'automations/action-stop-in-choose-branch.yaml':
    'choose/else-if with a stopping branch rewritten as sequential ifs',
  'automations/action-stop-in-choose-default.yaml':
    'guard that stops in else: the steps after the if are folded or reordered',
  'automations/action-stop-in-else-branch.yaml':
    'guard that stops in else: the steps after the if are folded or reordered',
  'automations/action-stop-in-repeat.yaml':
    'stop moved out of its branch (stop becomes unconditional)',
  'automations/action-wait-for-trigger-then-choose-on-wait-trigger-id.yaml':
    'choose saved as a nested if/else ladder',
  'automations/action-wait-then-branch-on-wait-completed.yaml':
    'bare template condition corrupted into a character map',
  'automations/alias-note-on-flow-control-step-kinds.yaml':
    'nested sequence step replaced by unknown.unknown',
  'automations/alias-note-on-simple-step-kinds.yaml': 'scene step replaced by unknown.unknown',
  'automations/blueprint-instance-no-inputs.yaml': 'blueprint instance cannot be opened',
  'automations/blueprint-instance-with-inputs.yaml': 'blueprint instance cannot be opened',
  'automations/choose-branch-alias-and-note.yaml': 'choose saved as a nested if/else ladder',
  'automations/choose-conditions-mapping-instead-of-list.yaml':
    'choose saved as a nested if/else ladder',
  'automations/choose-empty-default.yaml': 'first/only step hoisted into root conditions',
  'automations/choose-empty-sequence-branch.yaml': 'first/only step hoisted into root conditions',
  'automations/choose-many-branches-with-default.yaml': 'choose saved as a nested if/else ladder',
  'automations/choose-nested-choose.yaml': 'choose saved as a nested if/else ladder',
  'automations/choose-overlapping-branches-first-match-wins.yaml':
    'choose saved as a nested if/else ladder',
  'automations/choose-single-branch-only.yaml': 'first/only step hoisted into root conditions',
  'automations/choose-with-steps-before-and-after.yaml': 'choose saved as a nested if/else ladder',
  'automations/choose-without-default.yaml': 'choose saved as a nested if/else ladder',
  'automations/conditions-in-choose-groups.yaml':
    'not: shorthand in choose saved as a broken template condition',
  'automations/conditions-in-choose-leaf-types.yaml': 'choose saved as a nested if/else ladder',
  'automations/conditions-in-choose-template-string.yaml':
    'bare template condition corrupted into a character map',
  'automations/conditions-in-if-group-long-form.yaml':
    'first/only step hoisted into root conditions',
  'automations/conditions-in-if-group-shorthand.yaml': 'or: shorthand in if saved as numeric_state',
  'automations/conditions-in-if-mixed-bare-templates.yaml':
    'bare template condition corrupted into a character map',
  'automations/conditions-in-if-template-string.yaml':
    'if with a template string replaced by unknown.unknown',
  'automations/conditions-in-if-trigger-and-zone.yaml':
    'first/only step hoisted into root conditions',
  'automations/conditions-in-repeat-shorthand.yaml':
    'repeat while/until as a template string rejected',
  'automations/conditions-inline-step-gating-sequence.yaml':
    'condition step rewritten as an if wrapping the rest',
  'automations/conditions-inline-step-group.yaml': 'first/only step hoisted into root conditions',
  'automations/conditions-inline-step-in-choose-sequence.yaml':
    'gate step merged into the if/choose condition: else/other branch now runs',
  'automations/conditions-inline-step-in-first-choose-branch-with-second-branch.yaml':
    'gate step merged into the if/choose condition: else/other branch now runs',
  'automations/conditions-inline-step-in-if-then.yaml':
    'gate step inside then merged into the if conditions',
  'automations/conditions-inline-step-in-parallel-branch.yaml':
    'condition step rewritten as an if wrapping the rest',
  'automations/conditions-inline-step-in-repeat-sequence.yaml':
    'condition step rewritten as an if wrapping the rest',
  'automations/conditions-inline-step-in-then-with-else.yaml':
    'gate step merged into the if/choose condition: else/other branch now runs',
  'automations/conditions-step-template-shorthand.yaml':
    'template/or shorthand condition steps broken',
  'automations/deep-choose-in-repeat-in-parallel-in-sequence.yaml':
    'nested sequence step replaced by unknown.unknown',
  'automations/deep-diamond-choose-branches-converge-on-shared-tail.yaml':
    'choose saved as a nested if/else ladder',
  'automations/deep-if-ladder-with-waits-and-stops.yaml':
    'choose/else-if with a stopping branch rewritten as sequential ifs',
  'automations/deep-repeat-in-choose-in-if-in-parallel.yaml':
    'choose saved as a nested if/else ladder',
  'automations/deep-wait-timeout-guard-then-continue.yaml':
    'bare template condition corrupted into a character map',
  'automations/disabled-step-choose.yaml':
    'disabled if/choose: enabled:false pushed onto inner nodes',
  'automations/disabled-step-condition.yaml': 'condition step rewritten as an if wrapping the rest',
  'automations/disabled-step-if.yaml': 'disabled if/choose: enabled:false pushed onto inner nodes',
  'automations/disabled-step-inside-choose-branch.yaml': 'choose saved as a nested if/else ladder',
  'automations/disabled-step-inside-if-then.yaml': 'first/only step hoisted into root conditions',
  'automations/disabled-step-parallel.yaml': 'disabled parallel becomes enabled',
  'automations/disabled-step-repeat.yaml': 'disabled repeat: flag pushed onto inner steps',
  'automations/disabled-step-scene.yaml': 'scene step replaced by unknown.unknown',
  'automations/disabled-step-sequence-group.yaml':
    'nested sequence step replaced by unknown.unknown',
  'automations/if-empty-then-with-else.yaml': 'first/only step hoisted into root conditions',
  'automations/kitchen-sink-every-construct.yaml':
    'bare template condition corrupted into a character map',
  'automations/kitchen-sink-legacy-spellings.yaml': 'choose saved as a nested if/else ladder',
  'automations/parallel-branch-alias-and-note.yaml':
    'alias/note lost: Tell everyone at once, Light branch',
  'automations/parallel-in-choose-branch.yaml': 'parallel inside if/choose becomes sequential',
  'automations/parallel-in-if-then.yaml': 'parallel inside if/choose becomes sequential',
  'automations/parallel-nested-parallel.yaml':
    'nested parallel flattened, following step duplicated',
  'automations/parallel-single-mapping-branch.yaml':
    'parallel as a mapping replaced by unknown.unknown',
  'automations/realistic-garage-auto-close.yaml': 'choose saved as a nested if/else ladder',
  'automations/realistic-motion-light-with-timeout.yaml': 'choose saved as a nested if/else ladder',
  'automations/realistic-presence-lights-with-sun-and-zone.yaml':
    'parallel becomes sequential steps',
  'automations/realistic-thermostat-schedule-with-trigger-ids.yaml':
    'choose saved as a nested if/else ladder',
  'automations/realistic-voice-command-scene.yaml': 'choose saved as a nested if/else ladder',
  'automations/repeat-count-template.yaml': 'repeat count template dropped',
  'automations/repeat-for-each-template.yaml': 'choose saved as a nested if/else ladder',
  'automations/self-healing-wait-and-guard.yaml': 'choose saved as a nested if/else ladder',
  'automations/sequence-nested-inside-sequence.yaml':
    'nested sequence step replaced by unknown.unknown',
  'automations/sequence-nested-with-alias.yaml': 'nested sequence step replaced by unknown.unknown',
  'automations/structure-choose-inside-repeat-until-with-wait.yaml':
    'choose branch content moved out of an emptied then (runs unconditionally)',
  'automations/structure-if-inside-parallel-branch-converging.yaml':
    'step after a parallel is copied into every branch',
  'automations/structure-parallel-branches-each-with-a-loop.yaml':
    'step after a parallel is copied into every branch',
  'automations/structure-repeat-until-inside-repeat-while.yaml': 'inner repeat-until loop dropped',
  'automations/structure-stop-inside-while-loop-after-choose.yaml':
    'choose merged into the loop while-condition, loop body dropped',
  'automations/trigger-routing-by-trigger-id-with-choose.yaml':
    'choose saved as a nested if/else ladder',
  'scripts/script-alias-icon-description.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-blueprint-instance.yaml': 'blueprint instance cannot be opened',
  'scripts/script-choose-and-if-flow.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-condition-gate-steps.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-fields-entity-device-area-target.yaml':
    'scripts cannot be opened (no trigger node)',
  'scripts/script-fields-required-advanced-defaults.yaml':
    'scripts cannot be opened (no trigger node)',
  'scripts/script-fields-select-time-duration-color.yaml':
    'scripts cannot be opened (no trigger node)',
  'scripts/script-fields-text-number-boolean.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-fields-without-selectors.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-full-featured.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-legacy-service-keys.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-max-exceeded-error.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-minimal-sequence.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-mode-parallel-max-exceeded-silent.yaml':
    'scripts cannot be opened (no trigger node)',
  'scripts/script-mode-queued-with-max.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-mode-restart.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-no-alias-description-empty.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-parallel-flow.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-repeat-and-wait-flow.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-service-response-then-stop.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-stop-with-response-variable.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-trace-stored-traces.yaml': 'scripts cannot be opened (no trigger node)',
  'scripts/script-variables-and-templates.yaml': 'scripts cannot be opened (no trigger node)',
};

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

      const result = await roundTripConfig(transpiler, original, { strict: true });

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
