import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { DelayNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { durationToMs, formatDuration } from './formatDuration';
import { handleKindClass, NodeShell } from './nodeVisuals';
import { useNodeTraceStatus } from './useNodeTraceStatus';
import { useTraceCountdown } from './useTraceCountdown';

interface DelayNodeProps extends NodeProps {
  data: DelayNodeData;
}

export const DelayNode = memo(function DelayNode({ id, data, selected }: DelayNodeProps) {
  const { t } = useTranslation(['nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceView = useNodeTraceStatus(id);

  const delayDisplay = formatDuration(data.delay);

  // Live countdown: prefer the resolved delay from the trace step result
  // (templates already evaluated by HA), fall back to the configured value.
  const isCounting = traceView.traceState?.status === 'active' && traceView.isRunning;
  const traceDelaySeconds = traceView.traceState?.result?.delay;
  const countdownTotalMs =
    typeof traceDelaySeconds === 'number' ? traceDelaySeconds * 1000 : durationToMs(data.delay);
  const countdown = useTraceCountdown(
    isCounting,
    traceView.traceState?.timestamp,
    countdownTotalMs
  );

  return (
    <NodeShell
      kind="timing"
      icon={Clock}
      title={data.alias || 'Delay'}
      subtitle={delayDisplay}
      selected={selected}
      disabled={data.enabled === false}
      hasErrors={hasErrors}
      errorMessages={errorMessages}
      traceView={traceView}
      isActive={activeNodeId === id}
      stepNumber={getExecutionStepNumber(id)}
    >
      {countdown && (
        <div className="mt-1 pl-1 font-mono font-semibold text-[11px] text-flow-accent tabular-nums">
          {t('nodes:trace.remaining', { time: countdown })}
        </div>
      )}
      <Handle type="target" position={Position.Left} className={handleKindClass('timing')} />
      <Handle type="source" position={Position.Right} className={handleKindClass('timing')} />
    </NodeShell>
  );
});
