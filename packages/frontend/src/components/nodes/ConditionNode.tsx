import { Handle, type NodeProps, Position } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { memo } from 'react';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import { cn } from '@/lib/utils';
import type { ConditionNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { getNodeSummary } from '@/utils/nodeData';
import { handleKindClass, NodeShell } from './nodeVisuals';
import { useNodeTraceStatus } from './useNodeTraceStatus';

interface ConditionNodeProps extends NodeProps {
  data: ConditionNodeData;
}

export const ConditionNode = memo(function ConditionNode({
  id,
  data,
  selected,
}: ConditionNodeProps) {
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceView = useNodeTraceStatus(id);
  const { title, subtitle } = getNodeSummary('condition', data);

  return (
    <NodeShell
      kind="condition"
      icon={GitBranch}
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
      {/* Evaluated branch, shown only while a trace with a known result is displayed —
          branch identity itself (which handle is true/false) is labeled on the
          connected edge's midpoint chip, not here (design doc §5). */}
      {traceView.conditionResult != null && (
        <div className="mt-1.5 flex justify-end pl-1">
          <span
            className={cn(
              'rounded-full border px-1.5 py-0.5 font-mono text-[9px]',
              traceView.conditionResult
                ? 'border-flow-ok text-flow-ok'
                : 'border-flow-warn text-flow-warn'
            )}
          >
            {traceView.conditionResult ? 'True' : 'False'}
          </span>
        </div>
      )}

      <Handle type="target" position={Position.Left} className={handleKindClass('condition')} />
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        style={{ top: '35%' }}
        className={handleKindClass('condition')}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        style={{ top: '65%' }}
        className={handleKindClass('condition')}
      />
    </NodeShell>
  );
});
