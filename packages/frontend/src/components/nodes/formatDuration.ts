// Shared duration formatting for Delay and Wait nodes
export interface DurationObject {
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}

export function formatDuration(val: string | DurationObject | undefined): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const parts = [];
    if (val.hours) parts.push(`${val.hours}h`);
    if (val.minutes) parts.push(`${val.minutes}m`);
    if (val.seconds) parts.push(`${val.seconds}s`);
    if (val.milliseconds) parts.push(`${val.milliseconds}ms`);
    return parts.join(' ') || '0s';
  }
  return String(val);
}

/**
 * Parses a delay/timeout value into milliseconds. Handles duration objects,
 * HA time-period strings (`HH:MM` / `HH:MM:SS`), and plain second counts.
 * Returns null for templates and otherwise unparseable input.
 */
export function durationToMs(val: string | DurationObject | undefined): number | null {
  if (val == null) return null;
  if (typeof val === 'object') {
    return (
      (val.hours ?? 0) * 3_600_000 +
      (val.minutes ?? 0) * 60_000 +
      (val.seconds ?? 0) * 1_000 +
      (val.milliseconds ?? 0)
    );
  }
  const parts = val.split(':');
  if (parts.length > 3 || parts.some((part) => part.trim() === '')) return null;
  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;
  if (parts.length === 1) return Math.round(numbers[0] * 1000);
  // HA time-period strings are HH:MM or HH:MM:SS
  const [hours, minutes, seconds = 0] = numbers;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}
