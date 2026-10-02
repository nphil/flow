import { detectFlowKind, type FlowKind, isRecord } from '@flow/shared';
import { load } from 'js-yaml';

/**
 * What a pasted YAML is: a script when it has a `sequence` and no triggers/actions, else an
 * automation. A config made from a blueprint cannot be told apart by shape (it has neither), so it
 * keeps the kind of what is open now. Returns undefined for YAML that does not parse to a mapping;
 * the parser reports that problem itself.
 */
export function detectImportKind(yamlText: string, currentKind: FlowKind): FlowKind | undefined {
  try {
    const config = load(yamlText);
    if (!isRecord(config)) return undefined;
    return 'use_blueprint' in config ? currentKind : detectFlowKind(config);
  } catch {
    return undefined;
  }
}
