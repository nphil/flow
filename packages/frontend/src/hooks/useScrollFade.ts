import { useEffect, useRef, useState } from 'react';

/**
 * Right-panel horizontal strips (design doc §4/§5: tab strip, Automations filter chips):
 * reports whether a scroll container's content is actually wider than its box, so callers can
 * show a right-edge fade mask (the `.flow-scroll-fade` utility in index.css) only while there's
 * really more to scroll to -- never as a permanent decoration. Re-measures on resize (panel
 * width drag, mobile drawer open) via ResizeObserver, and on every render so content changes
 * (locale swaps, filter counts) that don't themselves resize the container are still caught.
 */
export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => setIsOverflowing(node.scrollWidth > node.clientWidth + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  return { ref, isOverflowing };
}
