import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/store/flow-store';

/**
 * Context provided to action handlers
 */
export interface NodeActionContext {
  selectedNodes: Node<FlowNodeData>[];
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  clipboard: string | null;
  pasteCount: number;
  /** Whether the open flow takes a node of this type (no triggers in a script, nothing when read-only). */
  canPlaceNodeKind: (nodeKind: string | undefined) => boolean;
  addNode: (node: Node<FlowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setClipboard: (data: string | null) => void;
  setPasteCount: (count: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}
