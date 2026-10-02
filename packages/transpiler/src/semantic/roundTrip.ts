import { load as yamlLoad } from 'js-yaml';
import type { FlowTranspiler } from '../FlowTranspiler';
import { type CanonOptions, canonicalizeConfig } from './canonicalize';
import { semanticDiff } from './diff';
import { isJson, type Json } from './json';

export type RoundTripStatus = 'ok' | 'open-fail' | 'emit-fail' | 'diff';

export interface RoundTripResult {
  status: RoundTripStatus;
  /** Parse or emit failure messages (status `open-fail` / `emit-fail`). */
  errors: string[];
  /** Differences in behavior (status `diff`). Empty otherwise. */
  diffs: string[];
  /** Prose (alias / note) present in the original but missing from the output. */
  lostAliases: string[];
  lostNotes: string[];
  /** Parser/generator warnings. */
  warnings: string[];
  /** The regenerated config, when emission succeeded. */
  regenerated?: Json;
}

function failure(status: 'open-fail' | 'emit-fail', errors: string[]): RoundTripResult {
  return { status, errors, diffs: [], lostAliases: [], lostNotes: [], warnings: [] };
}

/**
 * Open a Home Assistant automation/script config in Flow, save it back out
 * unchanged, and report whether the saved config means the same thing.
 *
 * This is the acceptance check behind "saving from Flow without edits changes
 * nothing": regenerated YAML that merely re-parses can still be WRONG (a real
 * defect once moved an if-guard's conditions into a `repeat.until`, turning a
 * guarded lock into an unconditional one), so the comparison is semantic.
 */
export async function roundTripConfig(
  transpiler: FlowTranspiler,
  original: Json,
  options: CanonOptions = {}
): Promise<RoundTripResult> {
  const parsed = await transpiler.fromYaml(JSON.stringify(original), { kind: options.kind });
  if (!parsed.success || !parsed.graph) {
    return failure('open-fail', parsed.errors ?? ['unknown parse error']);
  }

  let regenerated: Json;
  try {
    const loaded: unknown = yamlLoad(transpiler.toYaml(parsed.graph));
    if (!isJson(loaded)) return failure('emit-fail', ['regenerated YAML is not plain JSON data']);
    regenerated = loaded;
  } catch (e) {
    return failure('emit-fail', [e instanceof Error ? e.message : String(e)]);
  }

  // Both sides are read as the same kind: the one Flow opened the config as.
  const sameKind = { ...options, kind: parsed.graph.kind };
  const before = canonicalizeConfig(original, sameKind);
  const after = canonicalizeConfig(regenerated, sameKind);
  const diffs = semanticDiff(before.canon, after.canon);

  return {
    status: diffs.length === 0 ? 'ok' : 'diff',
    errors: [],
    diffs,
    lostAliases: before.prose.aliases.filter((a) => !after.prose.aliases.includes(a)),
    lostNotes: before.prose.notes.filter((n) => !after.prose.notes.includes(n)),
    warnings: parsed.warnings ?? [],
    regenerated,
  };
}
