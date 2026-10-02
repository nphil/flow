// Shared duration formatting for Delay/Wait nodes and the plain-English node descriptions.
export interface DurationObject {
  hours?: number | string;
  minutes?: number | string;
  seconds?: number | string;
  milliseconds?: number | string;
}

export type DurationValue = string | number | DurationObject;

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** True for Jinja templates (`{{ ... }}` / `{% ... %}`), whose value is only known at run time. */
export function isTemplateString(value: unknown): boolean {
  return typeof value === 'string' && /\{[{%]/.test(value);
}

/** Reads a duration-object field as a number; null for templates and other non-numbers. */
function fieldToNumber(value: number | string | undefined): number | null {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Parses a delay/timeout value into milliseconds. Handles duration objects,
 * HA time-period strings (`HH:MM` / `HH:MM:SS`), and plain second counts.
 * Returns null for templates and otherwise unparseable input.
 */
export function durationToMs(val: DurationValue | undefined | null): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.round(val * MS_PER_SECOND) : null;
  if (typeof val === 'object') {
    const hours = fieldToNumber(val.hours);
    const minutes = fieldToNumber(val.minutes);
    const seconds = fieldToNumber(val.seconds);
    const milliseconds = fieldToNumber(val.milliseconds);
    if (hours === null || minutes === null || seconds === null || milliseconds === null) {
      return null;
    }
    return hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND + milliseconds;
  }
  const parts = val.split(':');
  if (parts.length > 3 || parts.some((part) => part.trim() === '')) return null;
  const numbers = parts.map(Number);
  if (numbers.some(Number.isNaN)) return null;
  if (parts.length === 1) return Math.round(numbers[0] * MS_PER_SECOND);
  // HA time-period strings are HH:MM or HH:MM:SS
  const [hours, minutes, seconds = 0] = numbers;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * MS_PER_SECOND);
}

/** Spells a millisecond count out compactly: `5 min`, `1 h 30 min`, `2 min 30 s`, `500 ms`. */
function humanizeMs(ms: number): string {
  if (ms <= 0) return '0 s';
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  const milliseconds = Math.round(ms % MS_PER_SECOND);
  const parts: string[] = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds) parts.push(`${seconds} s`);
  if (milliseconds) parts.push(`${milliseconds} ms`);
  return parts.join(' ');
}

const OBJECT_UNITS = [
  ['hours', 'h'],
  ['minutes', 'min'],
  ['seconds', 's'],
  ['milliseconds', 'ms'],
] as const;

/**
 * Formats a delay/timeout/`for` value for people: `5 min`, `1 h 30 min`, `45 s`. A templated
 * value is shown as written (its real value only exists at run time). Returns '' when unset.
 */
export function formatDuration(val: DurationValue | undefined | null): string {
  if (val == null || val === '') return '';
  if (typeof val === 'string' && isTemplateString(val)) return val.trim();
  const ms = durationToMs(val);
  if (ms !== null) return humanizeMs(ms);
  if (typeof val === 'object') {
    // Some field is a template: keep each unit exactly as written.
    return OBJECT_UNITS.flatMap(([key, unit]) => {
      const field = val[key];
      return field == null || field === '' ? [] : [`${String(field).trim()} ${unit}`];
    }).join(' ');
  }
  return String(val);
}

/**
 * Formats a trace step's elapsed wall-clock time for the "ok" status badge
 * (design doc §7: "ok (green check + ms duration)"). Sub-second durations
 * read as whole milliseconds; longer ones as seconds (one decimal under 10s).
 */
export function formatElapsedMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}
