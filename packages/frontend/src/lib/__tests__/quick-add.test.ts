import { describe, expect, it } from 'vitest';
import { buildQuickAddConnection, getAvailableQuickAddTypes } from '@/lib/quick-add';

describe('quick-add helpers', () => {
  describe('getAvailableQuickAddTypes', () => {
    it('excludes Trigger when dragging forward (new node needs a target handle)', () => {
      const kinds = getAvailableQuickAddTypes('forward').map((c) => c.kind);
      expect(kinds).not.toContain('trigger');
      expect(kinds).toContain('action');
      expect(kinds).toContain('condition');
    });

    it('offers every simple type (including Trigger) when dragging backward', () => {
      const kinds = getAvailableQuickAddTypes('backward').map((c) => c.kind);
      expect(kinds).toContain('trigger');
      expect(kinds).toContain('action');
      // Each direction excludes exactly one catalog entry (forward: Trigger,
      // backward: Stop) out of the same 7-entry catalog, so counts match —
      // it's *which* entry that differs, asserted separately below.
      expect(getAvailableQuickAddTypes('backward').length).toBe(
        getAvailableQuickAddTypes('forward').length
      );
    });

    it('excludes the Stop action when dragging backward (it has no source/output handle)', () => {
      const backward = getAvailableQuickAddTypes('backward');
      const stopEntry = backward.find((entry) => entry.label === 'Stop');
      expect(stopEntry).toBeUndefined();

      // Forward is unaffected — Stop still accepts an incoming connection.
      const forward = getAvailableQuickAddTypes('forward');
      expect(forward.some((entry) => entry.label === 'Stop')).toBe(true);
    });
  });

  describe('buildQuickAddConnection', () => {
    it('wires the dragged source handle to the new node (forward)', () => {
      const conn = buildQuickAddConnection('forward', 'src-node', 'true', 'new-node');
      expect(conn).toEqual({
        source: 'src-node',
        sourceHandle: 'true',
        target: 'new-node',
        targetHandle: null,
      });
    });

    it('wires the new node into the dragged target handle (backward)', () => {
      const conn = buildQuickAddConnection('backward', 'dst-node', null, 'new-node');
      expect(conn).toEqual({
        source: 'new-node',
        sourceHandle: null,
        target: 'dst-node',
        targetHandle: null,
      });
    });
  });
});
