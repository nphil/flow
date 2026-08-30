import type { Edge, Node } from '@xyflow/react';
import { generateNodeId } from '@/lib/utils';
import type { FlowNodeData } from '@/store/flow-store';
import type { NodeActionContext } from './NodeActionContext';

/**
 * Copies the selected nodes and their connecting edges to the clipboard.
 * Resets the paste count so the next paste starts at offset 1.
 */
export function copyNodesToClipboard(context: NodeActionContext): void {
  const selectedNodeIds = context.selectedNodes.map((n) => n.id);
  const selectedEdges = context.edges.filter(
    (edge) => selectedNodeIds.includes(edge.source) && selectedNodeIds.includes(edge.target)
  );
  context.setClipboard(JSON.stringify({ nodes: context.selectedNodes, edges: selectedEdges }));
  context.setPasteCount(0);
}

/**
 * Clones a set of nodes and their connecting edges into the canvas.
 * Deselects existing nodes and selects the new clones.
 * By default the clones land at a progressive offset based on the paste
 * count; pass `at` (flow coordinates) to anchor the group's top-left corner
 * there instead — the context menu's "Paste here".
 */
export function cloneNodesIntoCanvas(
  sourceNodes: Node<FlowNodeData>[],
  sourceEdges: Edge[],
  context: NodeActionContext,
  at?: { x: number; y: number }
): void {
  const currentPasteCount = (context.pasteCount || 0) + 1;
  context.setPasteCount(currentPasteCount);
  const offset = 50 * currentPasteCount;
  let dx = offset;
  let dy = offset;
  if (at && sourceNodes.length > 0) {
    dx = at.x - Math.min(...sourceNodes.map((n) => n.position.x));
    dy = at.y - Math.min(...sourceNodes.map((n) => n.position.y));
  }

  const nodeIdMap = new Map<string, string>();

  const deselectedNodes = context.nodes.map((n) => ({ ...n, selected: false }));

  const newNodes = sourceNodes.map((n) => {
    const newId = generateNodeId(n.type ?? 'node');
    nodeIdMap.set(n.id, newId);
    return {
      ...n,
      selected: true,
      id: newId,
      position: { x: n.position.x + dx, y: n.position.y + dy },
    };
  });

  context.setNodes([...deselectedNodes, ...newNodes]);

  if (sourceEdges.length > 0) {
    const newEdges = sourceEdges.map((edge) => ({
      ...edge,
      id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      source: nodeIdMap.get(edge.source) ?? edge.source,
      target: nodeIdMap.get(edge.target) ?? edge.target,
    }));
    context.setEdges([...context.edges, ...newEdges]);
  }
}
