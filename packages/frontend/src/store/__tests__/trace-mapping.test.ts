/**
 * Live-trace mapping in the flow store: `showTrace` resolves HA trace steps
 * onto canvas nodes via a TracePathMap (replacing the old node-type/position
 * heuristic entirely) and derives per-node status, visit counts, and
 * first-visit ordering from them.
 *
 * `resolveTracePath` is mocked here (a faithful copy of the contract:
 * `packages/transpiler` owns testing its own correctness) so this suite
 * exercises `showTrace`'s own aggregation logic in isolation.
 */

import type * as TranspilerModule from '@flow/transpiler';
import type { TracePathMap } from '@flow/transpiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationTrace, TraceStep } from '@/lib/ha-api';
import { useFlowStore } from '../flow-store';

vi.mock('@flow/transpiler', async (importOriginal) => {
  const actual = await importOriginal<typeof TranspilerModule>();
  return {
    ...actual,
    resolveTracePath: (map: TracePathMap, stepPath: string): string | null => {
      const exact = map.pathToNode[stepPath];
      if (exact) return exact;

      const segments = stepPath.split('/');
      while (segments.length > 1) {
        segments.pop();
        const ancestor = map.pathToNode[segments.join('/')];
        if (ancestor) return ancestor;
      }

      const prefix = `${stepPath}/`;
      const descendants = Object.keys(map.pathToNode).filter((p) => p.startsWith(prefix));
      const uniqueNodes = new Set(descendants.map((p) => map.pathToNode[p]));
      return uniqueNodes.size === 1 ? [...uniqueNodes][0] : null;
    },
  };
});

function buildPathMap(pathToNode: Record<string, string>): TracePathMap {
  const nodeToPaths: Record<string, string[]> = {};
  for (const [path, nodeId] of Object.entries(pathToNode)) {
    nodeToPaths[nodeId] = [...(nodeToPaths[nodeId] ?? []), path];
  }
  return { pathToNode, nodeToPaths };
}

function buildStep(path: string, timestamp: string, extra: Partial<TraceStep> = {}): TraceStep {
  return { path, timestamp, ...extra };
}

function buildTrace(
  trace: Record<string, TraceStep[]>,
  overrides: Partial<AutomationTrace> = {}
): AutomationTrace {
  return {
    last_step: null,
    run_id: 'run-1',
    state: 'stopped',
    script_execution: 'finished',
    timestamp: { start: '2026-01-01T00:00:00.000Z', finish: '2026-01-01T00:00:05.000Z' },
    domain: 'automation',
    item_id: 'test_automation',
    trigger: 'state of sensor.foo',
    config: {},
    context: { id: 'ctx-1' },
    trace,
    ...overrides,
  };
}

/** Seed the store's tracePathMap (showTrace's only map source) then show the trace. */
function showTraceWith(trace: AutomationTrace, pathMap: TracePathMap | null): void {
  useFlowStore.setState({ tracePathMap: pathMap });
  useFlowStore.getState().showTrace(trace);
}

describe('showTrace', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('marks successfully executed nodes as ok', () => {
    const pathMap = buildPathMap({ 'trigger/0': 'trigger-1', 'action/0': 'action-1' });
    const trace = buildTrace({
      'trigger/0': [buildStep('trigger/0', '2026-01-01T00:00:00.000Z')],
      'action/0': [buildStep('action/0', '2026-01-01T00:00:01.000Z', { result: { params: {} } })],
    });

    showTraceWith(trace, pathMap);

    const { nodeTraceStates } = useFlowStore.getState();
    expect(nodeTraceStates['trigger-1'].status).toBe('ok');
    expect(nodeTraceStates['action-1'].status).toBe('ok');
  });

  it('marks a false condition as condition-false and stores its result', () => {
    const pathMap = buildPathMap({ 'condition/0': 'condition-1' });
    const conditionResult = { result: false };
    const trace = buildTrace({
      'condition/0': [
        buildStep('condition/0', '2026-01-01T00:00:00.000Z', { result: conditionResult }),
      ],
    });

    showTraceWith(trace, pathMap);

    const state = useFlowStore.getState().nodeTraceStates['condition-1'];
    expect(state.status).toBe('condition-false');
    expect(state.result).toEqual(conditionResult);
  });

  it('marks a not-triggered trigger step as condition-false', () => {
    const pathMap = buildPathMap({ 'trigger/0': 'trigger-1' });
    const trace = buildTrace({
      'trigger/0': [
        buildStep('trigger/0', '2026-01-01T00:00:00.000Z', {
          result: { reason: 'not_matching' },
        }),
      ],
    });

    showTraceWith(trace, pathMap);

    expect(useFlowStore.getState().nodeTraceStates['trigger-1'].status).toBe('condition-false');
  });

  it('marks an errored step as error, taking precedence over a false result', () => {
    const pathMap = buildPathMap({ 'action/0': 'action-1' });
    const trace = buildTrace({
      'action/0': [
        buildStep('action/0', '2026-01-01T00:00:00.000Z', {
          error: 'template rendering failed',
          result: { result: false },
        }),
      ],
    });

    showTraceWith(trace, pathMap);

    const state = useFlowStore.getState().nodeTraceStates['action-1'];
    expect(state.status).toBe('error');
    expect(state.error).toBe('template rendering failed');
  });

  it('falls back to the first template_errors entry when a step has no error field', () => {
    const pathMap = buildPathMap({ 'action/0': 'action-1' });
    const trace = buildTrace({
      'action/0': [
        buildStep('action/0', '2026-01-01T00:00:00.000Z', {
          template_errors: ['undefined variable foo', 'undefined variable bar'],
        }),
      ],
    });

    showTraceWith(trace, pathMap);

    const state = useFlowStore.getState().nodeTraceStates['action-1'];
    expect(state.status).toBe('error');
    expect(state.error).toBe('undefined variable foo');
  });

  it("marks only the chronologically-last step's node as active while running", () => {
    const pathMap = buildPathMap({ 'trigger/0': 'trigger-1', 'action/0': 'action-1' });
    const trace = buildTrace(
      {
        'trigger/0': [buildStep('trigger/0', '2026-01-01T00:00:00.000Z')],
        'action/0': [buildStep('action/0', '2026-01-01T00:00:01.000Z')],
      },
      {
        state: 'running',
        script_execution: null,
        timestamp: { start: '2026-01-01T00:00:00.000Z', finish: null },
      }
    );

    showTraceWith(trace, pathMap);

    const { nodeTraceStates } = useFlowStore.getState();
    expect(nodeTraceStates['action-1'].status).toBe('active');
    // The trigger already finished; it isn't the last step, so it keeps its own status.
    expect(nodeTraceStates['trigger-1'].status).toBe('ok');
  });

  it('does not mark the last step active when the trace has already stopped', () => {
    const pathMap = buildPathMap({ 'action/0': 'action-1' });
    const trace = buildTrace({
      'action/0': [buildStep('action/0', '2026-01-01T00:00:00.000Z')],
    });

    showTraceWith(trace, pathMap);

    expect(useFlowStore.getState().nodeTraceStates['action-1'].status).toBe('ok');
  });

  it('ignores steps whose path has no corresponding node', () => {
    const pathMap = buildPathMap({ 'action/0': 'action-1' });
    const trace = buildTrace({
      'action/0': [buildStep('action/0', '2026-01-01T00:00:00.000Z')],
      'action/1': [buildStep('action/1', '2026-01-01T00:00:01.000Z')],
    });

    showTraceWith(trace, pathMap);

    const state = useFlowStore.getState();
    expect(Object.keys(state.nodeTraceStates)).toEqual(['action-1']);
    expect(state.traceExecutionPath).toEqual(['action-1']);
  });

  it('orders traceExecutionPath by timestamp regardless of trace object key order', () => {
    const pathMap = buildPathMap({
      'trigger/0': 'trigger-1',
      'condition/0': 'condition-1',
      'action/0': 'action-1',
    });
    // Deliberately inserted out of chronological order.
    const trace = buildTrace({
      'action/0': [buildStep('action/0', '2026-01-01T00:00:02.000Z')],
      'trigger/0': [buildStep('trigger/0', '2026-01-01T00:00:00.000Z')],
      'condition/0': [
        buildStep('condition/0', '2026-01-01T00:00:01.000Z', { result: { result: true } }),
      ],
    });

    showTraceWith(trace, pathMap);

    expect(useFlowStore.getState().traceExecutionPath).toEqual([
      'trigger-1',
      'condition-1',
      'action-1',
    ]);
  });

  it('counts every visit to a repeated path inside a loop and keeps the latest status', () => {
    const pathMap = buildPathMap({ 'action/0/repeat/sequence/0': 'loop-action' });
    const trace = buildTrace({
      'action/0/repeat/sequence/0': [
        buildStep('action/0/repeat/sequence/0', '2026-01-01T00:00:00.000Z'),
        buildStep('action/0/repeat/sequence/0', '2026-01-01T00:00:01.000Z'),
        buildStep('action/0/repeat/sequence/0', '2026-01-01T00:00:02.000Z', {
          error: 'iteration 3 failed',
        }),
      ],
    });

    showTraceWith(trace, pathMap);

    const state = useFlowStore.getState().nodeTraceStates['loop-action'];
    expect(state.visitCount).toBe(3);
    // Latest visit wins the status, but the timestamp stays pinned to the first visit.
    expect(state.status).toBe('error');
    expect(state.timestamp).toBe('2026-01-01T00:00:00.000Z');
    // Only the first visit counts towards the execution path.
    expect(useFlowStore.getState().traceExecutionPath).toEqual(['loop-action']);
  });

  it('sets isShowingTrace and clears any previously active node', () => {
    useFlowStore.getState().setActiveNode('some-node');
    const pathMap = buildPathMap({ 'action/0': 'action-1' });
    const trace = buildTrace({ 'action/0': [buildStep('action/0', '2026-01-01T00:00:00.000Z')] });

    showTraceWith(trace, pathMap);

    const state = useFlowStore.getState();
    expect(state.isShowingTrace).toBe(true);
    expect(state.activeNodeId).toBeNull();
    expect(state.traceData).toBe(trace);
  });

  it('skips resolution entirely when pathMap is null', () => {
    const trace = buildTrace({ 'action/0': [buildStep('action/0', '2026-01-01T00:00:00.000Z')] });

    showTraceWith(trace, null);

    const state = useFlowStore.getState();
    expect(state.isShowingTrace).toBe(true);
    expect(state.nodeTraceStates).toEqual({});
    expect(state.traceExecutionPath).toEqual([]);
  });
});

describe('hideTrace / setLiveTrace / bumpTraceRuns', () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it('clears nodeTraceStates on hideTrace but leaves isLiveTrace untouched', () => {
    const pathMap = buildPathMap({ 'action/0': 'action-1' });
    const trace = buildTrace({ 'action/0': [buildStep('action/0', '2026-01-01T00:00:00.000Z')] });
    showTraceWith(trace, pathMap);
    useFlowStore.getState().setLiveTrace(true);

    useFlowStore.getState().hideTrace();

    const state = useFlowStore.getState();
    expect(state.nodeTraceStates).toEqual({});
    expect(state.isShowingTrace).toBe(false);
    expect(state.isLiveTrace).toBe(true);
  });

  it('setLiveTrace toggles isLiveTrace', () => {
    expect(useFlowStore.getState().isLiveTrace).toBe(false);
    useFlowStore.getState().setLiveTrace(true);
    expect(useFlowStore.getState().isLiveTrace).toBe(true);
    useFlowStore.getState().setLiveTrace(false);
    expect(useFlowStore.getState().isLiveTrace).toBe(false);
  });

  it('bumpTraceRuns increments traceRunsVersion', () => {
    expect(useFlowStore.getState().traceRunsVersion).toBe(0);
    useFlowStore.getState().bumpTraceRuns();
    useFlowStore.getState().bumpTraceRuns();
    expect(useFlowStore.getState().traceRunsVersion).toBe(2);
  });
});
