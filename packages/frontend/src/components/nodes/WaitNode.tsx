import { Handle, type NodeProps, Position } from '@xyflow/react';
import { Hourglass } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNodeErrors } from '@/hooks/useNodeErrors';
import type { WaitNodeData } from '@/store/flow-store';
import { useFlowStore } from '@/store/flow-store';
import { durationToMs, formatDuration } from './formatDuration';
import { handleKindClass, NodeShell } from './nodeVisuals';
import { useNodeTraceStatus } from './useNodeTraceStatus';
import { useTraceCountdown } from './useTraceCountdown';

interface WaitNodeProps extends NodeProps {
  data: WaitNodeData;
}

export const WaitNode = memo(function WaitNode({ id, data, selected }: WaitNodeProps) {
  const { t } = useTranslation(['common', 'nodes']);
  const activeNodeId = useFlowStore((s) => s.activeNodeId);
  const getExecutionStepNumber = useFlowStore((s) => s.getExecutionStepNumber);
  const { hasErrors, errorMessages } = useNodeErrors(id);
  const traceView = useNodeTraceStatus(id);

  const timeoutDisplay = formatDuration(data.timeout);
  const subtitle = data.wait_template
    ? data.wait_template.length > 40
      ? `${data.wait_template.slice(0, 40)}…`
      : data.wait_template
    : data.wait_for_trigger
      ? t('nodes:wait.waitsForNTrigger', { count: data.wait_for_trigger.length })
      : timeoutDisplay
        ? `${t('nodes:wait.timeoutLabel')} ${timeoutDisplay}`
        : t('nodes:types.wait');

  // Live countdown: count down towards the configured timeout when one is
  // set, otherwise count up while the wait is pending.
  const isCounting = traceView.traceState?.status === 'active' && traceView.isRunning;
  const timeoutTotalMs = durationToMs(data.timeout);
  const countdown = useTraceCountdown(isCounting, traceView.traceState?.timestamp, timeoutTotalMs);

  return (
    <NodeShell
      kind="timing"
      icon={Hourglass}
      title={data.alias || 'Wait for'}
      subtitle={subtitle}
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
          {timeoutTotalMs != null
            ? t('nodes:trace.remaining', { time: countdown })
            : t('nodes:trace.elapsed', { time: countdown })}
        </div>
      )}
      <Handle type="target" position={Position.Left} className={handleKindClass('timing')} />
      <Handle type="source" position={Position.Right} className={handleKindClass('timing')} />
    </NodeShell>
  );
});
