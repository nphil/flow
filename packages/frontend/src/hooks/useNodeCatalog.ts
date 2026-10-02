import { useMemo } from 'react';
import { getNodeCatalog, type NodeCatalogEntry } from '@/components/nodes/catalog';
import { useFlowStore } from '@/store/flow-store';

/** The node types the open flow accepts (see `getNodeCatalog`), for every place a node can be added. */
export function useNodeCatalog(): NodeCatalogEntry[] {
  const flowKind = useFlowStore((s) => s.flowKind);
  const isReadOnly = useFlowStore((s) => s.blueprint !== null);
  return useMemo(() => getNodeCatalog(flowKind, isReadOnly), [flowKind, isReadOnly]);
}
