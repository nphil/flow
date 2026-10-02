import type { ReadabilityRule } from '../types';
import { nonEmptyString } from '../values';

/** House rule 1: the automation itself says, in a sentence, what it is for. */
export const missingDescriptionRule: ReadabilityRule = {
  id: 'missing-description',
  title: 'Automation without a description',
  check: ({ graph }) => {
    // An empty canvas has nothing to describe yet.
    if (graph.nodes.length === 0 || nonEmptyString(graph.description) !== undefined) return [];
    return [
      {
        id: 'missing-description:automation',
        ruleId: 'missing-description',
        severity: 'info',
        message: 'This automation has no description.',
        detail:
          'One sentence about what it is for and why helps you (and anyone else) when you come back to it later. Add it in the automation settings.',
        fixes: [],
      },
    ];
  },
};
