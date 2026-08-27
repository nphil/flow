import { useEffect, useState } from 'react';

/** Formats milliseconds as a compact ticking clock: `42s`, `3:07`, `1:02:07`. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  return `${seconds}s`;
}

/**
 * Ticking countdown for Delay/Wait nodes during a live trace.
 *
 * While `enabled`, re-renders every 500ms measuring from `startIso` (the
 * trace step's first-visit timestamp):
 * - with a known total duration → remaining time (clamped at 0),
 * - without one → elapsed count-up.
 *
 * Returns null when disabled or the start timestamp is unusable.
 */
export function useTraceCountdown(
  enabled: boolean,
  startIso: string | undefined,
  totalMs: number | null
): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !startIso) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [enabled, startIso]);

  if (!enabled || !startIso) return null;
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return null;

  const elapsed = Math.max(0, now - start);
  return formatCountdown(totalMs != null ? totalMs - elapsed : elapsed);
}
