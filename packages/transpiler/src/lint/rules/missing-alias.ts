import { NODE_KIND_WORD } from '../nodes';
import type { ReadabilityRule } from '../types';
import { type DataRecord, nonEmptyString } from '../values';

/**
 * Keys under which a node carries a name the canvas can show: the step's own `alias`, or the name
 * of the block (`if`/`choose`/`repeat`) the parser attached to it.
 */
const NAME_KEYS = ['alias', 'conditionAlias', 'stepAlias', 'blockAlias'];

function hasName(data: DataRecord): boolean {
  return NAME_KEYS.some((key) => nonEmptyString(data[key]) !== undefined);
}

/** House rule 1: every trigger, condition and action has a clear name. */
export const missingAliasRule: ReadabilityRule = {
  id: 'missing-alias',
  title: 'Steps without a name',
  check: ({ graph }) =>
    graph.nodes
      .filter((node) => !hasName(node.data))
      .map((node) => ({
        id: `missing-alias:${node.id}`,
        ruleId: 'missing-alias',
        severity: 'info',
        nodeId: node.id,
        message: `This ${NODE_KIND_WORD[node.type]} has no name.`,
        detail:
          'Give it a short name in the Properties tab, so the canvas says what it does at a glance.',
        fixes: [],
      })),
};
