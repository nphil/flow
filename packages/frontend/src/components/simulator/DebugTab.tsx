import { useReactFlow } from '@xyflow/react';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  History,
  Play,
  RadioTower,
  RotateCcw,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHass } from '@/contexts/HassContext';
import { useLiveTrace } from '@/hooks/useLiveTrace';
import { getHomeAssistantAPI, type ScriptExecutionState, type TraceListItem } from '@/lib/ha-api';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { SpeedControl } from './SpeedControl';
import { TraceSimulator } from './TraceSimulator';

function executionBadgeInfo(
  t: TFunction<['dialogs']>,
  value: ScriptExecutionState | null
): { label: string; tone: 'ok' | 'warn' | 'danger' | 'accent' | 'muted' } {
  switch (value) {
    case 'finished':
      return { label: t('dialogs:traceViewer.execution.finished'), tone: 'ok' };
    case 'aborted':
      return { label: t('dialogs:traceViewer.execution.aborted'), tone: 'warn' };
    case 'cancelled':
      return { label: t('dialogs:traceViewer.execution.cancelled'), tone: 'warn' };
    case 'error':
      return { label: t('dialogs:traceViewer.execution.error'), tone: 'danger' };
    case 'failed_conditions':
      return { label: t('dialogs:traceViewer.execution.failed_conditions'), tone: 'warn' };
    case 'failed_single':
      return { label: t('dialogs:traceViewer.execution.failed_single'), tone: 'warn' };
    case 'failed_max_runs':
      return { label: t('dialogs:traceViewer.execution.failed_max_runs'), tone: 'warn' };
    case 'not_triggered':
      return { label: t('dialogs:traceViewer.execution.not_triggered'), tone: 'muted' };
    case 'disallowed_recursion_detected':
      return { label: t('dialogs:traceViewer.execution.disallowed_recursion_detected'), tone: 'danger' };
    case null:
      return { label: t('dialogs:traceViewer.execution.running'), tone: 'accent' };
    default:
      // HA may grow new terminal states; show them raw rather than crash.
      return { label: String(value), tone: 'muted' };
  }
}

const TONE_CLASS: Record<'ok' | 'warn' | 'danger' | 'accent' | 'muted', string> = {
  ok: 'border-flow-ok text-flow-ok',
  warn: 'border-flow-warn text-flow-warn',
  danger: 'border-flow-danger text-flow-danger',
  accent: 'border-flow-accent text-flow-accent',
  muted: 'border-flow-border text-flow-text-muted',
};

/** Colored short chip for a run's script_execution outcome. */
function ExecutionBadge({ value }: { value: ScriptExecutionState | null }) {
  const { t } = useTranslation(['dialogs']);
  const info = executionBadgeInfo(t, value);
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border bg-flow-elevated px-1.5 py-0.5 font-mono text-[10px]',
        TONE_CLASS[info.tone]
      )}
    >
      {info.label}
    </span>
  );
}

/** How long a node stayed highlighted after a debug-tab step click. */
const STEP_FLASH_MS = 1200;

export interface DebugTabProps {
  className?: string;
}

/**
 * Right-panel Debug tab (design doc §7): live-trace toggle + status, run
 * history, selected run's step list (click a step to pan the canvas to and
 * flash that node), and a collapsible manual simulation section. Absorbs the
 * old AutomationTraceViewer/TraceSimulator/SpeedControl presentation into one
 * surface; useLiveTrace's fetch machinery is untouched.
 */
export function DebugTab({ className }: DebugTabProps) {
  const { t } = useTranslation(['common', 'dialogs', 'nodes', 'simulator']);
  const { hass, entities } = useHass();
  const {
    automationId,
    traceData,
    isShowingTrace,
    traceExecutionPath,
    traceTimestamps,
    nodeTraceStates,
    nodes,
    traceRunsVersion,
    showTrace,
    hideTrace,
    setActiveNode,
    activeNodeId,
    simulationSpeed,
    setSimulationSpeed,
    isSimulating,
  } = useFlowStore();
  const { isLive, toggleLive, runState, lastError } = useLiveTrace();
  const { fitView } = useReactFlow();

  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [selectedTraceRunId, setSelectedTraceRunId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [simulatorExpanded, setSimulatorExpanded] = useState(false);
  const isLiveRef = useRef(isLive);
  const stepListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  const showTraceRun = useCallback(
    async (runId: string) => {
      if (!automationId || !hass || !runId) return;

      setIsLoading(true);
      try {
        const api = getHomeAssistantAPI(hass);
        const traceDetails = await api.getAutomationTraceDetails(automationId, runId);
        if (traceDetails) showTrace(traceDetails);
      } catch (error) {
        logger.error('Failed to load trace details:', error);
      }
      setIsLoading(false);
    },
    [automationId, hass, showTrace]
  );

  const loadTraceList = useCallback(async () => {
    if (!automationId || !hass) return;

    setIsLoading(true);
    try {
      const api = getHomeAssistantAPI(hass);
      const traceList = await api.getAutomationTraces(automationId);
      setTraces(traceList);

      // Auto-select and show the most recent run. Live mode drives showTrace
      // itself, so it only gets the refreshed list.
      if (traceList.length > 0 && !isLiveRef.current) {
        const firstRunId = traceList[0].run_id;
        setSelectedTraceRunId(firstRunId);
        await showTraceRun(firstRunId);
      }
    } catch (error) {
      logger.error('Failed to load automation traces:', error);
      setTraces([]);
    }
    setIsLoading(false);
  }, [automationId, hass, showTraceRun]);

  useEffect(() => {
    if (automationId && hass) loadTraceList();
  }, [automationId, hass, loadTraceList]);

  // Live tracing bumps traceRunsVersion when it observes new runs — refresh
  // the run list (labels/badges) without stealing the shown trace.
  useEffect(() => {
    if (traceRunsVersion === 0 || !automationId || !hass) return;
    const api = getHomeAssistantAPI(hass);
    api
      .getAutomationTraces(automationId)
      .then(setTraces)
      .catch((error) => logger.error('Failed to refresh automation traces:', error));
  }, [traceRunsVersion, automationId, hass]);

  // While live, the run picker follows the in-flight run.
  useEffect(() => {
    if (isLive && traceData) setSelectedTraceRunId(traceData.run_id);
  }, [isLive, traceData]);

  // Step list follows the newest step while a run is in progress.
  const stepCount = traceExecutionPath.length;
  useEffect(() => {
    const list = stepListRef.current;
    if (list && stepCount > 0 && traceData?.state === 'running') {
      list.scrollTop = list.scrollHeight;
    }
  }, [stepCount, traceData?.state]);

  // "Live" toggle defaults ON when an automation is open and its entity is
  // enabled (design doc §7) — applied once per opened automation, so the
  // user's own toggle afterward is never fought.
  const automationEntity = automationId
    ? entities.find((entity) => String(entity.attributes.id) === automationId)
    : undefined;
  const appliedDefaultForId = useRef<string | null>(null);
  useEffect(() => {
    if (!automationId) return;
    if (appliedDefaultForId.current === automationId) return;
    if (automationEntity) {
      appliedDefaultForId.current = automationId;
      useFlowStore.getState().setLiveTrace(automationEntity.state === 'on');
    }
  }, [automationId, automationEntity]);

  const handleTraceSelection = useCallback(
    (runId: string) => {
      setSelectedTraceRunId(runId);
      showTraceRun(runId);
    },
    [showTraceRun]
  );

  const handleStopTrace = useCallback(() => {
    if (isLive) toggleLive();
    hideTrace();
    setActiveNode(null);
    setIsAnimating(false);
  }, [isLive, toggleLive, hideTrace, setActiveNode]);

  const animateTrace = useCallback(async () => {
    if (!traceExecutionPath.length || isSimulating) return;
    setIsAnimating(true);
    try {
      for (const nodeId of traceExecutionPath) {
        setActiveNode(nodeId);
        await new Promise((resolve) => setTimeout(resolve, simulationSpeed));
        if (!isShowingTrace) break;
      }
      setActiveNode(null);
    } catch (error) {
      logger.error('Trace animation error:', error);
    }
    setIsAnimating(false);
  }, [traceExecutionPath, simulationSpeed, setActiveNode, isShowingTrace, isSimulating]);

  const handleStopAnimation = useCallback(() => {
    setIsAnimating(false);
    setActiveNode(null);
  }, [setActiveNode]);

  // Click a step: pan/zoom the canvas to its node and flash it (accent
  // spotlight ring via NodeShell's `isActive`) for a moment.
  const handleStepClick = useCallback(
    (nodeId: string) => {
      setActiveNode(nodeId);
      fitView({ nodes: [{ id: nodeId }], duration: 400, maxZoom: 1 });
      // No cancellation needed for a superseded flash: the nodeId check
      // means an earlier timeout firing late only ever no-ops.
      setTimeout(() => {
        if (useFlowStore.getState().activeNodeId === nodeId) setActiveNode(null);
      }, STEP_FLASH_MS);
    },
    [setActiveNode, fitView]
  );

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  const formatRunDuration = (start: string, end?: string | null) => {
    try {
      const startTime = new Date(start);
      const endTime = end ? new Date(end) : new Date();
      const duration = endTime.getTime() - startTime.getTime();
      return `${(duration / 1000).toFixed(1)}s`;
    } catch {
      return t('labels.notApplicable');
    }
  };

  const formatRelativeTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const diffMins = Math.floor((Date.now() - date.getTime()) / 60_000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('dialogs:import.justNow');
    if (diffMins < 60) return t('dialogs:import.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('dialogs:import.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('dialogs:import.daysAgo', { count: diffDays });
    return date.toLocaleDateString();
  };

  const nodeLabel = (nodeId: string): string => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return nodeId;
    if (node.data.alias) return node.data.alias;
    switch (node.type) {
      case 'trigger':
        return t('nodes:types.trigger');
      case 'condition':
        return t('nodes:types.condition');
      case 'action':
        return t('nodes:types.action');
      case 'delay':
        return t('nodes:types.delay');
      case 'wait':
        return t('nodes:types.wait');
      case 'set_variables':
        return t('nodes:types.set_variables');
      default:
        return nodeId;
    }
  };

  if (!automationId) {
    return (
      <div className={cn('flex h-full items-center justify-center p-4', className)}>
        <span className="text-center font-mono text-flow-text-muted text-xs">
          {t('dialogs:traceViewer.saveAutomationFirst')}
        </span>
      </div>
    );
  }

  const visitCounters: Record<string, number> = {};

  return (
    <div className={cn('flex h-full flex-col gap-3 overflow-y-auto p-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-medium font-mono text-flow-text text-xs">
            {t('labels.automationTrace')}
          </span>
          {isLive && runState !== 'idle' && (
            <span
              className={cn(
                'shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px]',
                runState === 'running'
                  ? 'border-flow-ok text-flow-ok'
                  : 'animate-pulse border-flow-accent text-flow-accent'
              )}
            >
              {runState === 'running'
                ? t('dialogs:traceViewer.runInProgress')
                : t('dialogs:traceViewer.listening')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={toggleLive}
            title={isLive ? t('dialogs:traceViewer.liveStop') : t('dialogs:traceViewer.liveStart')}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-flow-control border transition-colors duration-flow-fast',
              isLive
                ? 'border-flow-danger bg-flow-elevated text-flow-danger'
                : 'border-flow-border text-flow-text-secondary hover:bg-flow-elevated hover:text-flow-text'
            )}
          >
            <RadioTower className={cn('h-3.5 w-3.5', isLive && 'animate-pulse')} />
          </button>
          {isShowingTrace && !isAnimating && (
            <button
              type="button"
              onClick={animateTrace}
              disabled={!traceExecutionPath.length || isSimulating}
              title={t('simulator:trace.heading')}
              className="flex h-7 w-7 items-center justify-center rounded-flow-control border border-flow-border text-flow-text-secondary transition-colors duration-flow-fast hover:bg-flow-elevated hover:text-flow-text disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {isAnimating && (
            <button
              type="button"
              onClick={handleStopAnimation}
              className="flex h-7 w-7 items-center justify-center rounded-flow-control border border-flow-warn text-flow-warn"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          )}
          {isShowingTrace ? (
            <button
              type="button"
              onClick={handleStopTrace}
              className="flex h-7 w-7 items-center justify-center rounded-flow-control border border-flow-border text-flow-text-secondary transition-colors duration-flow-fast hover:bg-flow-elevated hover:text-flow-text"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={loadTraceList}
              disabled={isLoading}
              className="flex h-7 w-7 items-center justify-center rounded-flow-control border border-flow-border text-flow-text-secondary transition-colors duration-flow-fast hover:bg-flow-elevated hover:text-flow-text disabled:pointer-events-none disabled:opacity-40"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {isLive && lastError && (
        <div className="flex items-center gap-1 rounded-flow-control border border-flow-danger bg-flow-elevated p-1.5 font-mono text-[11px] text-flow-danger">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate" title={lastError}>
            {lastError}
          </span>
        </div>
      )}

      {traces.length === 0 && !isLoading && (
        <div className="text-center font-mono text-flow-text-muted text-xs">
          {t('dialogs:traceViewer.noTracesFound')}
        </div>
      )}

      {traces.length > 0 && (
        <div className="space-y-1">
          <span className="font-mono text-[11px] text-flow-text-muted">
            {t('labels.selectTraceRun')}
          </span>
          <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-flow-control border border-flow-border">
            {traces.map((run) => (
              <button
                key={run.run_id}
                type="button"
                onClick={() => handleTraceSelection(run.run_id)}
                className={cn(
                  'flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left font-mono text-[11px] transition-colors duration-flow-fast',
                  run.run_id === selectedTraceRunId
                    ? 'border-l-flow-accent bg-flow-elevated text-flow-text'
                    : 'border-l-transparent text-flow-text-secondary hover:bg-flow-elevated'
                )}
              >
                <Clock className="h-3 w-3 shrink-0 text-flow-text-muted" />
                <span title={new Date(run.timestamp.start).toLocaleString()}>
                  {formatRelativeTime(run.timestamp.start)}
                </span>
                <span className="text-flow-text-muted">
                  ({formatRunDuration(run.timestamp.start, run.timestamp.finish)})
                </span>
                <span className="ml-auto">
                  <ExecutionBadge value={run.script_execution} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {isShowingTrace && traceData && (
        <div className="space-y-3">
          <div className="space-y-1 border-flow-border border-t pt-2">
            <span className="font-mono text-[11px] text-flow-text-muted">
              {t('dialogs:traceViewer.summary')}
            </span>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-flow-text-muted">{t('dialogs:traceViewer.result')}</span>
                <ExecutionBadge value={traceData.script_execution} />
              </div>
              <div className="flex justify-between">
                <span className="text-flow-text-muted">{t('labels.trigger')}</span>
                <span className="ml-2 truncate text-flow-text">{traceData.trigger}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-flow-text-muted">{t('dialogs:traceViewer.started')}</span>
                <span className="text-flow-text">
                  {new Date(traceData.timestamp.start).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-flow-text-muted">{t('labels.duration')}</span>
                <span className="text-flow-text">
                  {formatRunDuration(traceData.timestamp.start, traceData.timestamp.finish)}
                </span>
              </div>
              {traceData.error && (
                <div className="flex items-start gap-1 rounded-flow-control border border-flow-danger bg-flow-elevated p-1.5 text-flow-danger">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="break-all">{traceData.error}</span>
                </div>
              )}
            </div>
          </div>

          {traceExecutionPath.length > 0 && (
            <div className="space-y-1 border-flow-border border-t pt-2">
              <span className="font-mono text-[11px] text-flow-text-muted">
                {t('labels.executionPath')}
              </span>
              <div ref={stepListRef} className="max-h-64 space-y-0.5 overflow-y-auto">
                {traceExecutionPath.map((nodeId, index) => {
                  visitCounters[nodeId] = (visitCounters[nodeId] ?? 0) + 1;
                  const nodeState = nodeTraceStates[nodeId];
                  const conditionResult = nodeState?.result?.result;
                  return (
                    <button
                      key={`step-${nodeId}-${visitCounters[nodeId]}`}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-flow-control border px-1.5 py-1 text-left font-mono text-[11px] transition-colors duration-flow-fast',
                        activeNodeId === nodeId
                          ? 'border-flow-accent bg-flow-elevated'
                          : 'border-transparent hover:bg-flow-elevated'
                      )}
                      onClick={() => handleStepClick(nodeId)}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-flow-accent text-[9px] text-flow-on-accent">
                        {index + 1}
                      </span>
                      <span className="truncate font-medium text-flow-text">{nodeLabel(nodeId)}</span>
                      {conditionResult === true && (
                        <span className="shrink-0 rounded-full border border-flow-ok px-1 text-[9px] text-flow-ok">
                          {t('simulator:trace.true')}
                        </span>
                      )}
                      {conditionResult === false && (
                        <span className="shrink-0 rounded-full border border-flow-warn px-1 text-[9px] text-flow-warn">
                          {t('simulator:trace.false')}
                        </span>
                      )}
                      {nodeState?.status === 'error' && (
                        <span
                          className="truncate rounded-full border border-flow-danger px-1 text-[9px] text-flow-danger"
                          title={nodeState.error}
                        >
                          {nodeState.error ?? t('dialogs:traceViewer.execution.error')}
                        </span>
                      )}
                      {traceTimestamps[nodeId] && (
                        <span className="ml-auto shrink-0 text-flow-text-muted">
                          {formatTimestamp(traceTimestamps[nodeId])}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="text-center font-mono text-flow-text-muted text-xs">
          {t('status.loadingTraces')}
        </div>
      )}

      <div className="mt-auto border-flow-border border-t pt-2">
        <button
          type="button"
          onClick={() => setSimulatorExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between font-mono text-[11px] text-flow-text-secondary hover:text-flow-text"
        >
          <span>{t('simulator:trace.heading')}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform duration-flow-fast', simulatorExpanded && 'rotate-180')}
          />
        </button>
        {simulatorExpanded && (
          <div className="mt-2 space-y-3 rounded-flow-control border border-flow-border p-2">
            <SpeedControl speed={simulationSpeed} onSpeedChange={setSimulationSpeed} />
            <TraceSimulator />
          </div>
        )}
      </div>
    </div>
  );
}
