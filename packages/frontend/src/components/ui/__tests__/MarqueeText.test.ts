import { describe, expect, it } from 'vitest';
import { buildMarqueeKeyframes, MARQUEE_TIMING } from '../MarqueeText';

describe('buildMarqueeKeyframes', () => {
  it('returns null unless a meaningful amount of text is hidden', () => {
    expect(buildMarqueeKeyframes(0)).toBeNull();
    expect(buildMarqueeKeyframes(1)).toBeNull();
    expect(buildMarqueeKeyframes(-40)).toBeNull();
    // A few pixels hide at most a fraction of a character; scrolling that far
    // is a twitch, not a reveal. Observed live on a freshly dropped node.
    expect(buildMarqueeKeyframes(6)).toBeNull();
    expect(buildMarqueeKeyframes(9)).toBeNull();
    expect(buildMarqueeKeyframes(10)).not.toBeNull();
  });

  it('builds a start-hold / scroll / end-hold / return cycle at constant reveal speed', () => {
    const distance = 140;
    const plan = buildMarqueeKeyframes(distance);
    expect(plan).not.toBeNull();
    if (!plan) return;

    const { startDelayMs, endHoldMs, scrollPxPerSec, returnPxPerSec } = MARQUEE_TIMING;
    const scrollMs = (distance / scrollPxPerSec) * 1000;
    const returnMs = (distance / returnPxPerSec) * 1000;
    expect(plan.durationMs).toBeCloseTo(startDelayMs + scrollMs + endHoldMs + returnMs, 6);

    const [k0, k1, k2, k3, k4] = plan.keyframes;
    // Starts and loops from translateX(0) so cancel/deselect can never strand mid-scroll.
    expect(k0).toMatchObject({ offset: 0, transform: 'translateX(0px)' });
    expect(k4).toMatchObject({ offset: 1, transform: 'translateX(0px)' });
    // Initial hold: no movement until startDelayMs.
    expect(k1.transform).toBe('translateX(0px)');
    expect((k1.offset as number) * plan.durationMs).toBeCloseTo(startDelayMs, 6);
    // Scroll leg is linear (constant px/s) and lands exactly at -distance.
    expect(k1.easing).toBe('linear');
    expect(k2.transform).toBe(`translateX(${-distance}px)`);
    expect((k2.offset as number) * plan.durationMs).toBeCloseTo(startDelayMs + scrollMs, 6);
    // End hold keeps the tail readable for endHoldMs before the eased return.
    expect(k3.transform).toBe(`translateX(${-distance}px)`);
    expect((k3.offset as number) * plan.durationMs).toBeCloseTo(
      startDelayMs + scrollMs + endHoldMs,
      6
    );
    // Offsets must be strictly increasing or WAAPI rejects the keyframes.
    const offsets = plan.keyframes.map((k) => k.offset as number);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
  });

  it('keeps a typical clipped label cycle brisk (reveal < 2s, cycle < 4.5s)', () => {
    // ~40-char mono label in a 220px node card clips by roughly 140px.
    const plan = buildMarqueeKeyframes(140);
    if (!plan) throw new Error('expected a plan');
    const revealMs = (140 / MARQUEE_TIMING.scrollPxPerSec) * 1000;
    expect(revealMs).toBeLessThan(2000);
    expect(plan.durationMs).toBeLessThan(4500);
  });
});
