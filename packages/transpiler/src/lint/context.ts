import type { FlowGraph } from '@flow/shared';
import { automationActuates } from './actions';
import { listConditions } from './conditions';
import { isDisabled } from './nodes';
import type { LintContext } from './types';

/** A template that tests the trigger's previous state against an offline state: `... not in [...]`, `!= ...`. */
function skipsOfflineStates(template: string): boolean {
  return (
    template.includes('from_state') &&
    /unavailable|unknown/.test(template) &&
    /!=|\bnot\b/.test(template)
  );
}

/** True when a condition already skips runs that start from an `unavailable`/`unknown` state. */
function hasRestoreGuard(graph: FlowGraph): boolean {
  return graph.nodes.some(
    (node) =>
      node.type === 'condition' &&
      !isDisabled(node.data) &&
      listConditions(node.data).some(
        ({ condition }) =>
          condition.condition === 'template' &&
          typeof condition.value_template === 'string' &&
          skipsOfflineStates(condition.value_template)
      )
  );
}

export function buildLintContext(graph: FlowGraph): LintContext {
  return { graph, actuates: automationActuates(graph), hasRestoreGuard: hasRestoreGuard(graph) };
}
