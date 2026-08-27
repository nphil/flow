import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Variable } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { SetVariablesNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { handleKindClass, NodeShell } from './nodeVisuals';
import { useNodeTraceStatus } from './useNodeTraceStatus';

interface SetVariablesNodeProps extends NodeProps {
  data: SetVariablesNodeData;
}

export const SetVariablesNode = memo(function SetVariablesNode({
  id,
  data,
  selected,
}: SetVariablesNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceView = useNodeTraceStatus(id);
  const variableCount = Object.keys(data.variables || {}).length;

  return (
    <NodeShell
      kind="data"
      icon={Variable}
      title={data.alias || 'Set Variables'}
      subtitle={t('nodes:variables.variableCount', { count: variableCount })}
      selected={selected}
      disabled={data.enabled === false}
      hasErrors={hasErrors}
      errorMessages={errorMessages}
      traceView={traceView}
      isActive={activeNodeId === id}
      stepNumber={getExecutionStepNumber(id)}
    >
      <Handle type="target" position={Position.Left} className={handleKindClass('data')} />
      <Handle type="source" position={Position.Right} className={handleKindClass('data')} />
    </NodeShell>
  );
});
