import { Handle, type NodeProps, Position } from '@xyflow/react';
import { HelpCircle, OctagonX, Play } from 'lucide-react';
import { memo } from 'react';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { ActionNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { getNodeKind, getNodeSummary } from '@/utils/nodeData';
import { handleKindClass, NodeShell } from './nodeVisuals';
import { useNodeTraceStatus } from './useNodeTraceStatus';

interface ActionNodeProps extends NodeProps {
  data: ActionNodeData;
}

export const ActionNode = memo(function ActionNode({ id, data, selected }: ActionNodeProps) {
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceView = useNodeTraceStatus(id);
  const kind = getNodeKind('action', data);
  const { title, subtitle } = getNodeSummary('action', data);
  // A `stop` action halts the automation — it has no outgoing edge, unlike
  // every other flow-control/action shape (repeat/parallel continue after).
  const isStop = typeof data.stop === 'string';
  const Icon = kind === 'unknown' ? HelpCircle : kind === 'flowctl' ? OctagonX : Play;

  return (
    <NodeShell
      kind={kind}
      icon={Icon}
      title={title}
      subtitle={subtitle}
      selected={selected}
      disabled={data.enabled === false}
      hasErrors={hasErrors}
      errorMessages={errorMessages}
      traceView={traceView}
      isActive={activeNodeId === id}
      stepNumber={getExecutionStepNumber(id)}
    >
      <Handle type="target" position={Position.Left} className={handleKindClass(kind)} />
      {!isStop && (
        <Handle type="source" position={Position.Right} className={handleKindClass(kind)} />
      )}
    </NodeShell>
  );
});
