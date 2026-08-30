import { z } from 'zod';

/**
 * List of valid Home Assistant weekday strings.
 * Used for time-based conditions and triggers.
 */
export const VALID_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof VALID_WEEKDAYS)[number];

/**
 * Zod schema for Home Assistant condition objects.
 * Supports recursive conditions for and/or/not groups.
 */
export const HAConditionSchema: z.ZodType<
  {
    [x: string]: unknown;
    condition?: string;
    alias?: string;
    /**
     * The condition's OWN alias from source YAML, distinct from `alias`
     * (the display alias, which may instead be an enclosing step's alias
     * copied down for canvas display). Set only when the source condition
     * itself carried an `alias:` key. The generator emits a condition's
     * `alias:` from this field exclusively, never from `alias`, so an
     * enclosing step's alias is never fabricated as the condition's own.
     */
    conditionAlias?: string;
    /**
     * The enclosing step/branch alias (an `if:`/`choose[].alias` wraps a
     * condition list with no dedicated canvas node of its own, so its alias
     * rides along on the first condition node). Kept separate from
     * `conditionAlias` so the two are never confused when emitting YAML.
     */
    stepAlias?: string;
    /** The enclosing step/branch's own `note:`, carried the same way as `stepAlias`. */
    stepNote?: string;
    /**
     * A `repeat.until`/`repeat.while` block's own alias. The `repeat:` step
     * has no dedicated canvas node either, so its alias is carried on the
     * loop's first condition node.
     */
    blockAlias?: string;
    /** A `repeat.until`/`repeat.while` block's own `note:`, carried the same way as `blockAlias`. */
    blockNote?: string;
    enabled?: boolean;
    note?: string;
    entity_id?: string | string[];
    state?: string | string[];
    value_template?: string;
    after?: string;
    before?: string;
    weekday?: Weekday[];
    after_offset?: string;
    before_offset?: string;
    zone?: string;
    conditions?: z.infer<typeof HAConditionSchema>[];
    above?: string | number;
    below?: string | number;
    attribute?: string;
    id?: string | string[];
    // Purpose-specific ("integration") condition fields (A3, HA 2026.x — e.g.
    // `battery.is_level`, `climate.is_heating`, `motion.is_detected`). These
    // conditions use `target` + `options` instead of entity_id/above/below.
    // Loose passthrough already preserves anything else round-trip; these two
    // are named explicitly so the generic integration-condition editor and
    // TargetEditor get real types instead of `unknown`.
    target?: {
      entity_id?: string | string[];
      device_id?: string | string[];
      area_id?: string | string[];
      floor_id?: string | string[];
      label_id?: string | string[];
    };
    options?: Record<string, unknown>;
  },
  Record<string, unknown>
> = z.looseObject({
  alias: z.string().optional(),
  conditionAlias: z.string().optional(),
  stepAlias: z.string().optional(),
  stepNote: z.string().optional(),
  blockAlias: z.string().optional(),
  blockNote: z.string().optional(),
  condition: z.string().optional(),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
  entity_id: z.union([z.string(), z.array(z.string())]).optional(),
  state: z.union([z.string(), z.array(z.string())]).optional(),
  value_template: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  weekday: z.array(z.enum(VALID_WEEKDAYS)).optional(),
  after_offset: z.string().optional(),
  before_offset: z.string().optional(),
  zone: z.string().optional(),
  conditions: z.array(z.lazy(() => HAConditionSchema)).optional(),
  above: z.union([z.string(), z.number()]).optional(),
  below: z.union([z.string(), z.number()]).optional(),
  attribute: z.string().optional(),
  // Support both string and array for trigger conditions
  id: z.union([z.string(), z.array(z.string())]).optional(),
  // Purpose-specific ("integration") condition fields (A3) — see type above.
  target: z
    .looseObject({
      entity_id: z.union([z.string(), z.array(z.string())]).optional(),
      device_id: z.union([z.string(), z.array(z.string())]).optional(),
      area_id: z.union([z.string(), z.array(z.string())]).optional(),
      floor_id: z.union([z.string(), z.array(z.string())]).optional(),
      label_id: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export type HACondition = z.infer<typeof HAConditionSchema>;

/**
 * Enum of valid Home Assistant trigger platforms.
 */
export const HAPlatformEnum = z.enum([
  'event',
  'template',
  'zone',
  'state',
  'time',
  'time_pattern',
  'mqtt',
  'webhook',
  'sun',
  'numeric_state',
  'homeassistant',
  'device',
  'calendar',
  // Parity fix A1 (2026.x): geo_location, conversation (sentence triggers),
  // persistent_notification, tag.
  'geo_location',
  'conversation',
  'persistent_notification',
  'tag',
]);
export type HAPlatform = z.infer<typeof HAPlatformEnum>;

/**
 * Zod schema for Home Assistant trigger objects.
 * Normalizes both legacy 'platform' and modern 'trigger' fields to a single 'trigger' property.
 * Supports both legacy format (platform: state) and modern format (trigger: state).
 */
export const HATriggerSchema = z
  .looseObject({
    alias: z.string().optional(),
    platform: z.string().optional(),
    trigger: z.string().optional(),
    target: z.looseObject({ entity_id: z.union([z.string(), z.array(z.string())]) }).optional(),
    options: z.looseObject({}).optional(),
    entity_id: z.union([z.string(), z.array(z.string())]).optional(),
    // Home Assistant supports both string, array, and null for from/to fields
    from: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
    to: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
    for: z
      .union([
        z.string(),
        z.number(),
        z.object({
          hours: z.union([z.number(), z.string()]).optional(),
          minutes: z.union([z.number(), z.string()]).optional(),
          seconds: z.union([z.number(), z.string()]).optional(),
          milliseconds: z.union([z.number(), z.string()]).optional(),
        }),
      ])
      .optional(),
    at: z.unknown().optional(),
    offset: z.string().optional(),
    event: z.string().optional(),
    event_type: z.union([z.string(), z.array(z.string())]).optional(),
    event_data: z.record(z.string(), z.unknown()).optional(),
    above: z.union([z.string(), z.number()]).optional(),
    below: z.union([z.string(), z.number()]).optional(),
    value_template: z.string().optional(),
    template: z.string().optional(),
    webhook_id: z.string().optional(),
    zone: z.string().optional(),
    topic: z.string().optional(),
    payload: z.string().optional(),
    // Conversation trigger fields
    command: z.union([z.string(), z.array(z.string())]).optional(),
    enabled: z.boolean().optional(),
    note: z.string().optional(),
    // geo_location trigger fields (A1)
    source: z.string().optional(),
    // persistent_notification trigger fields (A1)
    update_type: z.array(z.enum(['added', 'removed', 'updated', 'current'])).optional(),
    notification_id: z.string().optional(),
    // tag trigger fields (A1). device_id is intentionally NOT declared here
    // (unlike tag_id) — the 'device' trigger platform already relies on
    // device_id flowing through as a loose-object passthrough key (it always
    // has, since this schema never declared it), and several existing
    // fixture snapshots pin its exact output position among OTHER
    // passthrough device-trigger keys (domain, type, ...). Declaring it here
    // would promote it into the schema's declared-key group, which zod
    // emits before passthrough extras — reordering it ahead of `domain`/
    // `type` and breaking those snapshots. Passthrough already handles
    // string-or-array (tag's shape) exactly the same as a plain string
    // (device's shape) with zero validation, so nothing is lost.
    tag_id: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((input) => {
    // Normalize to modern 'trigger' property (HA 2024.1+)
    const trigger = input.trigger ?? input.platform ?? 'state';
    // Remove the legacy 'platform' key
    const { platform: _platform, ...rest } = input;
    return {
      ...rest,
      trigger,
    };
  });

export type HATrigger = z.infer<typeof HATriggerSchema>;

/**
 * Home Assistant Trigger interface (for type annotations without schema parsing)
 */
export interface HATriggerInput {
  alias?: string;
  platform?: string;
  trigger?: string;
  target?: { entity_id?: string | string[] };
  options?: Record<string, unknown>;
  entity_id?: string | string[];
  from?: string | string[] | null;
  to?: string | string[] | null;
  for?: string | { hours?: number; minutes?: number; seconds?: number };
  at?: string | string[] | { entity_id: string; offset?: string };
  offset?: string;
  event?: string;
  event_type?: string;
  event_data?: Record<string, unknown>;
  above?: string | number;
  below?: string | number;
  value_template?: string;
  template?: string;
  webhook_id?: string;
  zone?: string;
  topic?: string;
  payload?: string;
  command?: string | string[];
  enabled?: boolean;
  note?: string;
  // geo_location (A1)
  source?: string;
  // persistent_notification (A1)
  update_type?: Array<'added' | 'removed' | 'updated' | 'current'>;
  notification_id?: string;
  // tag (A1)
  tag_id?: string | string[];
  device_id?: string | string[];
}

/**
 * Home Assistant Action interface (for type annotations)
 */
export interface HAAction {
  service?: string;
  action?: string;
  event?: string;
  event_data?: Record<string, unknown>;
  id?: string;
  alias?: string;
  target?: Record<string, unknown>;
  data?: Record<string, unknown>;
  data_template?: Record<string, unknown>;
  response_variable?: string;
  continue_on_error?: boolean;
  enabled?: boolean;
  /**
   * Per-step note (HA 2026.x `note:` key, `CONF_NOTE` in HA core's
   * config_validation.py). Officially declared on every trigger/condition/
   * action base schema — HA's own trigger/condition/action validators accept
   * it (via `vol.Remove(CONF_NOTE)`, so it never fails "extra keys not
   * allowed") though it's stripped from the *validated* in-memory object
   * since it's frontend-only metadata; the config-save HTTP endpoint writes
   * back the original posted dict (not the validator's stripped output), so
   * it round-trips through real HA storage untouched. Used for A2 step notes
   * instead of a custom key — see packages/transpiler round-trip test.
   */
  note?: string;
  delay?: string | number | { hours?: number; minutes?: number; seconds?: number };
  wait_template?: string | Record<string, unknown>;
  timeout?: string | number | Record<string, number>;
  continue_on_timeout?: boolean;
  wait_for_trigger?: HATrigger | HATrigger[];
  choose?: HAChooseOption | HAChooseOption[];
  default?: HAAction[];
  if?: HACondition[];
  then?: HAAction[];
  else?: HAAction[];
  variables?: Record<string, unknown>;
  repeat?: {
    count?: string | number;
    while?: HACondition[];
    until?: string | string[] | HACondition[];
    /** repeat.for_each (additive parity fix) — items may be scalars or objects. */
    for_each?: unknown[];
    sequence: HAAction[];
  };
  [key: string]: unknown;
}

// Forward declaration for HAChooseOption (defined below)
export interface HAChooseOption {
  conditions: HACondition | HACondition[];
  sequence: HAAction | HAAction[];
  alias?: string;
}

/**
 * Zod schema for FlowGraph metadata block (automation-level settings)
 */
export const FlowGraphMetadataSchema = z.object({
  mode: z.enum(['single', 'restart', 'queued', 'parallel']).default('single'),
  max: z.number().optional(),
  max_exceeded: z.enum(['silent', 'warning', 'critical']).optional(),
  initial_state: z.boolean().optional(),
  hide_entity: z.boolean().optional(),
  trace: z.object({ stored_traces: z.number().optional() }).optional(),
});

export type FlowGraphMetadata = z.infer<typeof FlowGraphMetadataSchema>;

/**
 * Type guard for Home Assistant trigger objects.
 * Returns true if the object matches the HATrigger shape.
 */
export function isHATrigger(obj: unknown): obj is HATriggerInput {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ('platform' in obj || 'trigger' in obj || 'entity_id' in obj)
  );
}

/**
 * Type guard for Home Assistant condition objects.
 * Returns true if the object matches the HACondition shape.
 */
export function isHACondition(obj: unknown): obj is HACondition {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ('condition' in obj || 'entity_id' in obj || 'state' in obj)
  );
}

/**
 * Type guard for Home Assistant device actions.
 * Returns true if the object has type, device_id, and domain fields.
 */
export function isDeviceAction(obj: unknown): obj is Record<string, unknown> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    'device_id' in obj &&
    'domain' in obj
  );
}

/**
 * C.A.F.E. metadata stored in automation YAML to preserve flow layout.
 */
export const CafeMetadataSchema = z.object({
  version: z.number(),
  nodes: z.record(
    z.string(),
    z.object({
      x: z.number(),
      y: z.number(),
    })
  ),
  graph_id: z.string(),
  graph_version: z.number(),
  strategy: z.enum(['native', 'state-machine']),
});
export type CafeMetadata = z.infer<typeof CafeMetadataSchema>;

/**
 * Type guard for C.A.F.E. metadata.
 */
export function isCafeMetadata(obj: unknown): obj is CafeMetadata {
  return CafeMetadataSchema.safeParse(obj).success;
}

/**
 * Zod schema for choose option in HA actions.
 */
export const HAChooseOptionSchema: z.ZodType<HAChooseOption> = z.lazy(() =>
  z.object({
    conditions: z.union([HAConditionSchema, z.array(HAConditionSchema)]),
    sequence: z.union([HAActionSchema, z.array(HAActionSchema)]),
    alias: z.string().optional(),
  })
);

/**
 * Zod schema for Home Assistant action objects.
 */
export const HAActionSchema: z.ZodType<HAAction> = z.lazy(() =>
  z.looseObject({
    service: z.string().optional(),
    action: z.string().optional(),
    event: z.string().optional(),
    event_data: z.record(z.string(), z.unknown()).optional(),
    id: z.string().optional(),
    alias: z.string().optional(),
    target: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    data_template: z.record(z.string(), z.unknown()).optional(),
    response_variable: z.string().optional(),
    continue_on_error: z.boolean().optional(),
    enabled: z.boolean().optional(),
    note: z.string().optional(),
    delay: z.union([z.string(), z.number(), z.record(z.string(), z.number())]).optional(),
    wait_template: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    timeout: z.union([z.string(), z.number(), z.record(z.string(), z.number())]).optional(),
    continue_on_timeout: z.boolean().optional(),
    wait_for_trigger: z.union([HATriggerSchema, z.array(HATriggerSchema)]).optional(),
    choose: z.union([HAChooseOptionSchema, z.array(HAChooseOptionSchema)]).optional(),
    default: z.array(HAActionSchema).optional(),
    if: z.array(HAConditionSchema).optional(),
    then: z.array(HAActionSchema).optional(),
    else: z.array(HAActionSchema).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    repeat: z
      .object({
        count: z.union([z.string(), z.number()]).optional(),
        while: z.array(HAConditionSchema).optional(),
        until: z.union([z.string(), z.array(z.string()), z.array(HAConditionSchema)]).optional(),
        for_each: z.array(z.unknown()).optional(),
        sequence: z.array(HAActionSchema),
      })
      .optional(),
  })
);

/**
 * Zod schema for a full Home Assistant automation.
 */
export const HAAutomationSchema = z.object({
  id: z.string().optional(),
  alias: z.string().optional(),
  description: z.string().optional(),
  trigger_variables: z.record(z.string(), z.unknown()).optional(),
  trigger: z.union([HATriggerSchema, z.array(HATriggerSchema)]).optional(),
  condition: z.union([HAConditionSchema, z.array(HAConditionSchema)]).optional(),
  action: z.union([HAActionSchema, z.array(HAActionSchema)]),
  mode: z.enum(['single', 'restart', 'queued', 'parallel']).optional().default('single'),
  max: z.number().optional(),
  max_exceeded: z.enum(['silent', 'warning']).optional(),
  initial_state: z.boolean().optional(),
  hide_entity: z.boolean().optional(),
  trace: z.record(z.string(), z.unknown()).optional(),
  variables: z
    .object({
      _cafe_metadata: CafeMetadataSchema.optional(),
    })
    .catchall(z.unknown())
    .optional(),
});
export type HAAutomation = z.infer<typeof HAAutomationSchema>;

/**
 * Zod schema for a Home Assistant script.
 */
export const HAScriptSchema = HAAutomationSchema.omit({ action: true }).extend({
  action: z.union([HAActionSchema, z.array(HAActionSchema)]).optional(),
  sequence: z.union([HAActionSchema, z.array(HAActionSchema)]),
});
export type HAScript = z.infer<typeof HAScriptSchema>;

/**
 * Zod schema for Home Assistant delay action.
 */
export const HADelaySchema = z.looseObject({
  id: z.string().optional(),
  alias: z.string().optional(),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
  delay: z.union([
    z.string(),
    z.looseObject({
      hours: z.union([z.number(), z.string()]).optional(),
      minutes: z.union([z.number(), z.string()]).optional(),
      seconds: z.union([z.number(), z.string()]).optional(),
      milliseconds: z.union([z.number(), z.string()]).optional(),
    }),
  ]),
});
export type HADelay = z.infer<typeof HADelaySchema>;

/**
 * Zod schema for Home Assistant wait action (wait_template or wait_for_trigger).
 */
export const HAWaitSchema = z
  .looseObject({
    id: z.string().optional(),
    alias: z.string().optional(),
    enabled: z.boolean().optional(),
    note: z.string().optional(),
    wait_template: z.string().optional(),
    wait_for_trigger: z.array(HATriggerSchema).optional(),
    timeout: z
      .union([
        z.string(),
        z.looseObject({
          hours: z.union([z.number(), z.string()]).optional(),
          minutes: z.union([z.number(), z.string()]).optional(),
          seconds: z.union([z.number(), z.string()]).optional(),
          milliseconds: z.union([z.number(), z.string()]).optional(),
        }),
      ])
      .optional(),
    continue_on_timeout: z.boolean().optional(),
  })
  .refine(
    (data) => {
      return data.wait_template === undefined || data.wait_for_trigger === undefined;
    },
    {
      message: 'Provide either `wait_template` or `wait_for_trigger`, but not both.',
      path: ['wait_template'],
    }
  );
export type HAWait = z.infer<typeof HAWaitSchema>;

/**
 * Zod schema for Home Assistant variables action.
 */
export const HAVariablesSchema = z.looseObject({
  id: z.string().optional(),
  alias: z.string().optional(),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
  variables: z.record(z.string(), z.unknown()),
});
export type HAVariables = z.infer<typeof HAVariablesSchema>;
