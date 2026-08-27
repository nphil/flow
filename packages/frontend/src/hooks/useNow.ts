import { useEffect, useState } from 'react';

/**
 * Ticks every `intervalMs` so components deriving values from `Date.now()` at render time
 * (e.g. the automations list's "5 minutes ago" labels) re-render on a timer instead of
 * polling a data source -- the underlying data (HA entity state) is already pushed live via
 * HassContext; only the *display* of elapsed time needs a clock.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
