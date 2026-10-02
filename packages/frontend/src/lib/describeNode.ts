import type { TFunction } from 'i18next';
import {
  type DurationValue,
  durationToMs,
  formatDuration,
  isTemplateString,
} from '@/components/nodes/formatDuration';

/**
 * Plain-English descriptions of canvas nodes.
 *
 * Every node card, the property-panel header and the debug list read from this one module, so a
 * step is always described the same way: what it does, in words, including the details that
 * change the meaning (timeouts, loops, stops, variables). All wording lives in the `nodes`
 * i18n namespace under `describe.*`; this file only decides WHICH sentence applies.
 */

/** The translator these functions need — the `nodes` namespace of react-i18next / i18next. */
export type DescribeT = TFunction<'nodes'>;

export type NodeTone = 'normal' | 'danger';

export interface NodeDescription {
  /** What the step does — or the user's own alias, which always wins. */
  title: string;
  /** Only set when an alias took the title: the machine summary, so the alias never hides it. */
  subtitle?: string;
  /** Extra lines that change the meaning of the step (timeouts, steps inside, options...). */
  detail?: string[];
  tone?: NodeTone;
}

/** A described step before the alias decides where the text goes. */
interface Summary {
  text: string;
  details?: string[];
  tone?: NodeTone;
}

type Data = Record<string, unknown>;

/** Longest raw template / message shown inline before it is cut with an ellipsis. */
const MAX_INLINE_CHARS = 60;
/** Sub-conditions / variable names / keys listed on a card before "+N more". */
const MAX_LISTED_ITEMS = 3;

// ── small value helpers ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trimmed, non-empty string — or null. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A scalar or a list of scalars as a clean list of strings (empty entries dropped). */
function strings(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    if (typeof item === 'string') return item.trim() ? [item.trim()] : [];
    if (typeof item === 'number' || typeof item === 'boolean') return [String(item)];
    return [];
  });
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `turn_on` → `turn on`. */
function humanize(identifier: string): string {
  return identifier.replace(/_/g, ' ').trim();
}

function clip(text: string, max = MAX_INLINE_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function joinOr(values: string[], t: DescribeT): string {
  return values.join(` ${t('describe.or')} `);
}

/** Splits `light.turn_on` at the first dot; a bare name has no domain. */
function splitService(service: string): { domain: string | null; name: string } {
  const dot = service.indexOf('.');
  if (dot < 0) return { domain: null, name: service };
  return { domain: service.slice(0, dot), name: service.slice(dot + 1) };
}

// ── entities, targets, templates ────────────────────────────────────────────

/** `light.a`, `light.a, light.b`, or `3 entities`; null when nothing is chosen. */
function describeEntities(value: unknown, t: DescribeT): string | null {
  const ids = strings(value);
  if (ids.length === 0) return null;
  if (ids.length <= 2) return ids.join(', ');
  return t('describe.entityCount', { count: ids.length });
}

/** The thing a step acts on: entities first, then areas, floors, labels and devices. */
function describeTarget(target: unknown, fallbackEntities: unknown, t: DescribeT): string | null {
  const source = isRecord(target) ? target : {};
  const parts: string[] = [];
  const entities = describeEntities(source.entity_id ?? fallbackEntities, t);
  if (entities) parts.push(entities);
  const areas = strings(source.area_id);
  if (areas.length > 0) parts.push(t('describe.area', { count: areas.length, name: areas[0] }));
  const floors = strings(source.floor_id);
  if (floors.length > 0) {
    parts.push(t('describe.floor', { count: floors.length, name: floors[0] }));
  }
  const labels = strings(source.label_id);
  if (labels.length > 0) {
    parts.push(t('describe.label', { count: labels.length, name: labels[0] }));
  }
  const devices = strings(source.device_id);
  if (devices.length > 0) parts.push(t('describe.device', { count: devices.length }));
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The entity (or "attribute of entity") a trigger/condition looks at. */
function describeSubject(entities: unknown, attribute: unknown, t: DescribeT): string {
  const subject = describeEntities(entities, t) ?? t('describe.noEntity');
  const name = str(attribute);
  return name ? t('describe.attributeOf', { attribute: name, subject }) : subject;
}

/** An `above:` / `below:` limit: a number, a numeric string or an entity id. */
function limitText(value: unknown): string | null {
  return typeof value === 'number' ? String(value) : str(value);
}

/** Entities a trigger watches: `entity_id`, or the purpose-specific `target.entity_id`. */
function triggerEntities(data: Data): unknown {
  return data.entity_id ?? (isRecord(data.target) ? data.target.entity_id : undefined);
}

/** The expression inside `{{ ... }}`, on one line and shortened. */
function templateText(template: string): string {
  const trimmed = template.trim();
  const wrapped = /^\{\{-?([\s\S]*?)-?\}\}$/.exec(trimmed);
  const inner = wrapped && !wrapped[1].includes('}}') ? wrapped[1] : trimmed;
  return clip(inner.replace(/\s+/g, ' ').trim());
}

const QUOTED = `['"]`;
const ENTITY_ARG = `${QUOTED}([^'"]+)${QUOTED}`;
const IS_STATE = new RegExp(`^is_state\\(\\s*${ENTITY_ARG}\\s*,\\s*${ENTITY_ARG}\\s*\\)$`);
const IS_STATE_ATTR = new RegExp(
  `^is_state_attr\\(\\s*${ENTITY_ARG}\\s*,\\s*${ENTITY_ARG}\\s*,\\s*${ENTITY_ARG}\\s*\\)$`
);
const STATES_EQUALS = new RegExp(`^states\\(\\s*${ENTITY_ARG}\\s*\\)\\s*(==|!=)\\s*${ENTITY_ARG}$`);
const STATES_NUMBER = new RegExp(
  `^states\\(\\s*${ENTITY_ARG}\\s*\\)\\s*\\|\\s*(?:float|int)(?:\\([^)]*\\))?\\s*(>=|<=|>|<|==|!=)\\s*(-?\\d+(?:\\.\\d+)?)$`
);

/**
 * Turns the common template idioms into a sentence (`is_state('light.x','on')` → "light.x is
 * on"); anything else is shown as the cleaned-up expression. `recognized` tells the caller
 * whether the text is already a full sentence.
 */
function summarizeTemplate(template: string, t: DescribeT): { text: string; recognized: boolean } {
  const expression = templateText(template);
  const negated = /^not\s+/.test(expression);
  const positive = negated ? expression.replace(/^not\s+/, '') : expression;

  const isState = IS_STATE.exec(positive);
  if (isState) {
    return {
      text: t(negated ? 'describe.template.isNotState' : 'describe.template.isState', {
        entity: isState[1],
        state: isState[2],
      }),
      recognized: true,
    };
  }
  const isStateAttr = IS_STATE_ATTR.exec(positive);
  if (isStateAttr) {
    return {
      text: t(negated ? 'describe.template.isNotAttr' : 'describe.template.isAttr', {
        entity: isStateAttr[1],
        attribute: isStateAttr[2],
        value: isStateAttr[3],
      }),
      recognized: true,
    };
  }
  const equals = STATES_EQUALS.exec(expression);
  if (equals) {
    const isNot = (equals[2] === '!=') !== negated;
    return {
      text: t(isNot ? 'describe.template.isNotState' : 'describe.template.isState', {
        entity: equals[1],
        state: equals[3],
      }),
      recognized: true,
    };
  }
  const numeric = STATES_NUMBER.exec(expression);
  if (numeric) {
    return {
      text: t('describe.template.numberCompare', {
        entity: numeric[1],
        operator: numeric[2],
        value: numeric[3],
      }),
      recognized: true,
    };
  }
  return { text: expression, recognized: false };
}

/** `-00:30:00` + "sunset" → "30 min before sunset"; no/zero/templated offset → just "sunset". */
function describeOffset(offset: unknown, what: string, t: DescribeT): string {
  const raw = str(offset);
  if (!raw || isTemplateString(raw)) return what;
  const magnitude = raw.replace(/^[+-]/, '');
  if (!durationToMs(magnitude)) return what;
  return t(raw.startsWith('-') ? 'describe.offsetBefore' : 'describe.offsetAfter', {
    duration: formatDuration(magnitude),
    what,
  });
}

/** Strips `:00` seconds from a clock time: `07:00:00` → `07:00`. */
function shortTime(time: string): string {
  return /^\d{1,2}:\d{2}:00$/.test(time) ? time.slice(0, -3) : time;
}

function weekdayLabel(day: string, t: DescribeT): string {
  switch (day) {
    case 'mon':
      return t('describe.weekdays.mon');
    case 'tue':
      return t('describe.weekdays.tue');
    case 'wed':
      return t('describe.weekdays.wed');
    case 'thu':
      return t('describe.weekdays.thu');
    case 'fri':
      return t('describe.weekdays.fri');
    case 'sat':
      return t('describe.weekdays.sat');
    case 'sun':
      return t('describe.weekdays.sun');
    default:
      return day;
  }
}

/** "domain type subtype" of a device trigger/condition/action, e.g. `light turned on`. */
function describeDeviceLabel(data: Data): string {
  return [str(data.domain), str(data.type), str(data.subtype)]
    .filter((part): part is string => part !== null)
    .map(humanize)
    .join(' ');
}

/** `key value` pairs of a purpose-specific block's `options`, for one detail line. */
function describeOptions(options: unknown, t: DescribeT): string | null {
  if (!isRecord(options)) return null;
  const pairs = Object.entries(options).flatMap(([key, value]) => {
    if (key === 'for') return [];
    const scalars = strings(value);
    if (scalars.length > 0) return [`${humanize(key)} ${scalars.join(', ')}`];
    if (isRecord(value)) return [`${humanize(key)} ${formatDuration(value)}`];
    return [];
  });
  return pairs.length > 0 ? t('describe.options', { options: pairs.join(', ') }) : null;
}

/** Appends `from X`, `to Y` and `for 2 min` to a state-like description. */
function addStateFragments(base: string, data: Data, t: DescribeT): string {
  const parts = [base];
  const from = strings(data.from);
  if (from.length > 0) parts.push(t('describe.fragment.from', { value: joinOr(from, t) }));
  const to = strings(data.to);
  if (to.length > 0) parts.push(t('describe.fragment.to', { value: joinOr(to, t) }));
  const duration = formatDuration(durationFrom(data.for));
  if (duration) parts.push(t('describe.fragment.for', { duration }));
  return parts.join(' ');
}

/** `for:` accepts a string, a number of seconds or a duration object — nothing else counts. */
function durationFrom(value: unknown): DurationValue | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return isRecord(value) ? value : undefined;
}

// ── purpose-specific (`motion.detected`, `battery.is_level`, ...) ───────────

function isPurposeSpecific(type: string): boolean {
  return type.includes('.');
}

/** `motion.detected` → "motion detected in <target>"; options become a detail line. */
function describePurposeSpecific(type: string, data: Data, t: DescribeT) {
  const label = humanize(type.replace('.', ' '));
  const target = describeTarget(data.target, data.entity_id, t);
  const options = isRecord(data.options) ? data.options : {};
  const base = target
    ? t('describe.purposeSpecific', { label, target })
    : t('describe.purposeSpecificNoTarget', { label });
  const duration = formatDuration(durationFrom(data.for ?? options.for));
  const text = duration ? `${base} ${t('describe.fragment.for', { duration })}` : base;
  const optionsLine = describeOptions(data.options, t);
  return { text, details: optionsLine ? [optionsLine] : [] };
}

// ── triggers ────────────────────────────────────────────────────────────────

function timeTriggerPhrase(data: Data, t: DescribeT): string {
  const entries = Array.isArray(data.at) ? data.at : data.at == null ? [] : [data.at];
  const phrases = entries.flatMap((entry) => {
    const value = isRecord(entry) ? str(entry.entity_id) : strings(entry)[0];
    if (!value) return [];
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) {
      return [t('describe.trigger.time', { time: shortTime(value) })];
    }
    const offset = isRecord(entry) ? entry.offset : data.offset;
    return [describeOffset(offset, t('describe.trigger.timeFromEntity', { entity: value }), t)];
  });
  return phrases.length > 0
    ? phrases.join(`, ${t('describe.or')} `)
    : t('describe.trigger.timeNone');
}

/** `/5` → 5 when it is a plain "every N" step, otherwise null. */
function patternStep(value: unknown): number | null {
  const match = /^\/(\d+)$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : null;
}

function timePatternPhrase(data: Data, t: DescribeT): string {
  const { hours, minutes, seconds } = data;
  const given = [hours, minutes, seconds].filter((value) => value != null && value !== '');
  if (given.length === 1) {
    const hoursStep = patternStep(hours);
    const minutesStep = patternStep(minutes);
    const secondsStep = patternStep(seconds);
    if (hoursStep !== null) return t('describe.trigger.timePatternHours', { count: hoursStep });
    if (minutesStep !== null) {
      return t('describe.trigger.timePatternMinutes', { count: minutesStep });
    }
    if (secondsStep !== null) {
      return t('describe.trigger.timePatternSeconds', { count: secondsStep });
    }
  }
  const pattern = [
    hours != null ? t('describe.trigger.patternHours', { value: String(hours) }) : null,
    minutes != null ? t('describe.trigger.patternMinutes', { value: String(minutes) }) : null,
    seconds != null ? t('describe.trigger.patternSeconds', { value: String(seconds) }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');
  return t('describe.trigger.timePattern', { pattern });
}

function sunTriggerPhrase(data: Data, t: DescribeT): string {
  const event = str(data.event) === 'sunrise' ? t('describe.sunrise') : t('describe.sunset');
  return describeOffset(data.offset, event, t);
}

function calendarTriggerPhrase(data: Data, t: DescribeT): string {
  const entity = describeEntities(triggerEntities(data), t) ?? t('describe.noEntity');
  const what = t(
    str(data.event) === 'end' ? 'describe.trigger.calendarEnd' : 'describe.trigger.calendarStart',
    { entity }
  );
  return describeOffset(data.offset, what, t);
}

/**
 * The lower-case noun phrase for what starts the automation ("state change of light.kitchen
 * from off to on"). Lower-case so it reads naturally after "Wait for ..." too.
 */
function triggerPhrase(data: Data, t: DescribeT): { phrase: string; details: string[] } {
  const platform = str(data.trigger) ?? str(data.platform) ?? 'state';
  const details: string[] = [];
  const noEntity = t('describe.noEntity');

  if (isPurposeSpecific(platform)) {
    const purpose = describePurposeSpecific(platform, data, t);
    details.push(...purpose.details);
    return { phrase: purpose.text, details };
  }

  switch (platform) {
    case 'state': {
      const attribute = str(data.attribute);
      const subject = describeEntities(triggerEntities(data), t) ?? noEntity;
      const base = attribute
        ? t('describe.trigger.stateAttribute', { attribute, subject })
        : t('describe.trigger.state', { subject });
      return { phrase: addStateFragments(base, data, t), details };
    }
    case 'numeric_state': {
      const subject = describeSubject(triggerEntities(data), data.attribute, t);
      const above = limitText(data.above);
      const below = limitText(data.below);
      let base: string;
      if (above !== null && below !== null) {
        base = t('describe.trigger.numericBetween', { subject, above, below });
      } else if (above !== null) {
        base = t('describe.trigger.numericAbove', { subject, value: above });
      } else if (below !== null) {
        base = t('describe.trigger.numericBelow', { subject, value: below });
      } else {
        base = t('describe.trigger.numericAny', { subject });
      }
      const duration = formatDuration(durationFrom(data.for));
      const phrase = duration ? `${base} ${t('describe.fragment.for', { duration })}` : base;
      return { phrase, details };
    }
    case 'time':
      return { phrase: timeTriggerPhrase(data, t), details };
    case 'time_pattern':
      return { phrase: timePatternPhrase(data, t), details };
    case 'sun':
      return { phrase: sunTriggerPhrase(data, t), details };
    case 'zone': {
      const subject = describeEntities(data.entity_id, t) ?? noEntity;
      const zone = str(data.zone) ?? t('describe.noZone');
      const key =
        str(data.event) === 'leave' ? 'describe.trigger.zoneLeave' : 'describe.trigger.zoneEnter';
      return { phrase: t(key, { subject, zone }), details };
    }
    case 'event': {
      const types = strings(data.event_type);
      const phrase =
        types.length > 0
          ? t('describe.trigger.event', { type: joinOr(types, t) })
          : t('describe.trigger.eventNone');
      return { phrase, details };
    }
    case 'mqtt': {
      const topic = str(data.topic) ?? t('describe.noTopic');
      const payload = str(data.payload);
      return {
        phrase: payload
          ? t('describe.trigger.mqttPayload', { topic, payload: clip(payload) })
          : t('describe.trigger.mqtt', { topic }),
        details,
      };
    }
    case 'webhook':
      return {
        phrase: t('describe.trigger.webhook', { id: str(data.webhook_id) ?? t('describe.noId') }),
        details,
      };
    case 'template': {
      const template = str(data.value_template) ?? str(data.template);
      const summary = template ? summarizeTemplate(template, t).text : t('describe.noTemplate');
      const base = t('describe.trigger.template', { summary });
      const duration = formatDuration(durationFrom(data.for));
      return {
        phrase: duration ? `${base} ${t('describe.fragment.for', { duration })}` : base,
        details,
      };
    }
    case 'homeassistant':
      return {
        phrase: t(
          str(data.event) === 'shutdown'
            ? 'describe.trigger.haShutdown'
            : 'describe.trigger.haStart'
        ),
        details,
      };
    case 'device': {
      const label = describeDeviceLabel(data);
      return {
        phrase: label ? t('describe.trigger.device', { label }) : t('describe.trigger.deviceNone'),
        details,
      };
    }
    case 'calendar':
      return { phrase: calendarTriggerPhrase(data, t), details };
    case 'conversation': {
      const commands = strings(data.command);
      return {
        phrase:
          commands.length > 0
            ? t('describe.trigger.conversation', { command: clip(commands.join(' / ')) })
            : t('describe.trigger.conversationNone'),
        details,
      };
    }
    case 'geo_location': {
      const source = str(data.source) ?? t('describe.noSource');
      const zone = str(data.zone) ?? t('describe.noZone');
      const key =
        str(data.event) === 'leave' ? 'describe.trigger.geoLeave' : 'describe.trigger.geoEnter';
      return { phrase: t(key, { source, zone }), details };
    }
    case 'persistent_notification': {
      const updates = strings(data.update_type);
      const base =
        updates.length > 0
          ? t('describe.trigger.notificationUpdates', { updates: updates.join(', ') })
          : t('describe.trigger.notification');
      const id = str(data.notification_id);
      return { phrase: id ? `${base} ${t('describe.fragment.id', { id })}` : base, details };
    }
    case 'tag': {
      const ids = strings(data.tag_id);
      return {
        phrase:
          ids.length > 0
            ? t('describe.trigger.tagId', { id: ids.join(', ') })
            : t('describe.trigger.tag'),
        details,
      };
    }
    default:
      return { phrase: t('describe.trigger.unknown', { platform }), details };
  }
}

function summarizeTrigger(data: Data, t: DescribeT): Summary {
  const { phrase, details } = triggerPhrase(data, t);
  const id = str(data.id);
  return {
    text: upperFirst(phrase),
    details: id ? [...details, t('describe.trigger.id', { id })] : details,
  };
}

// ── conditions ──────────────────────────────────────────────────────────────

function summarizeStateCondition(data: Data, t: DescribeT): string {
  const subject = describeSubject(data.entity_id, data.attribute, t);
  const states = strings(data.state);
  if (states.length === 0) return t('describe.condition.stateAny', { subject });
  const value = joinOr(states, t);
  const duration = formatDuration(durationFrom(data.for));
  return duration
    ? t('describe.condition.stateFor', { subject, value, duration })
    : t('describe.condition.state', { subject, value });
}

function summarizeNumericCondition(data: Data, t: DescribeT): string {
  const subject = describeSubject(data.entity_id, data.attribute, t);
  const above = limitText(data.above);
  const below = limitText(data.below);
  if (above !== null && below !== null) {
    return t('describe.condition.numericBetween', { subject, above, below });
  }
  if (above !== null) return t('describe.condition.numericAbove', { subject, value: above });
  if (below !== null) return t('describe.condition.numericBelow', { subject, value: below });
  return t('describe.condition.numericNone', { subject });
}

function summarizeTimeCondition(data: Data, t: DescribeT): string {
  const after = str(data.after);
  const before = str(data.before);
  const days = strings(data.weekday)
    .map((day) => weekdayLabel(day, t))
    .join(', ');
  let base: string | null = null;
  if (after && before) {
    base = t('describe.condition.timeBetween', {
      after: shortTime(after),
      before: shortTime(before),
    });
  } else if (after) {
    base = t('describe.condition.timeAfter', { after: shortTime(after) });
  } else if (before) {
    base = t('describe.condition.timeBefore', { before: shortTime(before) });
  }
  if (base === null) {
    return days ? t('describe.condition.timeDays', { days }) : t('describe.condition.timeNone');
  }
  return days ? t('describe.condition.timeOnDays', { what: base, days }) : base;
}

function summarizeSunCondition(data: Data, t: DescribeT): string {
  const bound = (event: unknown, offset: unknown): string | null => {
    const name = str(event);
    if (!name) return null;
    const label = name === 'sunrise' ? t('describe.sunrise') : t('describe.sunset');
    return describeOffset(offset, label, t);
  };
  const after = bound(data.after, data.after_offset);
  const before = bound(data.before, data.before_offset);
  if (after && before) return t('describe.condition.sunBetween', { after, before });
  if (after) return t('describe.condition.sunAfter', { after });
  if (before) return t('describe.condition.sunBefore', { before });
  return t('describe.condition.sunNone');
}

function summarizeConditionGroup(type: 'and' | 'or' | 'not', data: Data, t: DescribeT): Summary {
  const children = Array.isArray(data.conditions) ? data.conditions : [];
  const count = children.length;
  const listed = children
    .slice(0, MAX_LISTED_ITEMS)
    .map((child) => describeConditionData(child, t).text);
  const hidden = count - listed.length;
  return {
    text:
      type === 'and'
        ? t('describe.condition.and', { count })
        : type === 'or'
          ? t('describe.condition.or', { count })
          : t('describe.condition.not', { count }),
    details: hidden > 0 ? [...listed, t('describe.more', { count: hidden })] : listed,
  };
}

/** One condition (an object, or a bare template string shorthand) as a sentence. */
function describeConditionData(raw: unknown, t: DescribeT): Summary {
  if (typeof raw === 'string') return summarizeConditionTemplate(raw, t);
  if (!isRecord(raw)) return { text: t('describe.condition.unknown', { type: '?' }) };
  const declared = str(raw.condition);
  // Shorthand template condition: the template itself sits where the type would be.
  if (declared && isTemplateString(declared)) return summarizeConditionTemplate(declared, t);
  const type = declared ?? (raw.value_template || raw.template ? 'template' : 'state');

  if (isPurposeSpecific(type)) {
    const purpose = describePurposeSpecific(type, raw, t);
    return { text: upperFirst(purpose.text), details: purpose.details };
  }

  switch (type) {
    case 'state':
      return { text: summarizeStateCondition(raw, t) };
    case 'numeric_state':
      return { text: summarizeNumericCondition(raw, t) };
    case 'template':
      return summarizeConditionTemplate(str(raw.value_template) ?? str(raw.template), t);
    case 'time':
      return { text: summarizeTimeCondition(raw, t) };
    case 'sun':
      return { text: summarizeSunCondition(raw, t) };
    case 'zone': {
      const subject = describeEntities(raw.entity_id, t) ?? t('describe.noEntity');
      return {
        text: t('describe.condition.zone', {
          subject,
          zone: str(raw.zone) ?? t('describe.noZone'),
        }),
      };
    }
    case 'trigger': {
      const ids = strings(raw.id);
      return {
        text:
          ids.length > 0
            ? t('describe.condition.trigger', { ids: joinOr(ids, t) })
            : t('describe.condition.triggerNone'),
      };
    }
    case 'and':
    case 'or':
    case 'not':
      return summarizeConditionGroup(type, raw, t);
    case 'device': {
      const label = describeDeviceLabel(raw);
      return {
        text: label
          ? t('describe.condition.device', { label })
          : t('describe.condition.deviceNone'),
      };
    }
    default:
      return { text: t('describe.condition.unknown', { type }) };
  }
}

function summarizeConditionTemplate(template: string | null, t: DescribeT): Summary {
  if (!template) return { text: t('describe.condition.templateNone') };
  const summary = summarizeTemplate(template, t);
  return {
    text: summary.recognized
      ? summary.text
      : t('describe.condition.template', { template: summary.text }),
  };
}

// ── actions ─────────────────────────────────────────────────────────────────

/** True for a step Flow cannot model: it is kept exactly as written and saved back unchanged. */
function isUnsupportedPlaceholder(data: Data): boolean {
  return data.verbatimStep !== undefined;
}

function summarizeStop(data: Data, t: DescribeT): Summary {
  const reason = str(data.stop);
  const isError = data.error === true;
  if (isError) {
    return {
      text: reason
        ? t('describe.action.stopError', { reason })
        : t('describe.action.stopErrorNoReason'),
      tone: 'danger',
    };
  }
  return {
    text: reason ? t('describe.action.stop', { reason }) : t('describe.action.stopNoReason'),
  };
}

function summarizeRepeat(repeat: Data, t: DescribeT): Summary {
  const sequence = Array.isArray(repeat.sequence) ? repeat.sequence : [];
  const details =
    sequence.length > 0 ? [t('describe.action.stepsInside', { count: sequence.length })] : [];
  if (Array.isArray(repeat.for_each)) {
    return {
      text: t('describe.action.repeatForEach', { count: repeat.for_each.length }),
      details,
    };
  }
  const forEach = str(repeat.for_each);
  if (forEach) {
    return {
      text: t('describe.action.repeatForEachTemplate', { template: templateText(forEach) }),
      details,
    };
  }
  if (repeat.count != null && repeat.count !== '') {
    const times =
      typeof repeat.count === 'string' ? templateText(repeat.count) : String(repeat.count);
    return { text: t('describe.action.repeatCount', { times }), details };
  }
  if (repeat.while !== undefined) return { text: t('describe.action.repeatWhile'), details };
  if (repeat.until !== undefined) return { text: t('describe.action.repeatUntil'), details };
  return { text: t('describe.action.repeatOther'), details };
}

function summarizeDeviceAction(source: Data, t: DescribeT): Summary {
  const label = describeDeviceLabel(source);
  const entity = describeEntities(source.entity_id, t);
  if (!label) return { text: t('describe.action.deviceNone') };
  return {
    text: entity
      ? t('describe.action.deviceEntity', { label, entity })
      : t('describe.action.device', { label }),
  };
}

function summarizeServiceCall(service: string, data: Data, t: DescribeT): Summary {
  const { domain, name } = splitService(service);
  const payload = isRecord(data.data) ? data.data : {};
  const target = describeTarget(data.target, data.entity_id ?? payload.entity_id, t);
  const details: string[] = [];
  const message = str(payload.message);
  if (message) details.push(t('describe.action.message', { message: clip(message) }));
  const responseVariable = str(data.response_variable);
  if (responseVariable) {
    details.push(t('describe.action.responseVariable', { name: responseVariable }));
  }
  if (data.continue_on_error === true) details.push(t('describe.action.continueOnError'));

  let text: string;
  if (target && name === 'turn_on') text = t('describe.action.turnOn', { target });
  else if (target && name === 'turn_off') text = t('describe.action.turnOff', { target });
  else if (target && name === 'toggle') text = t('describe.action.toggle', { target });
  else if (domain === 'notify') text = t('describe.action.notify', { name });
  else if (
    domain === 'script' &&
    !target &&
    !['turn_on', 'turn_off', 'toggle', 'reload'].includes(name)
  ) {
    text = t('describe.action.runScript', { name });
  } else if (target) {
    text = t('describe.action.serviceTarget', { verb: upperFirst(humanize(name)), target });
  } else {
    text = t('describe.action.serviceCall', { service });
  }
  return { text, details };
}

function summarizeUnsupported(data: Data, t: DescribeT): Summary {
  const original = isRecord(data.verbatimStep) ? data.verbatimStep : {};
  const keys = Object.keys(original).slice(0, MAX_LISTED_ITEMS);
  return {
    text: t('describe.action.unsupported'),
    details:
      keys.length > 0 ? [t('describe.action.unsupportedContains', { keys: keys.join(', ') })] : [],
  };
}

function summarizeAction(data: Data, t: DescribeT): Summary {
  if (isUnsupportedPlaceholder(data)) return summarizeUnsupported(data, t);
  if (typeof data.stop === 'string') return summarizeStop(data, t);
  if (isRecord(data.repeat)) return summarizeRepeat(data.repeat, t);
  if (Array.isArray(data.parallel)) {
    return { text: t('describe.action.parallel', { count: data.parallel.length }) };
  }
  if ('set_conversation_response' in data) {
    const response = str(data.set_conversation_response);
    return {
      text: response
        ? t('describe.action.conversationResponse', { response: clip(response) })
        : t('describe.action.conversationResponseNone'),
    };
  }

  const service = str(data.service) ?? str(data.action);
  if (!service && 'event' in data) {
    const event = str(data.event);
    return {
      text: event ? t('describe.action.event', { event }) : t('describe.action.eventNone'),
    };
  }
  const payload = isRecord(data.data) ? data.data : {};
  if (isRecord(data.data) && payload.device_id && payload.domain && payload.type) {
    return summarizeDeviceAction(payload, t);
  }
  if (data.device_id && data.domain && data.type) return summarizeDeviceAction(data, t);
  if (service) return summarizeServiceCall(service, data, t);

  const keys = Object.keys(data).filter(
    (key) => !['alias', 'enabled', 'note', 'id', 'continue_on_error'].includes(key)
  );
  return {
    text:
      keys.length > 0
        ? t('describe.action.generic', { key: humanize(keys[0]) })
        : t('describe.action.empty'),
  };
}

// ── delay / wait / variables ────────────────────────────────────────────────

function summarizeDelay(data: Data, t: DescribeT): Summary {
  const duration = formatDuration(durationFrom(data.delay));
  return {
    text: duration ? t('describe.delay', { duration }) : t('describe.delayNone'),
  };
}

function summarizeWait(data: Data, t: DescribeT): Summary {
  const timeout = formatDuration(durationFrom(data.timeout));
  const details = data.continue_on_timeout === false ? [t('describe.wait.stopsOnTimeout')] : [];

  const template = str(data.wait_template);
  if (template) {
    const summary = summarizeTemplate(template, t).text;
    return {
      text: timeout
        ? t('describe.wait.untilTimeout', { timeout, summary })
        : t('describe.wait.until', { summary }),
      details,
    };
  }

  const triggers = Array.isArray(data.wait_for_trigger)
    ? data.wait_for_trigger.filter(isRecord)
    : isRecord(data.wait_for_trigger)
      ? [data.wait_for_trigger]
      : [];
  if (triggers.length > 0) {
    const what =
      triggers.length === 1
        ? triggerPhrase(triggers[0], t).phrase
        : t('describe.wait.triggers', { count: triggers.length });
    return {
      text: timeout
        ? t('describe.wait.forTimeout', { timeout, what })
        : t('describe.wait.for', { what }),
      details,
    };
  }

  return {
    text: timeout ? t('describe.wait.timeoutOnly', { timeout }) : t('describe.wait.empty'),
    details,
  };
}

function summarizeSetVariables(data: Data, t: DescribeT): Summary {
  const names = isRecord(data.variables) ? Object.keys(data.variables) : [];
  if (names.length === 0) return { text: t('describe.variablesNone') };
  const listed = names.slice(0, MAX_LISTED_ITEMS).join(', ');
  const hidden = names.length - MAX_LISTED_ITEMS;
  return {
    text: t('describe.variables', {
      count: names.length,
      names: hidden > 0 ? `${listed} ${t('describe.more', { count: hidden })}` : listed,
    }),
  };
}

// ── public API ──────────────────────────────────────────────────────────────

function summarize(type: string | undefined, data: Data, t: DescribeT): Summary | null {
  switch (type) {
    case 'trigger':
      return summarizeTrigger(data, t);
    case 'condition':
      return describeConditionData(data, t);
    case 'action':
      return summarizeAction(data, t);
    case 'delay':
      return summarizeDelay(data, t);
    case 'wait':
      return summarizeWait(data, t);
    case 'set_variables':
      return summarizeSetVariables(data, t);
    default:
      return null;
  }
}

/**
 * Describes a node in plain English. A user-written `alias` always wins as the title; the
 * machine summary then moves to `subtitle` so the alias never hides what the step does.
 * Disabled nodes get a leading detail line saying the step is skipped.
 */
export function describeNode(
  type: string | undefined,
  data: Record<string, unknown>,
  t: DescribeT
): NodeDescription {
  const summary = summarize(type, data, t);
  const rawAlias = str(data.alias);
  const alias = rawAlias || null;

  const details = [
    ...(data.enabled === false ? [t('describe.disabled')] : []),
    ...(summary?.details ?? []),
  ];
  const description: NodeDescription = summary
    ? alias
      ? { title: alias, subtitle: summary.text }
      : { title: summary.text }
    : { title: alias ?? type ?? t('types.node') };
  if (details.length > 0) description.detail = details;
  if (summary?.tone === 'danger') description.tone = 'danger';
  return description;
}
