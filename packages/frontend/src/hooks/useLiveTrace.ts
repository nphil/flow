import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@/contexts/HassContext';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { logger } from '@/lib/logger';
import { useFlowStore } from '@/store/flow-store';

export type LiveTraceRunState = 'idle' | 'waiting' | 'running';

/**
 * Payload of HA's `automation_triggered` bus event. `run_id` is never
 * included — it has to be resolved afterwards via `trace/contexts`, matching
 * the event's `context.id` against a stored trace's context.
 */
interface AutomationTriggeredEvent {
  data: {
    entity_id?: string;
    name?: string;
    source?: string;
  };
  context: {
    id: string;
    parent_id?: string;
    user_id?: string;
  };
}

// A trace may not be registered under `trace/contexts` yet at the instant
// the trigger event fires, so matching the event to a run is retried briefly.
const CONTEXT_MATCH_RETRIES = 5;
const CONTEXT_MATCH_RETRY_DELAY_MS = 300;

// Poll quickly while a run is likely still active, then back off the longer
// it keeps running, and give up entirely well past any realistic duration.
const POLL_INTERVAL_FAST_MS = 350;
const POLL_INTERVAL_MEDIUM_MS = 1_000;
const POLL_INTERVAL_SLOW_MS = 2_000;
const POLL_MEDIUM_AFTER_MS = 30_000;
const POLL_SLOW_AFTER_MS = 2 * 60_000;
const POLL_HARD_STOP_MS = 10 * 60_000;

/**
 * Drives the Node-RED-style live trace overlay: while enabled, subscribes to
 * `automation_triggered` for the currently-open automation and polls
 * `trace/get` for the resulting run, feeding each snapshot into the flow
 * store via `showTrace` until the run stops.
 */
export function useLiveTrace(): {
  isLive: boolean;
  toggleLive: () => void;
  runState: LiveTraceRunState;
  lastError: string | null;
} {
  const { hass, connection, entities } = useHass();
  const isLive = useFlowStore((state) => state.isLiveTrace);
  const automationId = useFlowStore((state) => state.automationId);

  const [runState, setRunState] = useState<LiveTraceRunState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  // Mirrors read by the long-lived subscription callback and poll loop so
  // they always see fresh values without resubscribing on every change (in
  // particular `entities`, which changes on virtually every HA state tick).
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const automationIdRef = useRef(automationId);
  automationIdRef.current = automationId;

  // Bumped whenever a poll loop starts or must be abandoned, so a stale
  // loop (an older run, or one torn down by cleanup) can tell it's no
  // longer the active one and stop scheduling further ticks.
  const pollGenerationRef = useRef(0);

  const toggleLive = useCallback(() => {
    useFlowStore.getState().setLiveTrace(!isLive);
  }, [isLive]);

  useEffect(() => {
    if (!isLive || !automationId || !connection) {
      setRunState('idle');
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setRunState('waiting');
    setLastError(null);

    const startPolling = (runId: string) => {
      const myGeneration = ++pollGenerationRef.current;
      const startedAt = Date.now();
      setRunState('running');
      setLastError(null);

      const poll = async () => {
        if (cancelled || pollGenerationRef.current !== myGeneration) return;

        const elapsed = Date.now() - startedAt;
        if (elapsed >= POLL_HARD_STOP_MS) {
          setRunState('waiting');
          setLastError('Live trace polling timed out after 10 minutes');
          return;
        }

        const hassValue = hassRef.current;
        const automationIdValue = automationIdRef.current;
        if (!hassValue || !automationIdValue) return;

        try {
          const api = getHomeAssistantAPI(hassValue);
          const trace = await api.getAutomationTraceDetails(automationIdValue, runId);
          if (cancelled || pollGenerationRef.current !== myGeneration) return;

          if (trace) {
            useFlowStore.getState().showTrace(trace);

            if (trace.state === 'stopped') {
              useFlowStore.getState().bumpTraceRuns();
              setRunState('waiting');
              return;
            }
          }
        } catch (error) {
          logger.error('Live trace: failed to poll trace details:', error);
        }

        if (cancelled || pollGenerationRef.current !== myGeneration) return;
        const nextIntervalMs =
          elapsed >= POLL_SLOW_AFTER_MS
            ? POLL_INTERVAL_SLOW_MS
            : elapsed >= POLL_MEDIUM_AFTER_MS
              ? POLL_INTERVAL_MEDIUM_MS
              : POLL_INTERVAL_FAST_MS;
        setTimeout(poll, nextIntervalMs);
      };

      poll();
    };

    const handleTriggered = async (event: AutomationTriggeredEvent) => {
      const currentAutomationId = automationIdRef.current;
      const entityId = event.data.entity_id;
      const contextId = event.context.id;
      if (!currentAutomationId || !entityId || !contextId) return;

      // Fast pre-check: if the triggered entity's own `id` attribute is
      // known and doesn't match, this trigger is for a different automation
      // — skip without touching the network at all.
      const entity = entitiesRef.current.find((candidate) => candidate.entity_id === entityId);
      const entityAttributeId = entity?.attributes.id;
      const resolvedEntityAutomationId =
        typeof entityAttributeId === 'string' || typeof entityAttributeId === 'number'
          ? String(entityAttributeId)
          : undefined;
      if (
        resolvedEntityAutomationId !== undefined &&
        resolvedEntityAutomationId !== currentAutomationId
      ) {
        return;
      }

      const hassValue = hassRef.current;
      if (!hassValue) return;
      const api = getHomeAssistantAPI(hassValue);

      for (let attempt = 0; attempt < CONTEXT_MATCH_RETRIES; attempt += 1) {
        if (cancelled) return;
        const contexts = await api.getTraceContexts();
        const match = contexts[contextId];
        if (match && match.item_id === currentAutomationId) {
          if (!cancelled) startPolling(match.run_id);
          return;
        }
        if (attempt < CONTEXT_MATCH_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, CONTEXT_MATCH_RETRY_DELAY_MS));
        }
      }

      // Only surface a failure when the entity check positively identified
      // this trigger as ours — an inconclusive pre-check (attributes
      // unavailable) exhausting retries just means the event was probably
      // for a different automation, which is expected and not an error.
      if (resolvedEntityAutomationId === currentAutomationId && !cancelled) {
        logger.warn('Live trace: triggered automation matched but its trace never appeared');
        setLastError('Could not locate the trace for the latest run');
      }
    };

    connection
      .subscribeEvents<AutomationTriggeredEvent>(handleTriggered, 'automation_triggered')
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch((error) => {
        logger.error('Live trace: failed to subscribe to automation_triggered:', error);
        if (!cancelled) setLastError('Failed to subscribe to live trigger events');
      });

    return () => {
      cancelled = true;
      pollGenerationRef.current += 1;
      unsubscribe?.();
    };
  }, [isLive, automationId, connection]);

  return { isLive, toggleLive, runState, lastError };
}
