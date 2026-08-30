import { memo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Marquee timing for clipped-text autoscroll (design doc §5 sweep: "selected
 * elements reveal their clipped text"). Tuned for fast readers: a typical
 * clipped 40-char mono label overflows a node card by ~120-150px, so the
 * reveal leg takes ~1.5-1.8s and a full cycle stays under ~4s.
 */
export const MARQUEE_TIMING = {
  /** Reveal speed (px/s). Constant-rate so reading speed never varies mid-scroll. */
  scrollPxPerSec: 85,
  /** Return-to-start speed (px/s) — 2x reveal; the way back carries no information. */
  returnPxPerSec: 170,
  /** Hold before the first move so selecting never feels jumpy. */
  startDelayMs: 400,
  /** Hold with the tail revealed so the end of the string can actually be read. */
  endHoldMs: 800,
} as const;

export type MarqueeTiming = typeof MARQUEE_TIMING;

export interface MarqueePlan {
  durationMs: number;
  keyframes: Keyframe[];
}

/**
 * Builds the WAAPI keyframe plan for one marquee cycle:
 * hold at start → linear scroll to `-distancePx` → hold at end → eased return.
 * Distance-proportional legs keep the *speed* constant regardless of how much
 * text is clipped. Returns null when nothing is meaningfully clipped
 * (`distancePx <= 1` absorbs sub-pixel scrollWidth/clientWidth rounding), so
 * callers can gate "only animate when the text actually overflows" on it.
 */
export function buildMarqueeKeyframes(
  distancePx: number,
  timing: MarqueeTiming = MARQUEE_TIMING
): MarqueePlan | null {
  if (!(distancePx > 1)) return null;

  const scrollMs = (distancePx / timing.scrollPxPerSec) * 1000;
  const returnMs = (distancePx / timing.returnPxPerSec) * 1000;
  const durationMs = timing.startDelayMs + scrollMs + timing.endHoldMs + returnMs;
  const at = (ms: number) => ms / durationMs;
  const end = `translateX(${-distancePx}px)`;

  return {
    durationMs,
    keyframes: [
      { offset: 0, transform: 'translateX(0px)', easing: 'linear' },
      { offset: at(timing.startDelayMs), transform: 'translateX(0px)', easing: 'linear' },
      { offset: at(timing.startDelayMs + scrollMs), transform: end, easing: 'linear' },
      {
        offset: at(timing.startDelayMs + scrollMs + timing.endHoldMs),
        transform: end,
        // --ease-out-warm (theme/tokens.css); WAAPI needs the literal value.
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      { offset: 1, transform: 'translateX(0px)' },
    ],
  };
}

export interface MarqueeTextProps {
  text: string;
  /** Animate only while true (a selected node/row) — idle elements cost nothing. */
  active?: boolean;
  /** Typography/color/spacing classes for the clipping box. */
  className?: string;
  /** Tooltip; defaults to `text` so the full value stays reachable without motion. */
  title?: string;
}

/**
 * Single-line text that truncates with an ellipsis at rest and, while
 * `active` and actually clipped, autoscrolls (translateX marquee) so the whole
 * string can be read, looping until deactivated. Deactivation cancels the
 * animation, which snaps the text back to translateX(0) and restores the
 * ellipsis — nothing is ever left mid-scroll.
 *
 * Compositor-only: the WAAPI animation drives `transform` on an inner span
 * inside an overflow-hidden box, so scrolling never causes layout or resizes
 * the host. `prefers-reduced-motion: reduce` disables the animation entirely
 * (live — flipping the OS setting stops an in-flight marquee); the `title`
 * tooltip keeps the full value reachable.
 */
export const MarqueeText = memo(function MarqueeText({
  text,
  active = false,
  className,
  title,
}: MarqueeTextProps) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  // `text` is deliberately a dependency the effect body never reads: a rename
  // changes the rendered content (and so the overflow distance) without
  // resizing the clip box, which the ResizeObserver below can't see.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!active || !outer || !inner || typeof inner.animate !== 'function') return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animation: Animation | null = null;

    const stop = () => {
      animation?.cancel();
      animation = null;
      inner.style.willChange = '';
      outer.style.textOverflow = '';
    };

    const start = () => {
      stop();
      if (reducedMotion.matches) return;
      const plan = buildMarqueeKeyframes(outer.scrollWidth - outer.clientWidth);
      if (!plan) return;
      // The ellipsis would sit painted over the moving text — clip while scrolling.
      outer.style.textOverflow = 'clip';
      inner.style.willChange = 'transform';
      animation = inner.animate(plan.keyframes, {
        duration: plan.durationMs,
        iterations: Infinity,
      });
    };

    start();

    // Re-plan when the clip box resizes (panel drag, container reflow) or the
    // motion preference flips; both observers live only while active.
    const observer = new ResizeObserver(start);
    observer.observe(outer);
    reducedMotion.addEventListener('change', start);

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener('change', start);
      stop();
    };
  }, [active, text]);

  return (
    <span ref={outerRef} className={cn('block truncate', className)} title={title ?? text}>
      <span ref={innerRef} className="inline-block w-max">
        {text}
      </span>
    </span>
  );
});
