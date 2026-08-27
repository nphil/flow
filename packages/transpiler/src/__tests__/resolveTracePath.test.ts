import { describe, expect, it } from 'vitest';
import type { TracePathMap } from '../utils/tracePathMap';
import { PathRecorder, resolveTracePath } from '../utils/tracePathMap';

describe('resolveTracePath', () => {
  it('resolves an exact path match', () => {
    const map: TracePathMap = {
      pathToNode: {
        'trigger/0': 'trigger_1',
        'action/0': 'action_1',
      },
      nodeToPaths: {
        trigger_1: ['trigger/0'],
        action_1: ['action/0'],
      },
    };

    expect(resolveTracePath(map, 'action/0')).toBe('action_1');
    expect(resolveTracePath(map, 'trigger/0')).toBe('trigger_1');
  });

  it('falls back to the nearest mapped ancestor when the exact path is unmapped', () => {
    // Only the if action's own step is mapped, not its individual condition
    // sub-step — mirrors a real trace path HA can emit that the parser
    // didn't record directly.
    const map: TracePathMap = {
      pathToNode: {
        'action/0': 'condition_1',
      },
      nodeToPaths: {
        condition_1: ['action/0'],
      },
    };

    expect(resolveTracePath(map, 'action/0/if/condition/0')).toBe('condition_1');
  });

  it('walks multiple ancestor levels to find the nearest mapped prefix', () => {
    const map: TracePathMap = {
      pathToNode: {
        'action/2': 'repeat_entry',
      },
      nodeToPaths: {
        repeat_entry: ['action/2'],
      },
    };

    expect(resolveTracePath(map, 'action/2/repeat/sequence/0/then/1')).toBe('repeat_entry');
  });

  it('resolves via a unique descendant when the step itself is unmapped but every nested path agrees', () => {
    // The choose action's own step isn't mapped, but both of the branch's
    // sub-paths (its condition check and its sequence item) point to the
    // same node, so the ancestor query should still resolve unambiguously.
    const map: TracePathMap = {
      pathToNode: {
        'action/0/choose/0/conditions/0': 'action_x',
        'action/0/choose/0/sequence/0': 'action_x',
      },
      nodeToPaths: {
        action_x: ['action/0/choose/0/conditions/0', 'action/0/choose/0/sequence/0'],
      },
    };

    expect(resolveTracePath(map, 'action/0/choose/0')).toBe('action_x');
  });

  it('returns null when descendants disagree on node id', () => {
    const map: TracePathMap = {
      pathToNode: {
        'action/0/choose/0/conditions/0': 'condition_a',
        'action/0/choose/0/sequence/0': 'action_b',
      },
      nodeToPaths: {
        condition_a: ['action/0/choose/0/conditions/0'],
        action_b: ['action/0/choose/0/sequence/0'],
      },
    };

    expect(resolveTracePath(map, 'action/0/choose/0')).toBeNull();
  });

  it('returns null for a completely unmappable path', () => {
    const map: TracePathMap = {
      pathToNode: {
        'trigger/0': 'trigger_1',
      },
      nodeToPaths: {
        trigger_1: ['trigger/0'],
      },
    };

    expect(resolveTracePath(map, 'action/9/unknown/segment')).toBeNull();
  });

  it('does not false-positive on a numeric-prefix collision without a path separator', () => {
    // "action/1" must not be treated as an ancestor of "action/12" — the
    // ancestor walk only strips on `/` boundaries.
    const map: TracePathMap = {
      pathToNode: {
        'action/12': 'action_twelve',
      },
      nodeToPaths: {
        action_twelve: ['action/12'],
      },
    };

    expect(resolveTracePath(map, 'action/1')).toBeNull();
  });
});

describe('PathRecorder', () => {
  it('builds pathToNode and nodeToPaths in both directions', () => {
    const recorder = new PathRecorder();
    recorder.record('node_1', 'action/0');
    recorder.record('node_1', 'action/0/if/condition/0');
    recorder.record('node_2', 'action/1');

    const map = recorder.toTracePathMap();

    expect(map.pathToNode).toEqual({
      'action/0': 'node_1',
      'action/0/if/condition/0': 'node_1',
      'action/1': 'node_2',
    });
    expect(map.nodeToPaths).toEqual({
      node_1: ['action/0', 'action/0/if/condition/0'],
      node_2: ['action/1'],
    });
  });

  it('treats the first recorded path for a node as its primary path', () => {
    const recorder = new PathRecorder();
    recorder.record('node_1', 'action/0/if/condition/0');
    recorder.record('node_1', 'action/0');

    const map = recorder.toTracePathMap();

    expect(map.nodeToPaths.node_1[0]).toBe('action/0/if/condition/0');
    expect(map.nodeToPaths.node_1).toEqual(['action/0/if/condition/0', 'action/0']);
  });

  it('is idempotent when the same node/path pair is recorded twice', () => {
    const recorder = new PathRecorder();
    recorder.record('node_1', 'action/0');
    recorder.record('node_1', 'action/0');

    const map = recorder.toTracePathMap();

    expect(map.nodeToPaths.node_1).toEqual(['action/0']);
  });
});
