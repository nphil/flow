import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Zap } from 'lucide-react';
import { memo } from 'react';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { TriggerNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { getNodeSummary } from '@/utils/nodeData';
import { handleKindClass, NodeShell } from './nodeVisuals';
import { useNodeTraceStatus } from './useNodeTraceStatus';

interface TriggerNodeProps extends NodeProps {
  data: TriggerNodeData;
}

export const TriggerNode = memo(function TriggerNode({ id, data, selected }: TriggerNodeProps) {
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceView = useNodeTraceStatus(id);
  const { title, subtitle } = getNodeSummary('trigger', data);

  return (
    <NodeShell
      kind="trigger"
      icon={Zap}
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
      <Handle type="source" position={Position.Right} className={handleKindClass('trigger')} />
    </NodeShell>
  );
});
