import { listConditions } from '../conditions';
import type { ReadabilityFinding, ReadabilityRule } from '../types';

/** Longer than this, or with this many `{% %}` blocks, a template stops being readable at a glance. */
const MAX_TEMPLATE_LENGTH = 200;
const MAX_LOGIC_BLOCKS = 3;

function isTooComplex(template: string): boolean {
  const logicBlocks = template.split('{%').length - 1;
  return template.length > MAX_TEMPLATE_LENGTH || logicBlocks >= MAX_LOGIC_BLOCKS;
}

/** A template condition that is long or has several `{% %}` blocks in it. */
export const longTemplateRule: ReadabilityRule = {
  id: 'long-template',
  title: 'Long template conditions',
  check: ({ graph }) =>
    graph.nodes.flatMap((node): ReadabilityFinding[] => {
      if (node.type !== 'condition') return [];
      return listConditions(node.data).flatMap(({ path, condition }) => {
        const template = condition.value_template;
        if (condition.condition !== 'template' || typeof template !== 'string') return [];
        if (!isTooComplex(template)) return [];
        return [
          {
            id: `long-template:${[node.id, ...path].join(':')}`,
            ruleId: 'long-template',
            severity: 'info',
            nodeId: node.id,
            message: 'This template condition is long and hard to read at a glance.',
            detail:
              'Consider splitting it into several steps, or moving the logic into a helper (for example a template sensor) and checking that instead.',
            fixes: [],
          },
        ];
      });
    }),
};
