import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Check,
  Clock,
  History,
  Play,
  RadioTower,
  RotateCcw,
  Square,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useHass } from '@/contexts/HassContext';
import { useLiveTrace } from '@/hooks/useLiveTrace';
import { getHomeAssistantAPI, type ScriptExecutionState, type TraceListItem } from '@/lib/ha-api';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

function executionBadgeInfo(
  t: TFunction<['dialogs']>,
  value: ScriptExecutionState | null
): { label: string; className: string } {
  switch (value) {
    case 'finished':
      return {
        label: t('dialogs:traceViewer.execution.finished'),
        className: 'bg-green-100 text-green-700',
      };
    case 'aborted':
      return {
        label: t('dialogs:traceViewer.execution.aborted'),
        className: 'bg-red-100 text-red-700',
      };
    case 'cancelled':
      return {
        label: t('dialogs:traceViewer.execution.cancelled'),
        className: 'bg-gray-100 text-gray-600',
      };
    case 'error':
      return {
        label: t('dialogs:traceViewer.execution.error'),
        className: 'bg-red-100 text-red-700',
      };
    case 'failed_conditions':
      return {
        label: t('dialogs:traceViewer.execution.failed_conditions'),
        className: 'bg-orange-100 text-orange-700',
      };
    case 'failed_single':
      return {
        label: t('dialogs:traceViewer.execution.failed_single'),
        className: 'bg-red-100 text-red-700',
      };
    case 'failed_max_runs':
      return {
        label: t('dialogs:traceViewer.execution.failed_max_runs'),
        className: 'bg-red-100 text-red-700',
      };
    case 'not_triggered':
      return {
        label: t('dialogs:traceViewer.execution.not_triggered'),
        className: 'bg-orange-100 text-orange-700',
      };
    case 'disallowed_recursion_detected':
      return {
        label: t('dialogs:traceViewer.execution.disallowed_recursion_detected'),
        className: 'bg-red-100 text-red-700',
      };
    case null:
      return {
        label: t('dialogs:traceViewer.execution.running'),
        className: 'bg-yellow-100 text-yellow-700',
      };
    default:
      // HA may grow new terminal states; show them raw rather than crash.
      return { label: String(value), className: 'bg-yellow-100 text-yellow-700' };
  }
}

/** Colored short chip for a run's script_execution outcome. */
function ExecutionBadge({ value }: { value: ScriptExecutionState | null }) {
  const { t } = useTranslation(['dialogs']);
  const info = executionBadgeInfo(t, value);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-medium text-[10px]',
        info.className
      )}
    >
      {value === 'finished' && <Check className="h-2.5 w-2.5" />}
      {info.label}
    </span>
  );
}

export function AutomationTraceViewer() {
  const { t } = useTranslation(['common', 'dialogs', 'nodes', 'simulator']);
  const { hass } = useHass();
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
    simulationSpeed,
    isSimulating,
  } = useFlowStore();
  const { isLive, toggleLive, runState, lastError } = useLiveTrace();

  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [selectedTraceRunId, setSelectedTraceRunId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
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
        logger.info('Loaded trace details:', traceDetails);

        if (traceDetails) {
          showTrace(traceDetails);
        }
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
      logger.info('Loaded automation traces:', traceList);
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

  // Load trace list when component mounts or automation ID changes
  useEffect(() => {
    if (automationId && hass) {
      loadTraceList();
    }
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
    if (isLive && traceData) {
      setSelectedTraceRunId(traceData.run_id);
    }
  }, [isLive, traceData]);

  // Step list follows the newest step while a run is in progress.
  const stepCount = traceExecutionPath.length;
  useEffect(() => {
    const list = stepListRef.current;
    if (list && stepCount > 0 && traceData?.state === 'running') {
      list.scrollTop = list.scrollHeight;
    }
  }, [stepCount, traceData?.state]);

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
      // Animate through each step in the trace
      for (const nodeId of traceExecutionPath) {
        setActiveNode(nodeId);

        // Wait for the animation speed
        await new Promise((resolve) => setTimeout(resolve, simulationSpeed));

        // Check if animation was stopped
        if (!isShowingTrace) break;
      }

      // Clear active node when done
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

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  const formatDuration = (start: string, end?: string | null) => {
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
      <div className="h-full space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground text-sm">{t('labels.automationTrace')}</h3>
        </div>
        <div className="text-center text-muted-foreground text-sm">
          {t('dialogs:traceViewer.saveAutomationFirst')}
        </div>
      </div>
    );
  }

  const visitCounters: Record<string, number> = {};

  return (
    <div className="h-full space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="font-semibold text-foreground text-sm">{t('labels.automationTrace')}</h3>
          {isLive && runState !== 'idle' && (
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 font-medium text-[10px]',
                runState === 'running'
                  ? 'bg-green-100 text-green-700'
                  : 'animate-pulse bg-blue-100 text-blue-700'
              )}
            >
              {runState === 'running'
                ? t('dialogs:traceViewer.runInProgress')
                : t('dialogs:traceViewer.listening')}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleLive}
            title={isLive ? t('dialogs:traceViewer.liveStop') : t('dialogs:traceViewer.liveStart')}
            className={cn(
              'h-8 w-8 p-0',
              isLive
                ? 'border-red-300 bg-red-50 text-red-600 hover:bg-red-100'
                : 'border-blue-200 text-blue-600 hover:bg-blue-50'
            )}
          >
            <RadioTower className={cn('h-4 w-4', isLive && 'animate-pulse')} />
          </Button>
          {isShowingTrace && !isAnimating && (
            <Button
              variant="outline"
              size="sm"
              onClick={animateTrace}
              disabled={!traceExecutionPath.length || isSimulating}
              className={cn(
                'h-8 w-8 p-0',
                !traceExecutionPath.length || isSimulating
                  ? 'text-muted-foreground'
                  : 'border-orange-200 text-orange-600 hover:bg-orange-50'
              )}
            >
              <Play className="h-4 w-4" />
            </Button>
          )}
          {isAnimating && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStopAnimation}
              className="h-8 w-8 border-orange-200 p-0 text-orange-600 hover:bg-orange-50"
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          {isShowingTrace ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStopTrace}
              className="h-8 w-8 border-blue-200 p-0 text-blue-600 hover:bg-blue-50"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={loadTraceList}
              disabled={isLoading}
              className={cn(
                'h-8 w-8 p-0',
                isLoading
                  ? 'text-muted-foreground'
                  : 'border-blue-200 text-blue-600 hover:bg-blue-50'
              )}
            >
              <History className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {isLive && lastError && (
        <div className="flex items-center gap-1 rounded bg-red-50 p-1 text-red-700 text-xs">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate" title={lastError}>
            {lastError}
          </span>
        </div>
      )}

      {traces.length === 0 && !isLoading && (
        <div className="text-center text-muted-foreground text-sm">
          {t('dialogs:traceViewer.noTracesFound')}
        </div>
      )}

      {traces.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs">{t('labels.selectTraceRun')}</Label>
          <Select value={selectedTraceRunId} onValueChange={handleTraceSelection}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder={t('placeholders.selectTrace')} />
            </SelectTrigger>
            <SelectContent>
              {traces.map((trace) => (
                <SelectItem key={trace.run_id} value={trace.run_id}>
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3" />
                    <span
                      className="text-xs"
                      title={new Date(trace.timestamp.start).toLocaleString()}
                    >
                      {formatRelativeTime(trace.timestamp.start)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {'('}
                      {formatDuration(trace.timestamp.start, trace.timestamp.finish)}
                      {')'}
                    </span>
                    <ExecutionBadge value={trace.script_execution} />
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isShowingTrace && traceData && (
        <div className="space-y-2">
          <div className="border-t pt-2">
            <Label className="text-xs">{t('dialogs:traceViewer.summary')}</Label>
            <div className="mt-1 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('dialogs:traceViewer.result')}</span>
                <ExecutionBadge value={traceData.script_execution} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('labels.trigger')}</span>
                <span className="ml-2 truncate">{traceData.trigger}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('dialogs:traceViewer.started')}</span>
                <span>{new Date(traceData.timestamp.start).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('labels.duration')}</span>
                <span>{formatDuration(traceData.timestamp.start, traceData.timestamp.finish)}</span>
              </div>
              {traceData.error && (
                <div className="flex items-start gap-1 rounded bg-red-50 p-1 text-red-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="break-all">{traceData.error}</span>
                </div>
              )}
            </div>
          </div>

          {traceExecutionPath.length > 0 && (
            <div className="border-t pt-2">
              <Label className="text-xs">{t('labels.executionPath')}</Label>
              <div ref={stepListRef} className="mt-1 max-h-64 space-y-1 overflow-y-auto">
                {traceExecutionPath.map((nodeId, index) => {
                  visitCounters[nodeId] = (visitCounters[nodeId] ?? 0) + 1;
                  const nodeState = nodeTraceStates[nodeId];
                  const conditionResult = nodeState?.result?.result;
                  return (
                    <button
                      key={`step-${nodeId}-${visitCounters[nodeId]}`}
                      type="button"
                      className="flex w-full items-center gap-2 rounded bg-blue-50 p-1 text-blue-700 text-xs hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      onMouseEnter={() => setActiveNode(nodeId)}
                      onMouseLeave={() => setActiveNode(null)}
                      onFocus={() => setActiveNode(nodeId)}
                      onBlur={() => setActiveNode(null)}
                    >
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-200 text-xs">
                        {index + 1}
                      </div>
                      <span className="truncate font-medium">{nodeLabel(nodeId)}</span>
                      {conditionResult === true && (
                        <span className="shrink-0 rounded bg-green-100 px-1 text-[10px] text-green-700">
                          {t('simulator:trace.true')}
                        </span>
                      )}
                      {conditionResult === false && (
                        <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] text-red-700">
                          {t('simulator:trace.false')}
                        </span>
                      )}
                      {nodeState?.status === 'error' && (
                        <span
                          className="truncate rounded bg-red-100 px-1 text-[10px] text-red-700"
                          title={nodeState.error}
                        >
                          {nodeState.error ?? t('dialogs:traceViewer.execution.error')}
                        </span>
                      )}
                      {traceTimestamps[nodeId] && (
                        <span className="ml-auto shrink-0 text-muted-foreground">
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
        <div className="text-center text-muted-foreground text-sm">{t('status.loadingTraces')}</div>
      )}
    </div>
  );
}
