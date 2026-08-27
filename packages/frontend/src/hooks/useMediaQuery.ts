import { useSyncExternalStore } from 'react';

function subscribe(query: string, callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

/**
 * Reactive `window.matchMedia` boolean. Used for the design doc §4 <768px mobile layout
 * breakpoint (left/right panels become overlay drawers).
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => subscribe(query, callback),
    () => window.matchMedia(query).matches,
    () => false
  );
}

/** Design doc §4: below this width, panels become full-height overlay drawers. */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_BREAKPOINT_QUERY);
}
