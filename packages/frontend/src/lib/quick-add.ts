import type { Connection } from '@xyflow/react';
import { NODE_CATALOG, type NodeCatalogEntry } from '@/components/nodes/catalog';

/**
 * Which end of the dragged (but unfinished) connection the quick-add node
 * needs to satisfy — `'forward'` when the user dragged from a *source* handle
 * (the new node needs a target/input), `'backward'` when dragged from a
 * *target* handle (the new node needs a source/output).
 */
export type QuickAddDirection = 'forward' | 'backward';

/** A `stop` action (see catalog.ts's "Stop" entry) has no source/output handle. */
function hasSourceHandle(entry: NodeCatalogEntry): boolean {
  return !(entry.kind === 'action' && typeof entry.defaultData.stop === 'string');
}

/**
 * Catalog entries offered by the quick-add menu, filtered by which handle the
 * new node needs to satisfy the dragged connection.
 */
export function getAvailableQuickAddTypes(direction: QuickAddDirection): NodeCatalogEntry[] {
  if (direction === 'forward') {
    // The new node must accept an incoming connection — triggers have no
    // target/input handle, so they can't complete a forward drag.
    return NODE_CATALOG.filter((entry) => entry.kind !== 'trigger');
  }
  // Dragged backward from a target handle: the new node must have a source
  // handle to feed the dragged-from node.
  return NODE_CATALOG.filter(hasSourceHandle);
}

/**
 * Builds the `Connection` to pass to the store's `onConnect` action to wire a
 * quick-added node into the dragged (but unfinished) connection.
 */
export function buildQuickAddConnection(
  direction: QuickAddDirection,
  fromNodeId: string,
  fromHandleId: string | null,
  newNodeId: string
): Connection {
  return direction === 'forward'
    ? { source: fromNodeId, sourceHandle: fromHandleId, target: newNodeId, targetHandle: null }
    : { source: newNodeId, sourceHandle: null, target: fromNodeId, targetHandle: fromHandleId };
}
