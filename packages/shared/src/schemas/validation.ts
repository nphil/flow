import { z } from 'zod';

/**
 * Validation schemas for node data.
 * These are used for real-time validation in the UI, separate from the
 * structural schemas used for parsing.
 */

/**
 * Wait node validation - requires either wait_template or wait_for_trigger.
 * A wait with only timeout is not valid - use a Delay node instead.
 */
export const WaitNodeValidationSchema = z
  .object({
    wait_template: z.string().optional(),
    wait_for_trigger: z.array(z.any()).optional(),
    timeout: z.union([z.string(), z.object({})]).optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      const hasTemplate = data.wait_template && data.wait_template.trim() !== '';
      const hasTrigger = data.wait_for_trigger && data.wait_for_trigger.length > 0;
      return hasTemplate || hasTrigger;
    },
    {
      message:
        'Wait node requires either a template condition or trigger. Use a Delay node for simple time-based pauses.',
      path: ['_root'],
    }
  );

/**
 * Action node validation - requires either:
 *   - service in domain.service format (service call action), or
 *   - event string (fire event action)
 */
export const ActionNodeValidationSchema = z
  .object({
    service: z.string().optional(),
    event: z.string().optional(),
    // Stop action ("halt automation") — `data.stop` is a string (possibly
    // empty) message, never undefined, once the node is a stop action.
    stop: z.string().optional(),
    // Opaque repeat block (count/while/until/for_each variants the parser
    // couldn't explode into a subgraph, or the additive for_each node —
    // see YamlParser.ts isRepeatAction / native.ts+state-machine.ts
    // buildActionCall's "opaque repeat block" branch).
    repeat: z.object({}).passthrough().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const hasEvent = typeof data.event === 'string' && data.event.trim() !== '';
    const hasService = typeof data.service === 'string' && data.service.trim() !== '';
    // Stop actions store their message in `stop` (possibly '') instead of
    // `service`/`event`; repeat.for_each (and any other opaque repeat block)
    // stores its config in `repeat` instead. Neither is a service/event call,
    // so without this check every stop or repeat.for_each action would show a
    // permanent false "service or event required" error and block saving.
    const hasStop = data.stop !== undefined;
    const hasRepeat = data.repeat !== undefined;

    if (!hasEvent && !hasService && !hasStop && !hasRepeat) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Either a service (e.g. light.turn_on) or an event name is required',
        path: ['service'],
      });
      return;
    }

    if (hasService && !data.service!.includes('.')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Service must be in domain.service format (e.g., light.turn_on)',
        path: ['service'],
      });
    }
  });

/**
 * Helper to check if an entity_id value is non-empty.
 * Handles both string and array formats.
 */
function hasEntityId(entityId: unknown): boolean {
  if (Array.isArray(entityId)) return entityId.length > 0;
  if (typeof entityId === 'string') return entityId.trim() !== '';
  return false;
}

/**
 * Helper to check if a trigger ID value is valid (non-empty).
 * Handles both string and array formats, ensuring no empty strings.
 */
function hasValidTriggerId(id: unknown): boolean {
  if (Array.isArray(id)) {
    return id.length > 0 && id.every((item) => typeof item === 'string' && item.trim() !== '');
  }
  if (typeof id === 'string') return id.trim() !== '';
  return false;
}

/**
 * Trigger node validation - requires trigger platform and type-specific fields.
 * Accepts both 'trigger' (modern) and 'platform' (legacy) field names.
 */
export const TriggerNodeValidationSchema = z
  .object({
    trigger: z.string().optional(),
    platform: z.string().optional(),
    entity_id: z.unknown().optional(),
    to: z.unknown().optional(),
    from: z.unknown().optional(),
    event_type: z.string().optional(),
    at: z.unknown().optional(),
    topic: z.string().optional(),
    webhook_id: z.string().optional(),
    // `device_id` is a single string for the 'device' trigger, but a
    // string-or-array for the 'tag' trigger (A1) — widen to accommodate both.
    device_id: z.union([z.string(), z.array(z.string())]).optional(),
    zone: z.string().optional(),
    event: z.string().optional(),
    value_template: z.string().optional(),
    // geo_location trigger (A1)
    source: z.string().optional(),
    // conversation/sentence trigger (A1)
    command: z.unknown().optional(),
    // tag trigger (A1)
    tag_id: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    const triggerType = data.trigger || data.platform;
    if (!triggerType || triggerType.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Trigger platform is required',
        path: ['trigger'],
      });
      return;
    }

    switch (triggerType) {
      case 'state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Entity is required for state triggers',
            path: ['entity_id'],
          });
        }
        break;

      case 'numeric_state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Entity is required for numeric state triggers',
            path: ['entity_id'],
          });
        }
        break;

      case 'event':
        if (!data.event_type || data.event_type.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Event type is required',
            path: ['event_type'],
          });
        }
        break;

      case 'time':
        if (!data.at) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Time value is required',
            path: ['at'],
          });
        }
        break;

      case 'mqtt':
        if (!data.topic || data.topic.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'MQTT topic is required',
            path: ['topic'],
          });
        }
        break;

      case 'webhook':
        if (!data.webhook_id || data.webhook_id.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Webhook ID is required',
            path: ['webhook_id'],
          });
        }
        break;

      case 'device':
        if (!hasEntityId(data.device_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Device is required',
            path: ['device_id'],
          });
        }
        break;

      case 'zone':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Entity is required for zone triggers',
            path: ['entity_id'],
          });
        }
        if (!data.zone || data.zone.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Zone is required',
            path: ['zone'],
          });
        }
        break;

      case 'sun':
      case 'homeassistant':
        if (!data.event || data.event.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              triggerType === 'sun'
                ? 'Sun event (sunrise/sunset) is required'
                : 'Home Assistant event (start/shutdown) is required',
            path: ['event'],
          });
        }
        break;

      case 'template':
        if (!data.value_template || data.value_template.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Template is required',
            path: ['value_template'],
          });
        }
        break;

      case 'geo_location':
        if (!data.source || data.source.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Source is required for geo_location triggers',
            path: ['source'],
          });
        }
        if (!data.zone || data.zone.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Zone is required for geo_location triggers',
            path: ['zone'],
          });
        }
        if (!data.event || data.event.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Event (enter/leave) is required for geo_location triggers',
            path: ['event'],
          });
        }
        break;

      case 'conversation':
        if (!hasValidTriggerId(data.command)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'At least one sentence is required for conversation triggers',
            path: ['command'],
          });
        }
        break;

      case 'tag':
        if (!hasValidTriggerId(data.tag_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Tag ID is required for tag triggers',
            path: ['tag_id'],
          });
        }
        break;

      // persistent_notification: every field (update_type, notification_id)
      // is optional per HA docs — nothing to require.
    }
  });

/**
 * Delay node validation - requires delay value.
 */
export const DelayNodeValidationSchema = z
  .object({
    delay: z.union([z.string(), z.object({})]),
  })
  .passthrough()
  .refine(
    (data) => {
      if (typeof data.delay === 'string') {
        return data.delay.trim() !== '';
      }
      // Object-based delay is valid if it has any duration field
      return true;
    },
    {
      message: 'Delay value is required',
      path: ['delay'],
    }
  );

/**
 * Condition node validation - requires condition type and type-specific fields.
 */
export const ConditionNodeValidationSchema = z
  .object({
    condition: z.string().min(1, 'Condition type is required'),
    entity_id: z.unknown().optional(),
    state: z.unknown().optional(),
    value_template: z.string().optional(),
    zone: z.string().optional(),
    device_id: z.string().optional(),
    id: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((data, ctx) => {
    switch (data.condition) {
      case 'state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Entity is required for state conditions',
            path: ['entity_id'],
          });
        }
        if (!data.state || (typeof data.state === 'string' && data.state.trim() === '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'State value is required',
            path: ['state'],
          });
        }
        break;

      case 'numeric_state':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Entity is required for numeric state conditions',
            path: ['entity_id'],
          });
        }
        break;

      case 'trigger':
        if (!hasValidTriggerId(data.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Trigger ID is required',
            path: ['id'],
          });
        }
        break;

      case 'template':
        if (!data.value_template || data.value_template.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Template is required',
            path: ['value_template'],
          });
        }
        break;

      case 'zone':
        if (!hasEntityId(data.entity_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Entity is required for zone conditions',
            path: ['entity_id'],
          });
        }
        if (!data.zone || data.zone.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Zone is required',
            path: ['zone'],
          });
        }
        break;

      case 'device':
        if (!data.device_id || data.device_id.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Device is required',
            path: ['device_id'],
          });
        }
        break;
    }
  });

/**
 * SetVariables node validation - requires at least one variable.
 */
export const SetVariablesNodeValidationSchema = z
  .object({
    variables: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (data) => {
      if (!data.variables) return false;
      return Object.keys(data.variables).length > 0;
    },
    {
      message: 'At least one variable must be defined',
      path: ['variables'],
    }
  );

/**
 * Map node types to their validation schemas.
 * Returns undefined for node types without specific validation.
 */
export function getNodeValidationSchema(nodeType: string): z.ZodSchema | undefined {
  switch (nodeType) {
    case 'wait':
      return WaitNodeValidationSchema;
    case 'action':
      return ActionNodeValidationSchema;
    case 'trigger':
      return TriggerNodeValidationSchema;
    case 'delay':
      return DelayNodeValidationSchema;
    case 'condition':
      return ConditionNodeValidationSchema;
    case 'set_variables':
      return SetVariablesNodeValidationSchema;
    default:
      return undefined;
  }
}

/**
 * Validation error structure
 */
export interface NodeValidationError {
  path: string[];
  message: string;
}

/**
 * Validate node data against its schema.
 * Returns an array of validation errors (empty if valid).
 */
export function validateNodeData(
  nodeType: string,
  data: Record<string, unknown>
): NodeValidationError[] {
  const schema = getNodeValidationSchema(nodeType);
  if (!schema) {
    return []; // No validation schema for this node type
  }

  const result = schema.safeParse(data);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
  }));
}
