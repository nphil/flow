import { describe, expect, it } from 'vitest';
import { getHandledProperties, isPropertyHandled } from '../handledProperties';

/**
 * `note` (A2) is bound to a single generic Notes textarea in PropertyPanel's common section,
 * shared by every step type — not by each node-fields component individually. If a node type's
 * handled-properties list ever lost `note`, PropertyEditor's "Additional Properties" section
 * would start rendering a second, redundant raw editor for the exact same field alongside the
 * dedicated Notes textarea (the same class of bug the device-node dedup guard in PropertyPanel
 * exists to prevent). These tests pin that contract for every step type.
 */
describe('getHandledProperties: note field stays out of Additional Properties', () => {
  it.each([
    'trigger',
    'condition',
    'action',
    'delay',
    'wait',
    'set_variables',
  ])('treats note as handled for %s nodes', (nodeType) => {
    expect(isPropertyHandled(nodeType, 'note')).toBe(true);
  });

  it('treats enabled and alias as handled alongside note for every step type', () => {
    for (const nodeType of ['trigger', 'condition', 'action', 'delay', 'wait', 'set_variables']) {
      const handled = getHandledProperties(nodeType);
      expect(handled.has('enabled')).toBe(true);
      expect(handled.has('alias')).toBe(true);
      expect(handled.has('note')).toBe(true);
    }
  });
});

describe('getHandledProperties: new field-editor wiring stays out of Additional Properties', () => {
  it('treats repeat (for_each) as handled for action nodes, not a raw Additional Property', () => {
    expect(isPropertyHandled('action', 'repeat')).toBe(true);
  });

  it('treats target and options as handled for condition nodes (A3 integration conditions)', () => {
    expect(isPropertyHandled('condition', 'target')).toBe(true);
    expect(isPropertyHandled('condition', 'options')).toBe(true);
  });

  it('does not leak condition-only target/options handling into action target handling', () => {
    // Action's own `target` (service-call target) is a separate, pre-existing contract —
    // confirms the new condition entries were additive and did not touch the action list.
    const actionHandled = getHandledProperties('action');
    expect(actionHandled.has('target')).toBe(true);
    expect(actionHandled.has('options')).toBe(false);
  });
});
