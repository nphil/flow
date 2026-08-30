import type {
  ActionNode,
  CafeMetadata,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowGraph,
  FlowNode,
  HAAction,
  HACondition,
  HADelay,
  HAWait,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@flow/shared';
import {
  CafeMetadataSchema,
  FlowGraphMetadataSchema,
  FlowGraphSchema,
  HAConditionSchema,
  HATriggerSchema,
  isDeviceAction,
  isHACondition,
  validateGraphStructure,
} from '@flow/shared';
import { load as yamlLoad } from 'js-yaml';
import { generateEdgeId, generateGraphId, generateNodeId } from '../utils/generateIds';
import { PathRecorder, type TracePathMap } from '../utils/tracePathMap';
import { applyHeuristicLayout } from './layout';

// Type guards for Home Assistant objects

/** Returns true if the action is a delay node */
function isDelayAction(action: unknown): action is HADelay {
  return (
    typeof action === 'object' &&
    action !== null &&
    'delay' in action &&
    (typeof (action as Record<string, unknown>).delay === 'string' ||
      typeof (action as Record<string, unknown>).delay === 'number' ||
      (typeof (action as Record<string, unknown>).delay === 'object' &&
        (action as Record<string, unknown>).delay !== null))
  );
}

type DelayDurationObject = {
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
};

const DELAY_DURATION_MULTIPLIERS = {
  hours: 60 * 60 * 1000,
  minutes: 60 * 1000,
  seconds: 1000,
  milliseconds: 1,
} as const;

function isFiniteDelayNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function unwrapTemplateExpression(value: string): string {
  const trimmed = value.trim();
  const templateMatch = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(trimmed);
  return templateMatch ? templateMatch[1].trim() : trimmed;
}

function toDelayTemplatePart(value: unknown): string | null {
  if (isFiniteDelayNumber(value)) {
    return String(value);
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const trimmed = value.trim();
  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) {
    return String(numericValue);
  }

  return `(${unwrapTemplateExpression(trimmed)})`;
}

function buildTemplatedDelayString(duration: Record<string, unknown>): string {
  const terms = Object.entries(DELAY_DURATION_MULTIPLIERS).flatMap(([key, multiplier]) => {
    const templatePart = toDelayTemplatePart(duration[key]);
    if (!templatePart) {
      return [];
    }

    return multiplier === 1 ? [templatePart] : [`(${templatePart}) * ${multiplier}`];
  });

  const totalMillisecondsExpression = terms.length > 0 ? terms.join(' + ') : '0';
  const hoursExpression = `(${totalMillisecondsExpression}) // 3600000`;
  const minutesExpression = `((${totalMillisecondsExpression}) % 3600000) // 60000`;
  const secondsExpression = `((${totalMillisecondsExpression}) % 60000) // 1000`;
  const millisecondsExpression = `(${totalMillisecondsExpression}) % 1000`;

  return Object.hasOwn(duration, 'milliseconds')
    ? `{{ '%02d:%02d:%02d.%03d' | format(${hoursExpression}, ${minutesExpression}, ${secondsExpression}, ${millisecondsExpression}) }}`
    : `{{ '%02d:%02d:%02d' | format(${hoursExpression}, ${minutesExpression}, ${secondsExpression}) }}`;
}

function normalizeDelayValue(delayValue: unknown): string | DelayDurationObject {
  if (typeof delayValue === 'string') {
    return delayValue;
  }

  if (isFiniteDelayNumber(delayValue)) {
    return String(delayValue);
  }

  if (typeof delayValue !== 'object' || delayValue === null) {
    return '';
  }

  const duration = delayValue as Record<string, unknown>;
  const normalizedDuration: DelayDurationObject = {};
  let requiresTemplateNormalization = false;

  for (const key of Object.keys(DELAY_DURATION_MULTIPLIERS) as Array<keyof DelayDurationObject>) {
    const rawValue = duration[key];
    if (rawValue === undefined) {
      continue;
    }

    if (isFiniteDelayNumber(rawValue)) {
      normalizedDuration[key] = rawValue;
      continue;
    }

    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      const numericValue = Number(rawValue.trim());
      if (Number.isFinite(numericValue)) {
        normalizedDuration[key] = numericValue;
      } else {
        requiresTemplateNormalization = true;
      }
      continue;
    }

    requiresTemplateNormalization = true;
  }

  if (requiresTemplateNormalization) {
    return buildTemplatedDelayString(duration);
  }

  return normalizedDuration;
}

/** Returns true if the action is a wait node */
function isWaitAction(action: unknown): action is HAWait {
  return (
    typeof action === 'object' &&
    action !== null &&
    ('wait_template' in action || 'wait_for_trigger' in action)
  );
}

/** Returns true if the action is a choose block */
function isChooseAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'choose' in action;
}

/** Returns true if the action is a parallel block */
function isParallelAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'parallel' in action &&
    Array.isArray((action as Record<string, unknown>).parallel)
  );
}

/** Returns true if the action is an if/then/else block */
function isIfThenAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'if' in action &&
    Array.isArray((action as Record<string, unknown>).if) &&
    'then' in action &&
    Array.isArray((action as Record<string, unknown>).then)
  );
}

/** Returns true if the action is a service or action call */
function isServiceAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    (typeof (action as Record<string, unknown>).service === 'string' ||
      typeof (action as Record<string, unknown>).action === 'string')
  );
}

/** Returns true if the action is an inline condition (guard) in the action sequence */
function isConditionAction(action: unknown): action is HACondition {
  return (
    typeof action === 'object' &&
    action !== null &&
    'condition' in action &&
    typeof (action as Record<string, unknown>).condition === 'string'
  );
}

/** Returns true if the action is a variables block */
function isVariablesAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'variables' in action &&
    typeof (action as Record<string, unknown>).variables === 'object' &&
    // Make sure it's not mistaken for other action types that might have variables
    !('service' in action) &&
    !('action' in action) &&
    !('delay' in action) &&
    !('wait_template' in action) &&
    !('choose' in action) &&
    !('if' in action)
  );
}

/** Returns true if the action is a set_conversation_response action */
function isSetConversationResponseAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'set_conversation_response' in action;
}

/** Returns true if the action is a stop action */
function isStopAction(action: unknown): action is Record<string, unknown> {
  return typeof action === 'object' && action !== null && 'stop' in action;
}

/** Returns true if the action is a repeat block */
function isRepeatAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'repeat' in action &&
    typeof (action as Record<string, unknown>).repeat === 'object' &&
    (action as Record<string, unknown>).repeat !== null
  );
}

/** Returns true if the action is an event firing action */
function isEventAction(action: unknown): action is Record<string, unknown> {
  return (
    typeof action === 'object' &&
    action !== null &&
    'event' in action &&
    typeof (action as Record<string, unknown>).event === 'string'
  );
}

/**
 * Matches the synthetic node id the state-machine strategy generates for a
 * trigger with multiple targets (see `generateParallelEntryBlocks`). These
 * ids never correspond to a real canvas node — they get expanded into the
 * real target nodes and removed from the node map before nodes are built.
 */
const PARALLEL_TRIGGER_ID_PATTERN = /^__parallel_trigger_\d+$/;

/**
 * Information about a node parsed from a state-machine choose block or inline parallel branch
 */
interface StateMachineNodeInfo {
  nodeId: string;
  nodeType: 'action' | 'condition' | 'delay' | 'wait';
  data: Record<string, unknown>;
  trueTarget: string | null;
  falseTarget: string | null;
  parallelItems?: unknown[];
  /** Index within the choose block's `sequence` array where `parallelItems` was found. */
  parallelItemsIndex?: number;
}

/**
 * Result of parsing YAML
 */
export interface ParseResult {
  success: boolean;
  graph?: FlowGraph;
  errors?: string[];
  warnings: string[];
  hadMetadata: boolean;
  /** Home Assistant trace path <-> canvas node id map. Present when `success` is true. */
  nodePathMap?: TracePathMap;
}

/**
 * Legacy/structural Home Assistant condition types (pre-2026 schema) — the
 * ones with dedicated FieldConfig-driven editors in conditionFields.ts.
 */
const LEGACY_CONDITIONS = [
  'state',
  'numeric_state',
  'template',
  'time',
  'sun',
  'zone',
  'and',
  'or',
  'not',
  'device',
  'trigger',
] as const;

/**
 * Purpose-specific ("integration") condition types introduced in HA 2026.x
 * (parity fix A3 — see local://parity-audit.md and design doc §6). Each one
 * speaks the domain's own language (e.g. `battery.is_level`) with
 * `target:`/`options:` instead of entity_id/above/below, and is rendered by
 * a single generic "integration condition" editor (type badge + key/value
 * list + YAML foldout) rather than a bespoke per-type UI — so there is no
 * per-type field-config cost to listing the complete catalog here, only
 * upside: every one becomes round-trip-safe (see the "kill the
 * fallback-to-template path" note below) instead of just a curated subset.
 * Sourced from the official catalog at https://www.home-assistant.io/conditions/
 * (HA 2026.6.4, fetched 2026-08-27), organized by integration exactly as
 * that page groups them.
 */
const PURPOSE_SPECIFIC_CONDITIONS = [
  // Air quality
  'air_quality.is_co2_value',
  'air_quality.is_co_cleared',
  'air_quality.is_co_detected',
  'air_quality.is_co_value',
  'air_quality.is_gas_cleared',
  'air_quality.is_gas_detected',
  'air_quality.is_n2o_value',
  'air_quality.is_no2_value',
  'air_quality.is_no_value',
  'air_quality.is_ozone_value',
  'air_quality.is_pm10_value',
  'air_quality.is_pm1_value',
  'air_quality.is_pm25_value',
  'air_quality.is_pm4_value',
  'air_quality.is_smoke_cleared',
  'air_quality.is_smoke_detected',
  'air_quality.is_so2_value',
  'air_quality.is_voc_ratio_value',
  'air_quality.is_voc_value',
  // Alarm control panel
  'alarm_control_panel.is_armed',
  'alarm_control_panel.is_armed_away',
  'alarm_control_panel.is_armed_home',
  'alarm_control_panel.is_armed_night',
  'alarm_control_panel.is_armed_vacation',
  'alarm_control_panel.is_disarmed',
  'alarm_control_panel.is_triggered',
  // Assist Satellite
  'assist_satellite.is_idle',
  'assist_satellite.is_listening',
  'assist_satellite.is_processing',
  'assist_satellite.is_responding',
  // Battery
  'battery.is_charging',
  'battery.is_level',
  'battery.is_low',
  'battery.is_not_charging',
  'battery.is_not_low',
  // Calendar
  'calendar.is_event_active',
  // Climate
  'climate.is_cooling',
  'climate.is_drying',
  'climate.is_heating',
  'climate.is_hvac_mode',
  'climate.is_off',
  'climate.is_on',
  'climate.is_target_humidity',
  'climate.is_target_temperature',
  // Counter
  'counter.is_value',
  // Cover
  'cover.awning_is_closed',
  'cover.awning_is_open',
  'cover.blind_is_closed',
  'cover.blind_is_open',
  'cover.curtain_is_closed',
  'cover.curtain_is_open',
  'cover.shade_is_closed',
  'cover.shade_is_open',
  'cover.shutter_is_closed',
  'cover.shutter_is_open',
  // Door
  'door.is_closed',
  'door.is_open',
  // Fan
  'fan.is_off',
  'fan.is_on',
  // Garage door
  'garage_door.is_closed',
  'garage_door.is_open',
  // Gate
  'gate.is_closed',
  'gate.is_open',
  // Humidifier
  'humidifier.is_drying',
  'humidifier.is_humidifying',
  'humidifier.is_mode',
  'humidifier.is_off',
  'humidifier.is_on',
  'humidifier.is_target_humidity',
  // Humidity
  'humidity.is_value',
  // Illuminance
  'illuminance.is_detected',
  'illuminance.is_not_detected',
  'illuminance.is_value',
  // Lawn mower
  'lawn_mower.is_docked',
  'lawn_mower.is_encountering_an_error',
  'lawn_mower.is_mowing',
  'lawn_mower.is_paused',
  'lawn_mower.is_returning',
  // Light
  'light.is_brightness',
  'light.is_off',
  'light.is_on',
  // Lock
  'lock.is_jammed',
  'lock.is_locked',
  'lock.is_open',
  'lock.is_unlocked',
  // Media player
  'media_player.is_muted',
  'media_player.is_not_playing',
  'media_player.is_off',
  'media_player.is_on',
  'media_player.is_paused',
  'media_player.is_playing',
  'media_player.is_unmuted',
  'media_player.is_volume',
  // Moisture
  'moisture.is_detected',
  'moisture.is_not_detected',
  'moisture.is_value',
  // Moon
  'moon.is_phase',
  'moon.is_waning',
  'moon.is_waxing',
  // Motion
  'motion.is_detected',
  'motion.is_not_detected',
  // Occupancy
  'occupancy.is_detected',
  'occupancy.is_not_detected',
  // Power
  'power.is_value',
  // Remote
  'remote.is_off',
  'remote.is_on',
  // Schedule
  'schedule.is_off',
  'schedule.is_on',
  // Select
  'select.is_option_selected',
  // Siren
  'siren.is_off',
  'siren.is_on',
  // Sun (additive alongside the legacy bare 'sun' condition above)
  'sun.elevation',
  'sun.is_ascending',
  'sun.is_descending',
  'sun.is_evening_twilight',
  'sun.is_morning_twilight',
  'sun.is_night',
  'sun.is_set',
  'sun.is_up',
  // Switch
  'switch.is_off',
  'switch.is_on',
  // Temperature
  'temperature.is_value',
  // Text
  'text.is_equal_to',
  // Timer
  'timer.is_active',
  'timer.is_idle',
  'timer.is_paused',
  // To-do list
  'todo.all_completed',
  'todo.incomplete',
  // Update
  'update.is_available',
  'update.is_not_available',
  // Vacuum
  'vacuum.is_cleaning',
  'vacuum.is_docked',
  'vacuum.is_encountering_an_error',
  'vacuum.is_paused',
  'vacuum.is_returning',
  // Valve
  'valve.is_closed',
  'valve.is_open',
  // Vibration
  'vibration.is_detected',
  'vibration.is_not_detected',
  // Water heater
  'water_heater.is_off',
  'water_heater.is_on',
  'water_heater.is_operation_mode',
  'water_heater.is_target_temperature',
  // Window
  'window.is_closed',
  'window.is_open',
  // Zone (additive alongside the legacy bare 'zone' condition above)
  'zone.in_zone',
  'zone.not_in_zone',
  'zone.occupancy_is_detected',
  'zone.occupancy_is_not_detected',
] as const;

/**
 * Valid condition types for Home Assistant. Anything in this list survives
 * parsing with its real `condition` value intact (A3: "kill the
 * fallback-to-template path for known-listed types") — everything else
 * still falls back to a template condition, same as before.
 */
const VALID_CONDITIONS = [...LEGACY_CONDITIONS, ...PURPOSE_SPECIFIC_CONDITIONS] as const;

type ValidConditionType = (typeof VALID_CONDITIONS)[number];

/**
 * Options for parsing actions and nested blocks
 */
interface ParseOptions {
  /** Warnings array to append to */
  warnings: string[];
  /** Node IDs to connect from */
  previousNodeIds: string[];
  /** Function to generate unique node IDs */
  getNextNodeId: (type: string) => string;
  /** Set of condition node IDs for proper edge handle assignment */
  conditionNodeIds?: Set<string>;
  /** Set of condition node IDs whose FALSE path should connect to next action */
  falsePathConditionIds?: Set<string>;
  /**
   * Map from trigger node ID → trigger's `id` field.
   * Used to route trigger-id conditions directly to matching trigger nodes.
   */
  triggerNodeMap?: Map<string, string>;
  /**
   * Inherited enabled state from parent block.
   * When false, all child nodes will be created with enabled: false.
   * When undefined, nodes inherit their own enabled property.
   */
  inheritedEnabled?: boolean;
  /** Records the Home Assistant trace path(s) each created node id maps to. */
  recorder: PathRecorder;
  /**
   * Home Assistant trace path prefix for the action list this call is
   * walking (e.g. `action` for the top-level action list, `action/2/then`
   * for an if-block's then branch). Each item's own trace path is
   * `${pathPrefix}/${index}`.
   */
  pathPrefix: string;
}

/**
 * Nested condition type (supports recursive nesting)
 */
type NestedCondition = NonNullable<ConditionNode['data']['conditions']>[number];

/**
 * Transform an array of Home Assistant conditions to internal format
 */
function transformConditions(conditions: HACondition[]): NestedCondition[] {
  return conditions.map((c) => transformToNestedCondition(c));
}

/**
 * Transform Home Assistant condition format to internal nested condition format
 * HA uses 'condition' field, internal schema uses 'condition'
 * Recursively handles nested conditions for and/or/not
 */
function transformToNestedCondition(condition: HACondition): NestedCondition {
  // Use spread pattern to preserve unknown properties from custom integrations
  const { condition: conditionField, conditions, ...rest } = condition;
  const conditionType = conditionField || 'template';
  const validatedType = VALID_CONDITIONS.includes(conditionType as ValidConditionType)
    ? (conditionType as ValidConditionType)
    : 'template';

  // Recursively transform nested conditions if present
  const nestedConditions = Array.isArray(conditions) ? transformConditions(conditions) : undefined;

  return {
    ...rest, // Preserve extra properties (including weekday, after, before, etc.)
    condition: validatedType,
    // This sub-condition is never overwritten by an enclosing step's alias
    // (only a top-level ConditionNode's `alias` is), so its own `alias` is
    // already unambiguous. Mirror it into `conditionAlias` too so the
    // generator's single "alias comes from conditionAlias" rule applies
    // uniformly at every nesting depth without special-casing.
    conditionAlias: typeof rest.alias === 'string' ? rest.alias : undefined,
    conditions: nestedConditions,
  };
}

/**
 * Parser for converting Home Assistant YAML back to FlowGraph
 */
export class YamlParser {
  /**
   * Parse Home Assistant YAML string into FlowGraph
   */
  async parse(yamlString: string): Promise<ParseResult> {
    const warnings: string[] = [];
    const recorder = new PathRecorder();

    try {
      // Step 1: Parse YAML string
      let parsed = yamlLoad(yamlString) as Record<string, unknown> | unknown[];

      // Handle array format (list of automations) - use the first one
      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          return {
            success: false,
            errors: ['Empty automation array'],
            warnings,
            hadMetadata: false,
          };
        }
        parsed = parsed[0] as Record<string, unknown>;
      }

      if (!parsed || typeof parsed !== 'object') {
        return {
          success: false,
          errors: ['Invalid YAML structure'],
          warnings,
          hadMetadata: false,
        };
      }

      // Step 2: Extract C.A.F.E. metadata if present
      const metadata = this.extractMetadata(parsed);
      const hadMetadata = metadata !== null;

      // Step 2b: Extract user-defined variables (excluding _cafe_metadata)
      const userVariables = this.extractUserVariables(parsed);

      // Step 3: Only support automation format (no script import)
      const content = parsed;
      // Defensive: ensure content is Record<string, unknown>
      if (typeof content !== 'object' || content === null) {
        return {
          success: false,
          errors: ['Invalid YAML content structure'],
          warnings,
          hadMetadata,
        };
      }

      // Step 4: Extract node IDs from metadata if available
      const metadataNodeIds = metadata ? Object.keys(metadata.nodes) : [];

      // Step 5: Check if this is a state-machine format automation
      const isStateMachine =
        metadata?.strategy === 'state-machine' || this.detectStateMachineFormat(content);

      // Step 6: Parse nodes and edges from YAML structure
      const { nodes, edges } = isStateMachine
        ? this.parseStateMachineStructure(content, warnings, metadataNodeIds, recorder)
        : this.parseAutomationStructure(content, warnings, metadataNodeIds, recorder);

      // Step 7: Apply positions from metadata or generate heuristic layout
      let nodesWithPositions: FlowNode[];
      if (hadMetadata && metadata) {
        nodesWithPositions = this.applyMetadataPositions(nodes, metadata);
      } else {
        // Use async heuristic layout if metadata is missing
        nodesWithPositions = await applyHeuristicLayout(nodes, edges);
      }

      // Step 8: Build FlowGraph object
      // Validate and parse metadata block using FlowGraphMetadataSchema
      const rawMetadata = {
        mode: content.mode,
        max: content.max,
        max_exceeded: content.max_exceeded,
        initial_state: content.initial_state,
        hide_entity: content.hide_entity,
        trace: content.trace,
      };
      const metadataResult = FlowGraphMetadataSchema.safeParse(rawMetadata);
      const metadataBlock = metadataResult.success
        ? metadataResult.data
        : FlowGraphMetadataSchema.parse({});

      const userTriggerVariables =
        typeof content.trigger_variables === 'object' &&
        content.trigger_variables !== null &&
        !Array.isArray(content.trigger_variables)
          ? (content.trigger_variables as Record<string, unknown>)
          : undefined;

      const graph: FlowGraph = {
        id: metadata?.graph_id || generateGraphId(),
        name: typeof content.alias === 'string' ? content.alias : 'Imported Automation',
        description: typeof content.description === 'string' ? content.description : '',
        nodes: nodesWithPositions,
        edges,
        metadata: metadataBlock,
        version: 1 as const,
        // Preserve user-defined variables for round-trip
        userVariables: Object.keys(userVariables).length > 0 ? userVariables : undefined,
        userTriggerVariables:
          userTriggerVariables && Object.keys(userTriggerVariables).length > 0
            ? userTriggerVariables
            : undefined,
      };

      // Safety net: an edge leaving a condition node without a boolean handle
      // would fail structure validation below and block the automation from
      // opening at all. Never hard-fail on this: label the edge (preferring
      // the vacant handle) and surface a warning instead.
      {
        const conditionIds = new Set(
          graph.nodes.filter((n) => n.type === 'condition').map((n) => n.id)
        );
        for (const edge of graph.edges) {
          if (!conditionIds.has(edge.source)) continue;
          if (edge.sourceHandle === 'true' || edge.sourceHandle === 'false') continue;
          const siblings = graph.edges.filter((e) => e.source === edge.source && e !== edge);
          const hasTrue = siblings.some((e) => e.sourceHandle === 'true');
          const hasFalse = siblings.some((e) => e.sourceHandle === 'false');
          edge.sourceHandle = hasTrue && !hasFalse ? 'false' : 'true';
          warnings.push(
            `Edge from condition node ${edge.source} had no true/false handle; assumed '${edge.sourceHandle}'.`
          );
        }
      }

      // Step 7: Validate with Zod schema
      const validation = FlowGraphSchema.safeParse(graph);

      if (!validation.success) {
        // Enhanced error logging: show node data and schema path
        // Zod v4 uses 'issues' instead of 'errors'
        const errorDetails = validation.error.issues.map((e) => {
          let nodeInfo = '';
          if (e.path && e.path.length > 0) {
            // Try to extract node id/type if error is in nodes array
            if (e.path[0] === 'nodes' && typeof e.path[1] === 'number') {
              const idx = e.path[1];
              const node = graph.nodes[idx];
              nodeInfo = `Node index ${idx} (id: ${node?.id}, type: ${
                node?.type
              })\nData: ${JSON.stringify(node?.data, null, 2)}`;
            }
          }
          return `Schema path: ${e.path.join('.')}\nMessage: ${e.message}${
            nodeInfo ? `\n${nodeInfo}` : ''
          }`;
        });
        // Also log to console for debugging
        console.error('Zod validation error details:', errorDetails);
        return {
          success: false,
          errors: errorDetails,
          warnings,
          hadMetadata,
        };
      }

      // Step 8: Validate graph structure (triggers, edges, etc.)
      const structureValidation = validateGraphStructure(validation.data);

      if (!structureValidation.valid) {
        return {
          success: false,
          errors: structureValidation.errors,
          warnings,
          hadMetadata,
        };
      }

      return {
        success: true,
        graph: validation.data,
        warnings,
        hadMetadata,
        nodePathMap: recorder.toTracePathMap(),
      };
    } catch (error) {
      // Enhanced catch block: log YAML and error
      console.error('YAML parsing error:', error);
      console.error('YAML string:', yamlString);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown parsing error'],
        warnings,
        hadMetadata: false,
      };
    }
  }

  /**
   * Extract C.A.F.E. metadata from variables section
   */
  /**
   * Extract and validate C.A.F.E. metadata from variables section using Zod schema.
   * Returns CafeMetadata if valid, otherwise null.
   */
  private extractMetadata(parsed: Record<string, unknown>): CafeMetadata | null {
    try {
      let variables: unknown;
      if (typeof parsed.variables === 'object' && parsed.variables !== null) {
        variables = parsed.variables;
      }
      if (
        variables &&
        typeof variables === 'object' &&
        '_cafe_metadata' in variables &&
        typeof (variables as Record<string, unknown>)._cafe_metadata === 'object' &&
        (variables as Record<string, unknown>)._cafe_metadata !== null
      ) {
        const metadata = (variables as Record<string, unknown>)._cafe_metadata;
        const result = CafeMetadataSchema.safeParse(metadata);
        if (result.success) {
          return result.data;
        }
      }
    } catch {
      // Metadata not present or malformed
    }
    return null;
  }

  /**
   * Extract user-defined variables from the root variables section.
   * Excludes _cafe_metadata which is handled separately.
   */
  private extractUserVariables(parsed: Record<string, unknown>): Record<string, unknown> {
    const userVariables: Record<string, unknown> = {};

    if (typeof parsed.variables === 'object' && parsed.variables !== null) {
      const variables = parsed.variables as Record<string, unknown>;
      for (const [key, value] of Object.entries(variables)) {
        // Skip _cafe_metadata - it's handled separately
        if (key !== '_cafe_metadata') {
          userVariables[key] = value;
        }
      }
    }

    return userVariables;
  }

  /**
   * Detect if automation is in state-machine format
   * State-machine format has:
   * - A variables action with current_node and flow_context
   * - A repeat loop with choose blocks
   */
  private detectStateMachineFormat(content: Record<string, unknown>): boolean {
    const actions = (content.actions || content.action) as unknown[];
    if (!Array.isArray(actions)) return false;

    let hasCurrentNodeVar = false;
    let hasRepeatChoose = false;

    for (const action of actions) {
      const actionObj = action as Record<string, unknown>;

      // Check for variables with current_node
      if (actionObj.variables) {
        const vars = actionObj.variables as Record<string, unknown>;
        if ('current_node' in vars && 'flow_context' in vars) {
          hasCurrentNodeVar = true;
        }
      }

      // Check for repeat with choose
      if (actionObj.repeat) {
        const repeat = actionObj.repeat as Record<string, unknown>;
        const sequence = repeat.sequence as unknown[];
        if (Array.isArray(sequence)) {
          for (const seqItem of sequence) {
            const seqObj = seqItem as Record<string, unknown>;
            if (Array.isArray(seqObj.choose)) {
              hasRepeatChoose = true;
              break;
            }
          }
        }
      }
    }

    return hasCurrentNodeVar && hasRepeatChoose;
  }

  /**
   * Parse state-machine format automation into nodes and edges
   *
   * State-machine format structure:
   * - Triggers are parsed normally
   * - Actions contain: variables (current_node init) + repeat/choose blocks
   * - Each choose block represents a node:
   *   - condition: {{ current_node == "node-id" }}
   *   - sequence: [node action, variables: { current_node: "next-node" }]
   */
  private parseStateMachineStructure(
    content: Record<string, unknown>,
    warnings: string[],
    metadataNodeIds: string[],
    recorder: PathRecorder
  ): { nodes: FlowNode[]; edges: FlowEdge[] } {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    // Find the entry node and parse the state machine
    const actions = (content.actions || content.action) as unknown[];
    if (!Array.isArray(actions)) {
      warnings.push('No actions found in automation');
      return { nodes, edges };
    }

    let entryNodeId: string | null = null;
    const nodeInfoMap = new Map<string, StateMachineNodeInfo>();
    // Trace path (`action/{dispatchIdx}/repeat/sequence/{chooseIdx}/choose/{b}`)
    // each choose-block-derived node was parsed from. Kept separately from
    // nodeInfoMap because `__parallel_trigger_*` entries are deleted below
    // once they've been expanded, but their base path is still needed to
    // compose paths for the real nodes inlined inside them.
    const chooseBlockPaths = new Map<string, string>();

    actions.forEach((action, dispatchIdx) => {
      const actionObj = action as Record<string, unknown>;

      // Find entry node from initial variables
      if (actionObj.variables) {
        const vars = actionObj.variables as Record<string, unknown>;
        if (typeof vars.current_node === 'string' && vars.current_node !== 'END') {
          entryNodeId = vars.current_node;
        }
      }

      // Parse repeat/choose structure
      if (actionObj.repeat) {
        const repeat = actionObj.repeat as Record<string, unknown>;
        const sequence = repeat.sequence as unknown[];

        if (Array.isArray(sequence)) {
          sequence.forEach((seqItem, chooseIdx) => {
            const seqObj = seqItem as Record<string, unknown>;

            if (Array.isArray(seqObj.choose)) {
              seqObj.choose.forEach((chooseBlock, b) => {
                const block = chooseBlock as Record<string, unknown>;
                const nodeInfo = this.parseStateMachineChooseBlock(block);
                if (nodeInfo) {
                  nodeInfoMap.set(nodeInfo.nodeId, nodeInfo);
                  const basePath = `action/${dispatchIdx}/repeat/sequence/${chooseIdx}/choose/${b}`;
                  chooseBlockPaths.set(nodeInfo.nodeId, basePath);

                  // `__parallel_trigger_*` dispatcher branches don't correspond to a
                  // single canvas node — they get resolved into real nodes below,
                  // which are recorded against their own deeper paths instead.
                  if (!PARALLEL_TRIGGER_ID_PATTERN.test(nodeInfo.nodeId)) {
                    const conditions = block.conditions;
                    const conditionsCount = Array.isArray(conditions) ? conditions.length : 0;
                    for (let k = 0; k < conditionsCount; k++) {
                      recorder.record(nodeInfo.nodeId, `${basePath}/conditions/${k}`);
                    }
                    const sequence2 = block.sequence;
                    const sequenceCount = Array.isArray(sequence2) ? sequence2.length : 0;
                    for (let j = 0; j < sequenceCount; j++) {
                      recorder.record(nodeInfo.nodeId, `${basePath}/sequence/${j}`);
                    }
                  }
                }
              });
            }
          });
        }
      }
    });

    // Resolve __parallel_trigger_* synthetic entries.
    // The transpiler generates these for triggers with multiple targets.
    // Expand them back into direct trigger→target edges instead of phantom nodes.
    const parallelTriggerTargets = new Map<string, string[]>();
    for (const [nodeId, info] of nodeInfoMap) {
      if (!PARALLEL_TRIGGER_ID_PATTERN.test(nodeId)) continue;

      const basePath = chooseBlockPaths.get(nodeId);
      const parallelPrefix =
        basePath !== undefined && info.parallelItemsIndex !== undefined
          ? `${basePath}/sequence/${info.parallelItemsIndex}/parallel`
          : null;

      const targetIds = this.parseInlineParallelBranches(
        info.parallelItems ?? [],
        nodeInfoMap,
        recorder,
        parallelPrefix
      );
      if (targetIds.length > 0) {
        parallelTriggerTargets.set(nodeId, targetIds);
      }
      nodeInfoMap.delete(nodeId);
    }

    // In state-machine strategy, action/condition/delay/wait node IDs are extracted
    // directly from the Jinja2 templates in the YAML choose blocks. Only trigger
    // node IDs need to be allocated via getNextNodeId, so we filter out IDs that
    // are already claimed by the choose blocks to avoid assigning them to triggers.
    const stateMachineNodeIds = new Set(nodeInfoMap.keys());
    const triggerMetadataIds = metadataNodeIds.filter((id) => !stateMachineNodeIds.has(id));
    let triggerIdIndex = 0;
    let nodeIdIndex = 0;

    const getNextNodeId = (type: string): string => {
      if (triggerIdIndex < triggerMetadataIds.length) {
        return triggerMetadataIds[triggerIdIndex++];
      }
      return generateNodeId(type, nodeIdIndex++);
    };

    // Parse triggers
    const triggerData = content.triggers || content.trigger;
    if (!triggerData) {
      warnings.push('No triggers found in automation');
      return { nodes, edges };
    }
    const triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
    const triggerNodes = this.parseTriggers(
      triggers as Record<string, unknown>[],
      warnings,
      getNextNodeId,
      recorder
    );
    nodes.push(...triggerNodes);

    // Create nodes from parsed info
    for (const [nodeId, info] of nodeInfoMap) {
      const nodeType = info.nodeType;

      switch (nodeType) {
        case 'condition':
          nodes.push({
            id: nodeId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: info.data as ConditionNode['data'],
          });
          break;
        case 'action':
          nodes.push({
            id: nodeId,
            type: 'action',
            position: { x: 0, y: 0 },
            data: info.data as ActionNode['data'],
          });
          break;
        case 'delay':
          nodes.push({
            id: nodeId,
            type: 'delay',
            position: { x: 0, y: 0 },
            data: info.data as DelayNode['data'],
          });
          break;
        case 'wait':
          nodes.push({
            id: nodeId,
            type: 'wait',
            position: { x: 0, y: 0 },
            data: info.data as WaitNode['data'],
          });
          break;
      }
    }

    // Create edges
    // Connect triggers to entry node(s)
    if (entryNodeId) {
      // Check if entryNodeId is a Jinja2 template for trigger routing
      const triggerRouting = this.parseEntryNodeTemplate(entryNodeId);

      if (triggerRouting && triggerRouting.size > 0) {
        // Different triggers route to different nodes
        for (let i = 0; i < triggerNodes.length; i++) {
          const targetNodeId = triggerRouting.get(i);
          if (targetNodeId) {
            // Expand synthetic parallel trigger entries into direct edges
            const expandedTargets = parallelTriggerTargets.get(targetNodeId);
            if (expandedTargets) {
              for (const actualTarget of expandedTargets) {
                edges.push(this.createEdge(triggerNodes[i].id, actualTarget));
              }
            } else {
              edges.push(this.createEdge(triggerNodes[i].id, targetNodeId));
            }
          }
        }
      } else {
        // All triggers route to same node (simple case)
        for (const trigger of triggerNodes) {
          edges.push(this.createEdge(trigger.id, entryNodeId));
        }
      }
    }

    // Create edges between nodes based on transitions
    for (const [nodeId, info] of nodeInfoMap) {
      if (info.trueTarget && info.trueTarget !== 'END') {
        edges.push({
          id: `edge-${nodeId}-${info.trueTarget}`,
          source: nodeId,
          target: info.trueTarget,
          sourceHandle: info.nodeType === 'condition' || info.falseTarget ? 'true' : undefined,
        });
      }
      if (info.falseTarget && info.falseTarget !== 'END') {
        edges.push({
          id: `edge-${nodeId}-${info.falseTarget}`,
          source: nodeId,
          target: info.falseTarget,
          sourceHandle: 'false',
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Parse Jinja2 entry node template to extract trigger-to-node routing
   *
   * Template format: {% if trigger.idx == "0" %}action_0{% elif trigger.idx == "1" %}action_1{% else %}action_2{% endif %}
   * Note: trigger.idx is a string in HA, so comparisons use quoted values
   * Returns a Map where key = trigger index, value = target node ID
   */
  private parseEntryNodeTemplate(entryNodeId: string): Map<number, string> | null {
    // Check if it's a Jinja2 template
    if (!entryNodeId.includes('{%') || !entryNodeId.includes('trigger.idx')) {
      return null;
    }

    const routing = new Map<number, string>();

    // Match {% if trigger.idx == "N" %}nodeId or {% elif trigger.idx == "N" %}nodeId
    // trigger.idx is a string in HA, so index is quoted; node IDs are NOT quoted
    const ifPattern =
      /{%\s*(?:if|elif)\s+trigger\.idx\s*==\s*["'](\d+)["']\s*%}\s*([^{%]+?)(?={%|$)/g;
    const matches = entryNodeId.matchAll(ifPattern);

    for (const match of matches) {
      const triggerIdx = parseInt(match[1], 10);
      const nodeId = match[2].trim();
      routing.set(triggerIdx, nodeId);
    }

    // Match {% else %}nodeId for the default case (last trigger if not explicitly matched)
    const elseMatch = entryNodeId.match(/{%\s*else\s*%}\s*([^{%]+?)(?={%|$)/);
    if (elseMatch && routing.size > 0) {
      // The else branch is for the last trigger index not explicitly matched
      // Find the highest trigger index and add 1
      const maxIdx = Math.max(...routing.keys());
      routing.set(maxIdx + 1, elseMatch[1].trim());
    }

    return routing.size > 0 ? routing : null;
  }

  /**
   * Parse inline parallel branch items into nodes and edges.
   * Reconstructs the subgraph that was inlined by the transpiler's generateInlineBranch.
   * Returns the root node IDs of each branch (for trigger→target edge creation).
   */
  private parseInlineParallelBranches(
    parallelItems: unknown[],
    nodeInfoMap: Map<string, StateMachineNodeInfo>,
    recorder: PathRecorder,
    pathPrefix: string | null
  ): string[] {
    const targetIds: string[] = [];
    let idCounter = 0;

    const generateId = (type: string): string => `inline_${type}_${idCounter++}`;

    parallelItems.forEach((item, branchIndex) => {
      const pItem = item as Record<string, unknown>;
      const alias = pItem.alias as string | undefined;
      const branchPath = pathPrefix ? `${pathPrefix}/${branchIndex}/sequence` : null;

      // New format: { alias: "parallel_branch:<nodeId>", ... }
      const branchMatch = alias?.match(/^parallel_branch:(.+)$/);
      if (branchMatch) {
        const rootNodeId = branchMatch[1];
        targetIds.push(rootNodeId);

        // Parse the branch content into nodes
        if (Array.isArray(pItem.sequence)) {
          this.parseInlineActionList(
            pItem.sequence as Record<string, unknown>[],
            rootNodeId,
            nodeInfoMap,
            generateId,
            recorder,
            branchPath
          );
        } else {
          // Single-action branch — HA still traces it as sequence index 0.
          this.parseInlineActionItem(
            pItem,
            rootNodeId,
            nodeInfoMap,
            generateId,
            recorder,
            branchPath ? `${branchPath}/0` : null
          );
        }
        return;
      }

      // Legacy format: { action: "system_log.write", data: { message: "Node: <nodeId>" } }
      const action = (pItem.service ?? pItem.action) as string | undefined;
      if (action === 'system_log.write') {
        const data = pItem.data as Record<string, unknown> | undefined;
        const message = data?.message as string | undefined;
        if (message) {
          const nodeMatch = message.match(/^Node:\s*(.+)$/);
          if (nodeMatch) {
            const nodeId = nodeMatch[1];
            targetIds.push(nodeId);
            if (branchPath) recorder.record(nodeId, `${branchPath}/0`);
          }
        }
      }
    });

    return targetIds;
  }

  /**
   * Parse a list of inline HA actions, chaining them sequentially.
   * The first action uses firstNodeId; subsequent actions get generated IDs.
   */
  private parseInlineActionList(
    actions: Record<string, unknown>[],
    firstNodeId: string,
    nodeInfoMap: Map<string, StateMachineNodeInfo>,
    generateId: (type: string) => string,
    recorder: PathRecorder,
    pathPrefix: string | null
  ): void {
    let prevNodeId: string | null = null;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const { nodeId: embeddedId } = this.extractCafeNodeId(action.alias as string | undefined);
      const nodeId =
        i === 0 ? firstNodeId : (embeddedId ?? generateId(this.inferInlineNodeType(action)));

      // Chain previous non-condition node to this one
      if (prevNodeId) {
        const prevInfo = nodeInfoMap.get(prevNodeId);
        if (prevInfo && prevInfo.nodeType !== 'condition') {
          prevInfo.trueTarget = nodeId;
        }
      }

      this.parseInlineActionItem(
        action,
        nodeId,
        nodeInfoMap,
        generateId,
        recorder,
        pathPrefix ? `${pathPrefix}/${i}` : null
      );
      prevNodeId = nodeId;
    }
  }

  /**
   * Parse a single inline HA action item into a StateMachineNodeInfo entry.
   * Handles actions, conditions (if/then/else), delays, and waits.
   */
  private parseInlineActionItem(
    item: Record<string, unknown>,
    nodeId: string,
    nodeInfoMap: Map<string, StateMachineNodeInfo>,
    generateId: (type: string) => string,
    recorder: PathRecorder,
    pathPrefix: string | null
  ): void {
    // Strip parallel_branch: prefix from alias if present
    const rawAlias = item.alias as string | undefined;
    const { cleanAlias: cafeStripped } = this.extractCafeNodeId(rawAlias);
    const alias = cafeStripped?.startsWith('parallel_branch:') ? undefined : cafeStripped;

    if (pathPrefix) recorder.record(nodeId, pathPrefix);

    if (item.if && Array.isArray(item.if)) {
      // Condition node (if/then/else)
      const conditions = item.if as Record<string, unknown>[];
      const condition = conditions[0] ?? {};
      const data: Record<string, unknown> = { ...condition };
      if (alias) data.alias = alias;

      // The if action's own decision has no dedicated node; it maps to this
      // condition node, mirroring how a native if-action's `action/{i}` maps
      // to its own condition node too.
      if (pathPrefix) recorder.record(nodeId, `${pathPrefix}/if/condition/0`);

      let trueTarget: string | null = null;
      let falseTarget: string | null = null;

      const thenActions = item.then as Record<string, unknown>[] | undefined;
      if (thenActions && thenActions.length > 0) {
        const { nodeId: thenEmbeddedId } = this.extractCafeNodeId(
          thenActions[0].alias as string | undefined
        );
        const thenNodeId = thenEmbeddedId ?? generateId(this.inferInlineNodeType(thenActions[0]));
        trueTarget = thenNodeId;
        this.parseInlineActionList(
          thenActions,
          thenNodeId,
          nodeInfoMap,
          generateId,
          recorder,
          pathPrefix ? `${pathPrefix}/then` : null
        );
      }

      const elseActions = item.else as Record<string, unknown>[] | undefined;
      if (elseActions && elseActions.length > 0) {
        const { nodeId: elseEmbeddedId } = this.extractCafeNodeId(
          elseActions[0].alias as string | undefined
        );
        const elseNodeId = elseEmbeddedId ?? generateId(this.inferInlineNodeType(elseActions[0]));
        falseTarget = elseNodeId;
        this.parseInlineActionList(
          elseActions,
          elseNodeId,
          nodeInfoMap,
          generateId,
          recorder,
          pathPrefix ? `${pathPrefix}/else` : null
        );
      }

      nodeInfoMap.set(nodeId, { nodeId, nodeType: 'condition', data, trueTarget, falseTarget });
    } else if (item.service || item.action) {
      // Action node
      const data: Record<string, unknown> = {};
      data.service = (item.service ?? item.action) as string;
      if (item.target) data.target = item.target;
      if (item.data) data.data = item.data;
      if (alias) data.alias = alias;

      nodeInfoMap.set(nodeId, {
        nodeId,
        nodeType: 'action',
        data,
        trueTarget: null,
        falseTarget: null,
      });
    } else if (item.delay !== undefined) {
      // Delay node
      const data: Record<string, unknown> = { delay: item.delay };
      if (alias) data.alias = alias;

      nodeInfoMap.set(nodeId, {
        nodeId,
        nodeType: 'delay',
        data,
        trueTarget: null,
        falseTarget: null,
      });
    } else if (item.wait_template !== undefined || item.wait_for_trigger !== undefined) {
      // Wait node
      const data: Record<string, unknown> = {};
      if (item.wait_template) data.wait_template = item.wait_template;
      if (item.wait_for_trigger) data.wait_for_trigger = item.wait_for_trigger;
      if (item.timeout) data.timeout = item.timeout;
      if (item.continue_on_timeout !== undefined)
        data.continue_on_timeout = item.continue_on_timeout;
      if (alias) data.alias = alias;

      nodeInfoMap.set(nodeId, {
        nodeId,
        nodeType: 'wait',
        data,
        trueTarget: null,
        falseTarget: null,
      });
    }
  }

  /**
   * Extract a C.A.F.E. node ID encoded in an alias field.
   * Handles format: "cafe_node:<nodeId>" or "cafe_node:<nodeId>:<userAlias>"
   */
  private extractCafeNodeId(alias: string | undefined): {
    nodeId: string | null;
    cleanAlias: string | undefined;
  } {
    if (!alias) return { nodeId: null, cleanAlias: undefined };
    const match = alias.match(/^cafe_node:([^:]+)(?::(.+))?$/);
    if (match) {
      return { nodeId: match[1], cleanAlias: match[2] || undefined };
    }
    return { nodeId: null, cleanAlias: alias };
  }

  /**
   * Infer the node type from an inline HA action item.
   */
  private inferInlineNodeType(item: Record<string, unknown>): string {
    if (item.if) return 'condition';
    if (item.delay !== undefined) return 'delay';
    if (item.wait_template !== undefined || item.wait_for_trigger !== undefined) return 'wait';
    return 'action';
  }

  /**
   * Parse a single choose block from state-machine format
   */
  private parseStateMachineChooseBlock(
    chooseBlock: Record<string, unknown>
  ): StateMachineNodeInfo | null {
    const conditions = chooseBlock.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return null;
    }

    // Extract node ID from condition: {{ current_node == "node-id" }}
    const firstCondition = conditions[0] as Record<string, unknown>;
    const valueTemplate = firstCondition.value_template as string;
    if (!valueTemplate) return null;

    const match = valueTemplate.match(/current_node\s*==\s*["']([^"']+)["']/);
    if (!match) return null;

    const nodeId = match[1];
    const sequence = chooseBlock.sequence;
    if (!Array.isArray(sequence) || sequence.length === 0) {
      return null;
    }

    // Parse sequence to determine node type and data
    let nodeType: 'action' | 'condition' | 'delay' | 'wait' = 'action';
    const data: Record<string, unknown> = {};
    let trueTarget: string | null = null;
    let falseTarget: string | null = null;
    let parallelItems: unknown[] | undefined;
    let parallelItemsIndex: number | undefined;

    for (let seqIdx = 0; seqIdx < sequence.length; seqIdx++) {
      const item = sequence[seqIdx];
      const seqItem = item as Record<string, unknown>;

      // Check for variables action (sets next node / edge)
      if (seqItem.variables) {
        const vars = seqItem.variables as Record<string, unknown>;
        const currentNodeValue = vars.current_node;

        if (typeof currentNodeValue === 'string') {
          // Check if it's a Jinja conditional (condition node)
          if (currentNodeValue.includes('{%') && currentNodeValue.includes('%}')) {
            nodeType = 'condition';

            // Extract true and false targets
            const trueMatch = currentNodeValue.match(/{%\s*if[^%]*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);
            const falseMatch = currentNodeValue.match(/{%\s*else\s*%}\s*"?([^"'{%]+?)"?(?=\s*{%)/);

            trueTarget = trueMatch ? trueMatch[1] : null;
            falseTarget = falseMatch ? falseMatch[1] : null;

            // Extract condition expression from Jinja template
            const conditionMatch = currentNodeValue.match(/{%\s*if\s+(.+?)\s*%}/);
            if (conditionMatch) {
              const conditionExpr = conditionMatch[1];
              Object.assign(data, this.parseJinjaCondition(conditionExpr));
            }
          } else {
            // Simple transition
            trueTarget = currentNodeValue === 'END' ? null : currentNodeValue;
          }
        }
      }
      // Check for delay action
      else if (seqItem.delay !== undefined) {
        nodeType = 'delay';
        data.delay = seqItem.delay;
        if (seqItem.alias) data.alias = seqItem.alias;
      }
      // Check for wait action
      else if (seqItem.wait_template !== undefined) {
        nodeType = 'wait';
        data.wait_template = seqItem.wait_template;
        if (seqItem.timeout) data.timeout = seqItem.timeout;
        if (seqItem.continue_on_timeout !== undefined) {
          data.continue_on_timeout = seqItem.continue_on_timeout;
        }
        if (seqItem.alias) data.alias = seqItem.alias;
      }
      // Check for parallel block (synthetic __parallel_trigger_* entries)
      else if (Array.isArray(seqItem.parallel)) {
        parallelItems = seqItem.parallel;
        parallelItemsIndex = seqIdx;
      }
      // Check for service call action
      else if (seqItem.service || seqItem.action) {
        nodeType = 'action';
        data.service = seqItem.service || seqItem.action;
        if (seqItem.target) data.target = seqItem.target;
        if (seqItem.data) data.data = seqItem.data;
        if (seqItem.alias) data.alias = seqItem.alias;
      }
    }

    return { nodeId, nodeType, data, trueTarget, falseTarget, parallelItems, parallelItemsIndex };
  }

  /**
   * Parse Jinja condition expression to extract condition data
   */
  private parseJinjaCondition(expr: string): Record<string, unknown> {
    // is_state('entity', 'state')
    const isStateMatch = expr.match(/is_state\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (isStateMatch) {
      const entityId = isStateMatch[1];
      const state = isStateMatch[2];

      // Check for sun entity
      if (entityId === 'sun.sun') {
        if (state === 'above_horizon') {
          return { condition: 'sun', after: 'sunrise', before: 'sunset' };
        } else if (state === 'below_horizon') {
          return { condition: 'sun', after: 'sunset', before: 'sunrise' };
        }
      }

      return { condition: 'state', entity_id: entityId, state };
    }

    // states('entity') | float > number
    const numericMatch = expr.match(
      /states\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\|\s*float\s*([<>=]+)\s*(\d+(?:\.\d+)?)/
    );
    if (numericMatch) {
      const entityId = numericMatch[1];
      const operator = numericMatch[2];
      const value = parseFloat(numericMatch[3]);

      const result: Record<string, unknown> = {
        condition: 'numeric_state',
        entity_id: entityId,
      };
      if (operator.includes('>')) result.above = value;
      if (operator.includes('<')) result.below = value;
      return result;
    }

    // Fallback to template condition
    return { condition: 'template', value_template: `{{ ${expr} }}` };
  }

  /**
   * Parse automation structure into nodes and edges (native format)
   */
  private parseAutomationStructure(
    content: Record<string, unknown>,
    warnings: string[],
    metadataNodeIds: string[],
    recorder: PathRecorder
  ): { nodes: FlowNode[]; edges: FlowEdge[] } {
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const conditionNodeIds = new Set<string>();

    // Group metadata IDs by node type for type-aware assignment.
    // Without type-aware grouping, depth-first parsing of parallel branches
    // would assign IDs in the wrong order (e.g., an action gets a condition's ID).
    const knownNodeTypes = ['set_variables', 'trigger', 'condition', 'action', 'delay', 'wait'];
    const metadataIdsByType = new Map<string, string[]>();
    const usedMetadataIds = new Set<string>();
    for (const id of metadataNodeIds) {
      const matchedType = knownNodeTypes.find((t) => id.startsWith(`${t}_`));
      if (matchedType) {
        if (!metadataIdsByType.has(matchedType)) metadataIdsByType.set(matchedType, []);
        metadataIdsByType.get(matchedType)!.push(id);
      }
    }
    const metadataTypeIndexes = new Map<string, number>();
    let sequentialFallbackIndex = 0;
    let nodeIdCounter = metadataNodeIds.length;

    // Helper to get next node ID (from metadata if available, otherwise generate)
    const getNextNodeId = (type: string): string => {
      // First: try type-matched metadata ID
      const ids = metadataIdsByType.get(type);
      const idx = metadataTypeIndexes.get(type) ?? 0;
      if (ids && idx < ids.length) {
        const id = ids[idx];
        metadataTypeIndexes.set(type, idx + 1);
        usedMetadataIds.add(id);
        return id;
      }
      // Second: fallback to next unused metadata ID (handles non-standard ID formats)
      while (sequentialFallbackIndex < metadataNodeIds.length) {
        const id = metadataNodeIds[sequentialFallbackIndex++];
        if (!usedMetadataIds.has(id)) {
          usedMetadataIds.add(id);
          return id;
        }
      }
      // Third: generate a new ID
      return generateNodeId(type, nodeIdCounter++);
    };

    // Parse triggers (support both 'trigger' and 'triggers')
    const triggerData = content.triggers || content.trigger;
    if (!triggerData) {
      warnings.push('No triggers found in automation');
      return { nodes, edges };
    }
    const triggers = Array.isArray(triggerData) ? triggerData : [triggerData];
    const triggerNodes = this.parseTriggers(triggers, warnings, getNextNodeId, recorder);
    nodes.push(...triggerNodes);

    // Build a map from trigger node ID → trigger's `id` field (for trigger-id condition routing)
    const triggerNodeMap = new Map<string, string>();
    for (let i = 0; i < triggerNodes.length; i++) {
      const triggerId = (triggers[i] as Record<string, unknown>)?.id;
      if (typeof triggerId === 'string') {
        triggerNodeMap.set(triggerNodes[i].id, triggerId);
      }
    }

    // Parse conditions (if present at top level - support both 'condition' and 'conditions')
    let firstActionNodeIds: string[] = [];
    const conditionData = content.conditions || content.condition;
    // Normalize to array and check if non-empty
    const conditions = Array.isArray(conditionData)
      ? conditionData
      : conditionData
        ? [conditionData]
        : [];

    if (conditions.length > 0) {
      const conditionResults = this.parseConditions(conditions, warnings, getNextNodeId, recorder);
      nodes.push(...conditionResults.nodes);
      edges.push(...conditionResults.edges);

      // Track condition node IDs
      for (const condNode of conditionResults.nodes) {
        conditionNodeIds.add(condNode.id);
      }

      // Root-level conditions in Home Assistant are implicitly AND-ed together.
      // They should be chained sequentially: trigger → cond1 → cond2 → cond3 → actions
      // Each condition's TRUE path leads to the next condition (or to actions if last)
      const conditionNodes = conditionResults.nodes;

      if (conditionNodes.length === 1) {
        // Single condition - connect triggers to it
        for (const trigger of triggerNodes) {
          edges.push(this.createEdge(trigger.id, conditionNodes[0].id));
        }
        firstActionNodeIds = [conditionNodes[0].id];
      } else {
        // Multiple conditions - chain them sequentially
        // Connect triggers to first condition
        for (const trigger of triggerNodes) {
          edges.push(this.createEdge(trigger.id, conditionNodes[0].id));
        }

        // Chain conditions: each condition's TRUE path leads to next condition
        for (let i = 0; i < conditionNodes.length - 1; i++) {
          edges.push(this.createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
        }

        // The last condition's TRUE path leads to actions
        firstActionNodeIds = [conditionNodes[conditionNodes.length - 1].id];
      }
    } else {
      firstActionNodeIds = triggerNodes.map((t) => t.id);
    }

    // Parse actions (support both 'action' and 'actions')
    const actionData = content.actions || content.action;
    if (!actionData) {
      warnings.push('No actions found in automation');
      return { nodes, edges };
    }
    const actions = Array.isArray(actionData) ? actionData : [actionData];
    const actionResults = this.parseActions(actions, {
      warnings,
      previousNodeIds: firstActionNodeIds,
      getNextNodeId,
      conditionNodeIds,
      triggerNodeMap,
      recorder,
      pathPrefix: 'action',
    });
    nodes.push(...actionResults.nodes);
    edges.push(...actionResults.edges);

    return { nodes, edges };
  }

  /**
   * Parse trigger configurations
   */
  private parseTriggers(
    triggers: unknown[],
    warnings: string[],
    getNextNodeId: (type: string) => string,
    recorder: PathRecorder
  ): FlowNode[] {
    // Home Assistant trace paths (`trigger/{i}`) are indexed against the
    // original triggers array, not the object-filtered one below — precompute
    // the mapping so recorded paths still line up once non-object entries
    // (which never happen in practice, but are tolerated) are dropped.
    const originalIndices: number[] = [];
    triggers.forEach((t, i) => {
      if (typeof t === 'object' && t !== null) originalIndices.push(i);
    });

    // Process all object-type trigger items — do NOT filter with isHATrigger here,
    // because modern HA may use formats (e.g. dict-keyed or novel trigger types)
    // that don't have 'platform', 'trigger', or 'entity_id' at the top level.
    return triggers
      .filter((t) => typeof t === 'object' && t !== null)
      .map((trigger, index) => {
        const nodeId = getNextNodeId('trigger');
        const tracePath = `trigger/${originalIndices[index]}`;
        try {
          // Validate and parse trigger using HATriggerSchema
          const result = HATriggerSchema.safeParse(trigger);
          if (!result.success) {
            warnings.push(
              `Trigger ${index} failed schema validation: ${JSON.stringify(result.error.issues)}`
            );
            // Return a fallback TRIGGER node (not an action node) so the graph
            // always has at least one trigger — allowing the import to succeed.
            const fallbackNode = this.createFallbackTriggerNode(nodeId, trigger);
            recorder.record(fallbackNode.id, tracePath);
            return fallbackNode;
          }
          // Use platform directly from validated schema
          const node: TriggerNode = {
            id: nodeId,
            type: 'trigger',
            position: { x: 0, y: 0 },
            data: result.data,
          };
          recorder.record(node.id, tracePath);
          return node;
        } catch (error) {
          warnings.push(`Failed to parse trigger ${index}: ${error}`);
          const fallbackNode = this.createFallbackTriggerNode(nodeId, trigger);
          recorder.record(fallbackNode.id, tracePath);
          return fallbackNode;
        }
      });
  }

  /**
   * Build a best-effort trigger node when HATriggerSchema validation fails.
   * Always returns type:'trigger' so validateGraphStructure does not fail.
   */
  private createFallbackTriggerNode(nodeId: string, originalData: unknown): TriggerNode {
    const data: Record<string, unknown> =
      typeof originalData === 'object' && originalData !== null
        ? (originalData as Record<string, unknown>)
        : {};

    // Determine trigger type from various formats:
    // 1. Modern HA: { trigger: 'state', ... }
    // 2. Legacy HA: { platform: 'state', ... }
    // 3. Dict-keyed: { state: { entity_id: '...' } }
    let triggerType: string;
    let nestedFields: Record<string, unknown> = {};

    if (typeof data.trigger === 'string') {
      triggerType = data.trigger;
      const { platform: _p, trigger: _t, ...rest } = data;
      nestedFields = rest;
    } else if (typeof data.platform === 'string') {
      triggerType = data.platform;
      const { platform: _p, ...rest } = data;
      nestedFields = rest;
    } else {
      // Dict-keyed format: first key is the trigger type, value contains fields
      const firstKey = Object.keys(data).find(
        (k) => !['alias', 'id', 'enabled', 'variables'].includes(k)
      );
      if (firstKey && typeof data[firstKey] === 'object' && data[firstKey] !== null) {
        triggerType = firstKey;
        nestedFields = data[firstKey] as Record<string, unknown>;
      } else {
        triggerType = 'state';
      }
    }

    return {
      id: nodeId,
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: {
        trigger: triggerType,
        ...nestedFields,
      } as TriggerNode['data'],
    };
  }

  /**
   * Parse condition configurations
   */
  private parseConditions(
    conditions: unknown[],
    warnings: string[],
    getNextNodeId: (type: string) => string,
    recorder: PathRecorder
  ): { nodes: ConditionNode[]; edges: FlowEdge[]; outputNodeIds: string[] } {
    const nodes: ConditionNode[] = [];
    const edges: FlowEdge[] = [];
    const outputNodeIds: string[] = [];

    // Home Assistant trace paths (`condition/{i}`) are indexed against the
    // original conditions array, not the isHACondition-filtered one below.
    const originalIndices: number[] = [];
    conditions.forEach((c, i) => {
      if (isHACondition(c)) originalIndices.push(i);
    });

    conditions.filter(isHACondition).forEach((condition, index) => {
      const nodeId = getNextNodeId('condition');
      const tracePath = `condition/${originalIndices[index]}`;
      try {
        const result = HAConditionSchema.safeParse(condition);
        if (!result.success) {
          warnings.push(
            `Condition ${index} failed schema validation: ${JSON.stringify(result.error.issues)}`
          );
          nodes.push({
            id: nodeId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: {
              condition: 'template',
              alias: 'Unknown Condition',
              value_template: JSON.stringify(condition),
            },
          });
          recorder.record(nodeId, tracePath);
          return;
        }

        const node: ConditionNode = {
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: result.data,
        };
        nodes.push(node);
        outputNodeIds.push(nodeId);
        recorder.record(nodeId, tracePath);
      } catch (error) {
        warnings.push(`Failed to parse condition ${index}: ${error}`);
        // Create a minimal valid unknown condition node
        nodes.push({
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            condition: 'template',
            alias: 'Unknown Condition',
            value_template: JSON.stringify(condition),
          },
        });
        recorder.record(nodeId, tracePath);
      }
    });
    return { nodes, edges, outputNodeIds };
  }

  /**
   * Parse action sequences (including choose blocks, delays, etc.)
   */
  private parseActions(
    actions: (HAAction | HACondition)[],
    options: ParseOptions
  ): { nodes: FlowNode[]; edges: FlowEdge[]; terminalNodeIds: string[] } {
    const {
      warnings,
      previousNodeIds,
      getNextNodeId,
      conditionNodeIds = new Set(),
      triggerNodeMap,
      inheritedEnabled,
      recorder,
      pathPrefix,
    } = options;

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    let currentNodeIds = previousNodeIds;
    // Create a mutable copy so we can track condition nodes created during parsing
    const localConditionNodeIds = new Set(conditionNodeIds);
    // Track condition nodes whose FALSE path should connect to next action.
    // Seeded from the caller: nested parses (repeat bodies, parallel branches)
    // must know that an upstream if/choose condition continues via its FALSE
    // handle, or they emit handle-less condition edges that fail validation.
    const falsePathConditionIds = new Set<string>(options.falsePathConditionIds);

    // Helper to compute the enabled state for a node
    const getNodeEnabled = (nodeEnabled: boolean | undefined): boolean | undefined => {
      // If parent is disabled, child is always disabled
      if (inheritedEnabled === false) return false;
      // Otherwise use the node's own enabled state
      return nodeEnabled;
    };

    // Helper to create edges from current nodes to a target
    const createEdgesFromCurrent = (targetId: string): void => {
      for (const prevId of currentNodeIds) {
        let sourceHandle: string | undefined;
        if (falsePathConditionIds.has(prevId)) {
          // This condition's FALSE path should connect to next action
          sourceHandle = 'false';
        } else if (localConditionNodeIds.has(prevId)) {
          // This condition's TRUE path should connect to next action
          sourceHandle = 'true';
        }
        edges.push(this.createEdge(prevId, targetId, sourceHandle));
      }
    };

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: large dispatch switch, refactoring deferred
    actions.forEach((action, index) => {
      const actionPath = `${pathPrefix}/${index}`;

      if (!action || typeof action !== 'object') {
        // Unknown action type - create unknown node
        warnings.push(`Unknown action type (${JSON.stringify(action)}) at index ${index}`);
        const nodeId = getNextNodeId('unknown');
        nodes.push({
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: 'Unknown Node',
            service: 'unknown.unknown',
            data: action as Record<string, unknown>,
          },
        });
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
        return;
      }

      // Handle different action types
      if (isConditionAction(action)) {
        // Inline condition guard in action sequence
        const nodeId = getNextNodeId('condition');
        const act = action as Record<string, unknown>;
        const conditionType = (act.condition as string) || 'template';
        const validatedType = VALID_CONDITIONS.includes(conditionType as ValidConditionType)
          ? (conditionType as ValidConditionType)
          : 'template';

        // Use Zod schema for parsing and type safety
        let parsedData: ConditionNode['data'];
        try {
          parsedData = HAConditionSchema.parse(act);
        } catch (e) {
          warnings.push(
            `Inline condition at index ${index} failed schema validation: ${e instanceof Error ? e.message : JSON.stringify(e)}`
          );
          parsedData = {
            condition: validatedType,
            alias: typeof act.alias === 'string' ? act.alias : undefined,
            value_template: JSON.stringify(act),
          };
        }
        // Apply inherited enabled state
        parsedData.enabled = getNodeEnabled(parsedData.enabled);
        const conditionNode: ConditionNode = {
          id: nodeId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: parsedData,
        };

        nodes.push(conditionNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        // Track this condition node so subsequent edges use 'true' handle
        localConditionNodeIds.add(nodeId);
        currentNodeIds = [nodeId];
      } else if (isVariablesAction(action)) {
        // Variables block - create set_variables node
        const nodeId = getNextNodeId('set_variables');
        const act = action as Record<string, unknown>;
        const setVariablesNode: SetVariablesNode = {
          id: nodeId,
          type: 'set_variables',
          position: { x: 0, y: 0 },
          data: {
            alias: typeof act.alias === 'string' ? act.alias : undefined,
            variables: (act.variables as Record<string, unknown>) || {},
            enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
          },
        };
        nodes.push(setVariablesNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (isDelayAction(action)) {
        const nodeId = getNextNodeId('delay');
        const act = action as Record<string, unknown>;
        // Use spread pattern to preserve unknown properties from custom integrations
        const { alias, delay: delayValue, enabled, ...extraProps } = act;
        const delayNode: DelayNode = {
          id: nodeId,
          type: 'delay',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // Preserve extra properties
            alias: typeof alias === 'string' ? alias : undefined,
            delay: normalizeDelayValue(delayValue),
            enabled: getNodeEnabled(typeof enabled === 'boolean' ? enabled : undefined),
          },
        };
        nodes.push(delayNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (isWaitAction(action)) {
        const nodeId = getNextNodeId('wait');
        const act = action as Record<string, unknown>;
        // Use spread pattern to preserve unknown properties from custom integrations
        const {
          alias,
          wait_template: waitTemplate,
          wait_for_trigger: waitForTrigger,
          timeout: timeoutValue,
          continue_on_timeout: continueOnTimeoutValue,
          enabled,
          ...extraProps
        } = act;

        // Handle timeout as either string or object format
        let timeout: WaitNode['data']['timeout'];
        if (typeof timeoutValue === 'string') {
          timeout = timeoutValue;
        } else if (typeof timeoutValue === 'object' && timeoutValue !== null) {
          timeout = timeoutValue as {
            hours?: number;
            minutes?: number;
            seconds?: number;
            milliseconds?: number;
          };
        }

        const waitData: WaitNode['data'] = {
          ...extraProps, // Preserve extra properties
          alias: typeof alias === 'string' ? alias : undefined,
          timeout,
          continue_on_timeout:
            typeof continueOnTimeoutValue === 'boolean' ? continueOnTimeoutValue : undefined,
          enabled: getNodeEnabled(typeof enabled === 'boolean' ? enabled : undefined),
        };

        if (typeof waitTemplate === 'string') {
          waitData.wait_template = waitTemplate;
        } else if (Array.isArray(waitForTrigger)) {
          const parsedTriggers = [];
          for (const trigger of waitForTrigger) {
            const result = HATriggerSchema.safeParse(trigger);
            if (result.success) {
              parsedTriggers.push(result.data);
            } else {
              warnings.push(
                `Failed to parse a trigger inside wait_for_trigger: ${result.error.message}`
              );
            }
          }
          waitData.wait_for_trigger = parsedTriggers;
        }

        const waitNode: WaitNode = {
          id: nodeId,
          type: 'wait',
          position: { x: 0, y: 0 },
          data: waitData,
        };

        nodes.push(waitNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (isChooseAction(action)) {
        // Handle condition branching (choose blocks)
        const chooseResult = this.parseChooseBlock(action as Record<string, unknown>, {
          warnings,
          previousNodeIds: currentNodeIds,
          getNextNodeId,
          conditionNodeIds: localConditionNodeIds,
          falsePathConditionIds,
          inheritedEnabled,
          recorder,
          pathPrefix: actionPath,
        });
        nodes.push(...chooseResult.nodes);
        edges.push(...chooseResult.edges);
        // Add any new condition nodes to our tracking set
        // But NOT condition nodes that are outputs via FALSE path (no default choose)
        for (const outId of chooseResult.outputNodeIds) {
          const outNode = chooseResult.nodes.find((n) => n.id === outId);
          if (outNode?.type === 'condition') {
            if (chooseResult.falsePathOutputIds.includes(outId)) {
              // This condition's FALSE path should connect to subsequent actions
              falsePathConditionIds.add(outId);
            } else {
              // This condition's TRUE path should connect to subsequent actions
              localConditionNodeIds.add(outId);
            }
          }
        }
        currentNodeIds = chooseResult.outputNodeIds;
      } else if (isIfThenAction(action)) {
        // Handle if/then/else blocks
        const act = action as Record<string, unknown>;
        const ifArr = Array.isArray(act.if) ? act.if : [];
        const thenArr = Array.isArray(act.then) ? act.then : [];
        const elseArr = Array.isArray(act.else) ? act.else : undefined;
        const ifAction = {
          if: ifArr,
          then: thenArr,
          else: elseArr,
          alias: typeof act.alias === 'string' ? act.alias : undefined,
          note: typeof act.note === 'string' ? act.note : undefined,
          enabled: act.enabled,
        };
        const ifResult = this.parseIfBlock(ifAction, {
          warnings,
          previousNodeIds: currentNodeIds,
          getNextNodeId,
          conditionNodeIds: localConditionNodeIds,
          falsePathConditionIds,
          triggerNodeMap,
          inheritedEnabled,
          recorder,
          pathPrefix: actionPath,
        });
        nodes.push(...ifResult.nodes);
        edges.push(...ifResult.edges);
        // Route condition outputs to the correct handle tracking set
        for (const outId of ifResult.outputNodeIds) {
          const outNode = ifResult.nodes.find((n) => n.id === outId);
          if (outNode?.type === 'condition') {
            if (ifResult.falsePathOutputIds.includes(outId)) {
              // This condition's FALSE path should connect to subsequent actions
              falsePathConditionIds.add(outId);
            } else {
              // This condition's TRUE path should connect to subsequent actions
              localConditionNodeIds.add(outId);
            }
          }
        }
        // For trigger-id routing: merge unconsumed trigger nodes (those that didn't match
        // this if block's trigger id) back into currentNodeIds so they are available
        // as entry points for the next if block.
        if (ifResult.unconsumedPreviousIds.length > 0) {
          currentNodeIds = ifResult.unconsumedPreviousIds;
        } else {
          currentNodeIds = ifResult.outputNodeIds;
        }
      } else if (isDeviceAction(action)) {
        // Device action (type + device_id + domain)
        const nodeId = getNextNodeId('action');
        const act = action as Record<string, unknown>;

        // Extract known metadata fields vs additional parameters
        const knownFields = [
          'type',
          'device_id',
          'domain',
          'entity_id',
          'subtype',
          'alias',
          'enabled',
        ];
        const additionalParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(act)) {
          if (!knownFields.includes(key) && value !== undefined) {
            additionalParams[key] = value;
          }
        }

        // Convert device action to service-like format for the action node
        const actionNode: ActionNode = {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: typeof act.alias === 'string' ? act.alias : undefined,
            // Store the device action fields directly
            service: `${act.domain}.${act.type}`,
            target: {
              device_id: act.device_id as string,
            },
            // Preserve original device action metadata and additional params (like 'option')
            data: {
              type: act.type,
              device_id: act.device_id,
              domain: act.domain,
              entity_id: act.entity_id,
              subtype: act.subtype,
              ...additionalParams,
            } as Record<string, unknown>,
            enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
          },
        };
        nodes.push(actionNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (isParallelAction(action)) {
        // Parallel block - all branches start from the same source nodes
        const act = action as Record<string, unknown>;
        const parallelActions = act.parallel as unknown[];

        // Store the starting nodes - all parallel branches connect FROM these
        const parallelStartNodes = [...currentNodeIds];
        // Collect the end nodes from all branches
        const allBranchEndNodes: string[] = [];
        // HA indexes parallel branches by their position in the `parallel:`
        // array regardless of shape, so track it alongside the existing loop.
        let parallelBranchIndex = 0;

        // Parse each parallel branch - each starts from the same source
        for (const parallelItem of parallelActions) {
          // HA wraps every parallel branch in a sequence, even a single action.
          const branchPathPrefix = `${actionPath}/parallel/${parallelBranchIndex}/sequence`;
          parallelBranchIndex++;

          if (Array.isArray(parallelItem)) {
            // It's a sequence array
            const seqResult = this.parseActions(parallelItem as Record<string, unknown>[], {
              warnings,
              previousNodeIds: parallelStartNodes,
              getNextNodeId,
              conditionNodeIds: localConditionNodeIds,
              falsePathConditionIds,
              inheritedEnabled,
              recorder,
              pathPrefix: branchPathPrefix,
            });
            if (seqResult.nodes.length > 0) {
              nodes.push(...seqResult.nodes);
              edges.push(...seqResult.edges);
              // Find the last nodes of this branch
              const nodesWithOutgoing = new Set(seqResult.edges.map((e) => e.source));
              const lastNodes = seqResult.nodes.filter((n) => !nodesWithOutgoing.has(n.id));
              allBranchEndNodes.push(...lastNodes.map((n) => n.id));
            }
          } else if (typeof parallelItem === 'object' && parallelItem !== null) {
            const item = parallelItem as Record<string, unknown>;
            if ('sequence' in item && Array.isArray(item.sequence)) {
              // Nested sequence in parallel
              const seqResult = this.parseActions(item.sequence as Record<string, unknown>[], {
                warnings,
                previousNodeIds: parallelStartNodes,
                getNextNodeId,
                conditionNodeIds: localConditionNodeIds,
                falsePathConditionIds,
                inheritedEnabled,
                recorder,
                pathPrefix: branchPathPrefix,
              });
              if (seqResult.nodes.length > 0) {
                nodes.push(...seqResult.nodes);
                edges.push(...seqResult.edges);
                const nodesWithOutgoing = new Set(seqResult.edges.map((e) => e.source));
                const lastNodes = seqResult.nodes.filter((n) => !nodesWithOutgoing.has(n.id));
                allBranchEndNodes.push(...lastNodes.map((n) => n.id));
              }
            } else {
              // Single action in parallel - parse it as a single-item array
              const singleResult = this.parseActions([parallelItem] as Record<string, unknown>[], {
                warnings,
                previousNodeIds: parallelStartNodes,
                getNextNodeId,
                conditionNodeIds: localConditionNodeIds,
                falsePathConditionIds,
                inheritedEnabled,
                recorder,
                pathPrefix: branchPathPrefix,
              });
              if (singleResult.nodes.length > 0) {
                nodes.push(...singleResult.nodes);
                edges.push(...singleResult.edges);
                // For a single action, the last node is just the last one parsed
                const lastNode = singleResult.nodes[singleResult.nodes.length - 1];
                allBranchEndNodes.push(lastNode.id);
              }
            }
          }
        }

        // After parallel block, all branch end nodes become the current nodes
        // (subsequent actions will connect from all of them)
        currentNodeIds = allBranchEndNodes.length > 0 ? allBranchEndNodes : parallelStartNodes;
      } else if (isEventAction(action)) {
        // Event action - fires a Home Assistant event
        const nodeId = getNextNodeId('action');
        const act = action as Record<string, unknown>;
        const actionNode: ActionNode = {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: typeof act.alias === 'string' ? act.alias : undefined,
            event: typeof act.event === 'string' ? act.event : undefined,
            event_data:
              typeof act.event_data === 'object' && act.event_data !== null
                ? (act.event_data as Record<string, unknown>)
                : undefined,
            enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
          },
        };
        nodes.push(actionNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (isRepeatAction(action)) {
        // Repeat block - explode into individual nodes with loop-back edges
        const act = action as Record<string, unknown>;
        const repeat = act.repeat as Record<string, unknown>;
        const repeatSequence = Array.isArray(repeat.sequence) ? repeat.sequence : [];
        const blockAlias = typeof act.alias === 'string' ? act.alias : undefined;
        const blockNote = typeof act.note === 'string' ? act.note : undefined;
        const blockEnabled = getNodeEnabled(
          typeof act.enabled === 'boolean' ? act.enabled : undefined
        );

        if (Array.isArray(repeat.while) && repeat.while.length > 0) {
          // ── repeat.while ──
          // condition_node →(true)→ body... →(back-edge)→ condition_node
          // condition_node →(false)→ [continues]
          const whileConditions = repeat.while as HACondition[];

          // Create condition nodes (chain them like if-block conditions)
          const conditionNodes: ConditionNode[] = [];
          for (let ci = 0; ci < whileConditions.length; ci++) {
            const condId = getNextNodeId('condition');
            let parsedData: ConditionNode['data'];
            try {
              parsedData = HAConditionSchema.parse(whileConditions[ci]);
            } catch {
              parsedData = {
                condition: 'template',
                value_template: JSON.stringify(whileConditions[ci]),
              };
            }
            if (typeof parsedData.alias === 'string') {
              // Capture the condition's own alias before any block-alias
              // override below overwrites the display alias.
              parsedData.conditionAlias = parsedData.alias;
            }
            if (ci === 0 && blockAlias) {
              parsedData.alias = blockAlias;
              parsedData.blockAlias = blockAlias;
            }
            if (ci === 0 && blockNote) {
              parsedData.blockNote = blockNote;
            }
            parsedData.enabled = blockEnabled;
            const condNode: ConditionNode = {
              id: condId,
              type: 'condition',
              position: { x: 0, y: 0 },
              data: parsedData,
            };
            conditionNodes.push(condNode);
            nodes.push(condNode);
            localConditionNodeIds.add(condId);
            recorder.record(condId, `${actionPath}/repeat/while/${ci}`);
          }
          // The repeat action's own step has no dedicated node; it maps to
          // the loop's entry point — for `while`, the test runs first.
          recorder.record(conditionNodes[0].id, actionPath);

          // Connect previous nodes → first condition
          createEdgesFromCurrent(conditionNodes[0].id);

          // Chain condition nodes together with 'true' edges
          for (let ci = 0; ci < conditionNodes.length - 1; ci++) {
            edges.push(this.createEdge(conditionNodes[ci].id, conditionNodes[ci + 1].id, 'true'));
          }

          const lastCondId = conditionNodes[conditionNodes.length - 1].id;

          // Parse body sequence from last condition's TRUE path
          const bodyResult = this.parseActions(repeatSequence as (HAAction | HACondition)[], {
            warnings,
            previousNodeIds: [lastCondId],
            getNextNodeId,
            conditionNodeIds: localConditionNodeIds,
            falsePathConditionIds,
            inheritedEnabled: blockEnabled,
            recorder,
            pathPrefix: `${actionPath}/repeat/sequence`,
          });
          nodes.push(...bodyResult.nodes);
          edges.push(...bodyResult.edges);

          // Fix the first edge from last condition to body to use 'true' handle
          if (bodyResult.nodes.length > 0) {
            const firstBodyId = bodyResult.nodes[0].id;
            const trueEdge = edges.find((e) => e.source === lastCondId && e.target === firstBodyId);
            if (trueEdge) {
              trueEdge.sourceHandle = 'true';
            }
          }

          // Find the last node in the body sequence
          const bodyNodeIds = new Set(bodyResult.nodes.map((n) => n.id));
          const bodySourceIds = new Set(bodyResult.edges.map((e) => e.source));
          const bodyLastNodes = bodyResult.nodes.filter(
            (n) =>
              !bodySourceIds.has(n.id) ||
              ![...bodyResult.edges].some((e) => e.source === n.id && bodyNodeIds.has(e.target))
          );
          const lastBodyNodeId =
            bodyLastNodes.length > 0
              ? bodyLastNodes[bodyLastNodes.length - 1].id
              : bodyResult.nodes.length > 0
                ? bodyResult.nodes[bodyResult.nodes.length - 1].id
                : lastCondId;

          // Create back-edge from last body node → first condition
          if (bodyResult.nodes.length > 0) {
            const backEdge = this.createEdge(lastBodyNodeId, conditionNodes[0].id);
            edges.push(backEdge);
          }

          // Output continues from first condition's FALSE path
          currentNodeIds = [conditionNodes[0].id];
          falsePathConditionIds.add(conditionNodes[0].id);
        } else if (
          (Array.isArray(repeat.until) && repeat.until.length > 0) ||
          typeof repeat.until === 'string'
        ) {
          // ── repeat.until ──
          // body... → condition_node →(true)→ [continues]
          // condition_node →(false, back-edge)→ first body node

          // Parse body sequence first
          const bodyResult = this.parseActions(repeatSequence as (HAAction | HACondition)[], {
            warnings,
            previousNodeIds: currentNodeIds,
            getNextNodeId,
            conditionNodeIds: localConditionNodeIds,
            falsePathConditionIds,
            inheritedEnabled: blockEnabled,
            recorder,
            pathPrefix: `${actionPath}/repeat/sequence`,
          });
          nodes.push(...bodyResult.nodes);
          edges.push(...bodyResult.edges);

          // Find the first body node
          const firstBodyNodeId = bodyResult.nodes.length > 0 ? bodyResult.nodes[0].id : null;

          // Find the last body node
          const bodyNodeIds = new Set(bodyResult.nodes.map((n) => n.id));
          const bodySourceIds = new Set(
            bodyResult.edges.filter((e) => bodyNodeIds.has(e.target)).map((e) => e.source)
          );
          const bodyLastNodes = bodyResult.nodes.filter(
            (n) =>
              !bodySourceIds.has(n.id) ||
              !bodyResult.edges.some((e) => e.source === n.id && bodyNodeIds.has(e.target))
          );
          const lastBodyNodeId =
            bodyLastNodes.length > 0
              ? bodyLastNodes[bodyLastNodes.length - 1].id
              : bodyResult.nodes.length > 0
                ? bodyResult.nodes[bodyResult.nodes.length - 1].id
                : null;

          // Create condition nodes from until conditions
          const untilConditions: HACondition[] =
            typeof repeat.until === 'string'
              ? [{ condition: 'template', value_template: repeat.until }]
              : (repeat.until as HACondition[]);

          const conditionNodes: ConditionNode[] = [];
          for (let ci = 0; ci < untilConditions.length; ci++) {
            const condId = getNextNodeId('condition');
            let parsedData: ConditionNode['data'];
            try {
              parsedData = HAConditionSchema.parse(untilConditions[ci]);
            } catch {
              parsedData = {
                condition: 'template',
                value_template: JSON.stringify(untilConditions[ci]),
              };
            }
            if (typeof parsedData.alias === 'string') {
              // Capture the condition's own alias before any block-alias
              // override below overwrites the display alias.
              parsedData.conditionAlias = parsedData.alias;
            }
            if (ci === 0 && blockAlias && bodyResult.nodes.length === 0) {
              parsedData.alias = blockAlias;
            }
            // Unlike the display alias above (only shown on the first
            // condition when the loop body is empty, so a non-empty body's
            // true canvas entry point keeps its own alias instead), the
            // block's own prose is captured here unconditionally: the
            // generator reads `blockAlias`/`blockNote` directly off this
            // node regardless of body length, so it is never dropped.
            if (ci === 0 && blockAlias) {
              parsedData.blockAlias = blockAlias;
            }
            if (ci === 0 && blockNote) {
              parsedData.blockNote = blockNote;
            }
            parsedData.enabled = blockEnabled;
            const condNode: ConditionNode = {
              id: condId,
              type: 'condition',
              position: { x: 0, y: 0 },
              data: parsedData,
            };
            conditionNodes.push(condNode);
            nodes.push(condNode);
            localConditionNodeIds.add(condId);
            recorder.record(condId, `${actionPath}/repeat/until/${ci}`);
          }
          // The repeat action's own step has no dedicated node; it maps to
          // the loop's entry point — for `until`, the body runs before the
          // first test, so the entry is the first body node (or the first
          // condition when the body is empty).
          recorder.record(firstBodyNodeId ?? conditionNodes[0].id, actionPath);

          // Connect last body node → first condition
          if (lastBodyNodeId) {
            const lastBodyNode = bodyResult.nodes.find((n) => n.id === lastBodyNodeId);
            const sourceHandle =
              lastBodyNode && localConditionNodeIds.has(lastBodyNodeId) ? 'true' : undefined;
            edges.push(this.createEdge(lastBodyNodeId, conditionNodes[0].id, sourceHandle));
          } else {
            // Empty body - connect previous nodes directly to condition
            createEdgesFromCurrent(conditionNodes[0].id);
          }

          // Chain condition nodes together with 'true' edges
          for (let ci = 0; ci < conditionNodes.length - 1; ci++) {
            edges.push(this.createEdge(conditionNodes[ci].id, conditionNodes[ci + 1].id, 'true'));
          }

          const lastCondId = conditionNodes[conditionNodes.length - 1].id;

          // Create back-edges: EVERY until condition loops back on its FALSE
          // path (until = AND of conditions; any failure repeats the body).
          // Emitting all of them keeps the canvas semantics honest and gives
          // the native strategy an unambiguous loop boundary — conditions
          // *without* a false back-edge are past the loop, not part of it.
          if (firstBodyNodeId) {
            for (const cn of conditionNodes) {
              edges.push(this.createEdge(cn.id, firstBodyNodeId, 'false'));
            }
          }

          // Output continues from last condition's TRUE path
          currentNodeIds = [lastCondId];
        } else if (repeat.count !== undefined) {
          // ── repeat.count ──
          // set_vars(counter=0) → body... → set_vars(counter+1) → condition(counter < N)
          //                        ↑                                     │(true)    │(false)
          //                        └──── back-edge (repeatType=count) ──┘           → [continues]
          const countValue = repeat.count;
          const counterId = getNextNodeId('set_variables');
          const counterVarName = `_repeat_counter_${counterId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

          // Create init set_variables node: counter = 0
          const initNode: SetVariablesNode = {
            id: counterId,
            type: 'set_variables',
            position: { x: 0, y: 0 },
            data: {
              alias: blockAlias,
              note: blockNote,
              variables: { [counterVarName]: 0 },
              enabled: blockEnabled,
            },
          };
          nodes.push(initNode);
          // The repeat action's own step has no dedicated node; for `count`,
          // the counter-init node runs first, so it's the loop's entry point.
          recorder.record(counterId, actionPath);
          createEdgesFromCurrent(counterId);

          // Parse body sequence
          const bodyResult = this.parseActions(repeatSequence as (HAAction | HACondition)[], {
            warnings,
            previousNodeIds: [counterId],
            getNextNodeId,
            conditionNodeIds: localConditionNodeIds,
            falsePathConditionIds,
            inheritedEnabled: blockEnabled,
            recorder,
            pathPrefix: `${actionPath}/repeat/sequence`,
          });
          nodes.push(...bodyResult.nodes);
          edges.push(...bodyResult.edges);

          // Find last body node
          const bodyNodeIds = new Set(bodyResult.nodes.map((n) => n.id));
          const bodySourceIds = new Set(
            bodyResult.edges.filter((e) => bodyNodeIds.has(e.target)).map((e) => e.source)
          );
          const bodyLastNodes = bodyResult.nodes.filter(
            (n) =>
              !bodySourceIds.has(n.id) ||
              !bodyResult.edges.some((e) => e.source === n.id && bodyNodeIds.has(e.target))
          );
          const lastBodyNodeId =
            bodyLastNodes.length > 0
              ? bodyLastNodes[bodyLastNodes.length - 1].id
              : bodyResult.nodes.length > 0
                ? bodyResult.nodes[bodyResult.nodes.length - 1].id
                : counterId;

          // Create increment set_variables node: counter = counter + 1
          const incrId = getNextNodeId('set_variables');
          const incrNode: SetVariablesNode = {
            id: incrId,
            type: 'set_variables',
            position: { x: 0, y: 0 },
            data: {
              variables: { [counterVarName]: `{{ ${counterVarName} + 1 }}` },
              enabled: blockEnabled,
            },
          };
          nodes.push(incrNode);
          if (bodyResult.nodes.length > 0) {
            const lastBodyNode = bodyResult.nodes.find((n) => n.id === lastBodyNodeId);
            const sourceHandle =
              lastBodyNode && localConditionNodeIds.has(lastBodyNodeId) ? 'true' : undefined;
            edges.push(this.createEdge(lastBodyNodeId, incrId, sourceHandle));
          } else {
            edges.push(this.createEdge(counterId, incrId));
          }

          // Create condition node: counter < N
          const condId = getNextNodeId('condition');
          const condNode: ConditionNode = {
            id: condId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: {
              condition: 'template',
              value_template: `{{ ${counterVarName} < ${countValue} }}`,
              enabled: blockEnabled,
            },
          };
          nodes.push(condNode);
          localConditionNodeIds.add(condId);
          edges.push(this.createEdge(incrId, condId));

          // Back-edge: condition →(true)→ first body node (or init if no body)
          const loopTargetId = bodyResult.nodes.length > 0 ? bodyResult.nodes[0].id : incrId;
          const backEdge = this.createEdge(condId, loopTargetId, 'true');
          edges.push(backEdge);

          // Output continues from condition's FALSE path
          currentNodeIds = [condId];
          falsePathConditionIds.add(condId);
        } else if (Array.isArray(repeat.for_each)) {
          // ── repeat.for_each ──
          // Represented as a single opaque action node (not exploded into a
          // loop-back subgraph like while/until/count): the per-iteration
          // item binding (`repeat.item`/`repeat.index`) doesn't map onto a
          // static CFG the way a boolean loop condition does, and the design
          // spec calls for a dedicated items list editor + YAML foldout for
          // the nested `sequence`, not a fully exploded canvas subgraph.
          // `sequence` stays intact and opaque, same shape as the existing
          // "unknown repeat type" fallback just below — but recorded under
          // its own trace path instead of falling through to that generic,
          // warning-free bucket.
          const nodeId = getNextNodeId('action');
          const actionNode: ActionNode = {
            id: nodeId,
            type: 'action',
            position: { x: 0, y: 0 },
            data: {
              alias: blockAlias,
              note: blockNote,
              repeat: repeat as ActionNode['data']['repeat'],
              enabled: blockEnabled,
            },
          };
          nodes.push(actionNode);
          recorder.record(nodeId, actionPath);
          createEdgesFromCurrent(nodeId);
          currentNodeIds = [nodeId];
        } else {
          // Unknown repeat type - create opaque action node as fallback
          const nodeId = getNextNodeId('action');
          const actionNode: ActionNode = {
            id: nodeId,
            type: 'action',
            position: { x: 0, y: 0 },
            data: {
              alias: blockAlias,
              note: blockNote,
              repeat: repeat as ActionNode['data']['repeat'],
              enabled: blockEnabled,
            },
          };
          nodes.push(actionNode);
          recorder.record(nodeId, actionPath);
          createEdgesFromCurrent(nodeId);
          currentNodeIds = [nodeId];
        }
      } else if (isServiceAction(action)) {
        // Regular service call action (support both 'service' and 'action' fields)
        const nodeId = getNextNodeId('action');
        try {
          const act = action as Record<string, unknown>;
          // Use spread pattern to preserve unknown properties from custom integrations
          const {
            alias,
            service,
            action: actionField,
            target,
            data,
            data_template,
            response_variable,
            continue_on_error,
            enabled,
            ...extraProps
          } = act;
          const actionNode: ActionNode = {
            id: nodeId,
            type: 'action',
            position: { x: 0, y: 0 },
            data: {
              ...extraProps, // Preserve extra properties
              alias: typeof alias === 'string' ? alias : undefined,
              service:
                typeof service === 'string'
                  ? service
                  : typeof actionField === 'string'
                    ? actionField
                    : undefined,
              target:
                typeof target === 'object' && target !== null
                  ? (target as {
                      entity_id?: string | string[];
                      area_id?: string | string[];
                      device_id?: string | string[];
                    })
                  : undefined,
              data:
                typeof data === 'object' && data !== null
                  ? (data as Record<string, unknown>)
                  : undefined,
              data_template:
                typeof data_template === 'object' && data_template !== null
                  ? (data_template as Record<string, string>)
                  : undefined,
              response_variable:
                typeof response_variable === 'string' ? response_variable : undefined,
              continue_on_error:
                typeof continue_on_error === 'boolean' ? continue_on_error : undefined,
              enabled: getNodeEnabled(typeof enabled === 'boolean' ? enabled : undefined),
            },
          };
          nodes.push(actionNode);
          recorder.record(nodeId, actionPath);
          createEdgesFromCurrent(nodeId);
          currentNodeIds = [nodeId];
        } catch (error) {
          warnings.push(`Failed to parse action ${index}: ${error}`);
          nodes.push(this.createUnknownNode(nodeId, action));
          recorder.record(nodeId, actionPath);
        }
      } else if (isSetConversationResponseAction(action)) {
        // set_conversation_response action - convert to service call format
        const nodeId = getNextNodeId('action');
        const act = action as Record<string, unknown>;
        const actionNode: ActionNode = {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: typeof act.alias === 'string' ? act.alias : undefined,
            // Store the response as a special action
            set_conversation_response:
              typeof act.set_conversation_response === 'string'
                ? act.set_conversation_response
                : undefined,
            enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
          },
        };
        nodes.push(actionNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else if (isStopAction(action)) {
        // Stop action - halts automation execution
        const nodeId = getNextNodeId('action');
        const act = action as Record<string, unknown>;
        const actionNode: ActionNode = {
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: typeof act.alias === 'string' ? act.alias : undefined,
            stop: typeof act.stop === 'string' ? act.stop : '',
            ...(act.error === true ? { error: true } : {}),
            note: typeof act.note === 'string' ? act.note : undefined,
            enabled: getNodeEnabled(typeof act.enabled === 'boolean' ? act.enabled : undefined),
          },
        };
        nodes.push(actionNode);
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      } else {
        // Unknown action type - create unknown node
        warnings.push(`Unknown action type (${JSON.stringify(action)}) at index ${index}`);
        const nodeId = getNextNodeId('unknown');
        nodes.push({
          id: nodeId,
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            alias: 'Unknown Node',
            service: 'unknown.unknown',
            data: action as Record<string, unknown>,
          },
        });
        recorder.record(nodeId, actionPath);
        createEdgesFromCurrent(nodeId);
        currentNodeIds = [nodeId];
      }
    });

    return { nodes, edges, terminalNodeIds: currentNodeIds };
  }

  /**
   * Parse choose block (condition branching in actions)
   *
   * Home Assistant `choose` semantics:
   * - Evaluate conditions in order
   * - Execute ONLY the first matching branch's sequence
   * - If no conditions match, execute the default (if present)
   *
   * This creates a chain: condition1 → (true: seq1) → (false: condition2) → (true: seq2) → ... → default
   */
  private parseChooseBlock(
    chooseAction: Record<string, unknown>,
    options: ParseOptions
  ): {
    nodes: FlowNode[];
    edges: FlowEdge[];
    outputNodeIds: string[];
    falsePathOutputIds: string[];
  } {
    const {
      warnings,
      previousNodeIds,
      getNextNodeId,
      conditionNodeIds = new Set(),
      falsePathConditionIds = new Set(),
      inheritedEnabled,
      recorder,
      pathPrefix,
    } = options;

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const outputNodeIds: string[] = [];
    const falsePathOutputIds: string[] = [];
    const localConditionIds = new Set(conditionNodeIds);
    // The choose action's own trace step has no dedicated canvas node; it
    // maps to whichever node is this block's entry point (the first
    // condition node created, mirroring HA evaluating branches in order).
    let entryNodeId: string | null = null;

    // Compute effective enabled state: if parent is disabled or this block is disabled
    const blockEnabled = chooseAction.enabled;
    const effectiveEnabled =
      inheritedEnabled === false ? false : blockEnabled === false ? false : undefined;

    // Helper to get enabled state for nodes in this block
    const getNodeEnabled = (): boolean | undefined => effectiveEnabled;

    const choices = Array.isArray(chooseAction.choose)
      ? chooseAction.choose
      : [chooseAction.choose];

    // Filter to only valid choices with non-empty conditions.
    // Note: an empty array (`conditions: []`) is truthy in JS, so it must be
    // rejected explicitly by checking the array length.
    const isValidChoice = (choice: unknown): boolean => {
      if (typeof choice !== 'object' || choice === null) return false;
      const conds = (choice as Record<string, unknown>).conditions;
      return Array.isArray(conds) ? conds.length > 0 : Boolean(conds);
    };
    const validChoices = choices.filter(isValidChoice);
    // Home Assistant trace paths (`choose/{b}`) are indexed against the
    // original choose array, not the filtered one above.
    const originalChoiceIndices: number[] = [];
    choices.forEach((choice, i) => {
      if (isValidChoice(choice)) originalChoiceIndices.push(i);
    });

    // Track what nodes should connect to the next condition (false path of current)
    let currentPreviousIds = [...previousNodeIds];

    validChoices.forEach((choice, choiceIndex) => {
      const branchPath = `${pathPrefix}/choose/${originalChoiceIndices[choiceIndex]}`;

      // choice.conditions can be an array of conditions or a single condition object
      const conditionsArray = Array.isArray(choice.conditions)
        ? choice.conditions
        : [choice.conditions];

      // Create separate condition nodes for each condition in the choice (explode AND conditions)
      const choiceConditionNodes: ConditionNode[] = [];

      for (let i = 0; i < conditionsArray.length; i++) {
        const condition = conditionsArray[i] as Record<string, unknown>;
        const conditionId = getNextNodeId('condition');

        let conditionNode: ConditionNode;

        if (condition && Array.isArray(condition.conditions)) {
          // Condition with nested conditions (or/and/not) - preserve structure
          const rawConditionType = (condition.condition as string) || 'and';
          const conditionType = VALID_CONDITIONS.includes(rawConditionType as ValidConditionType)
            ? (rawConditionType as ValidConditionType)
            : 'template';

          conditionNode = {
            id: conditionId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data: {
              // Only first condition in first choice gets the alias
              alias: i === 0 ? choice.alias : undefined,
              // The group's own alias/note, kept distinct from the display
              // `alias` above (which may instead be the branch's alias).
              conditionAlias: typeof condition?.alias === 'string' ? condition.alias : undefined,
              stepAlias: i === 0 && typeof choice.alias === 'string' ? choice.alias : undefined,
              stepNote: i === 0 && typeof choice.note === 'string' ? choice.note : undefined,
              note: typeof condition?.note === 'string' ? condition.note : undefined,
              condition: conditionType,
              conditions: transformConditions(condition.conditions),
              // Preserve id for trigger conditions
              id: condition.id as string | undefined,
              enabled: getNodeEnabled(),
            },
          };
        } else {
          // Simple condition - use Zod schema for parsing and type safety
          const rawConditionType = (condition?.condition as string) || 'template';
          const conditionType = VALID_CONDITIONS.includes(rawConditionType as ValidConditionType)
            ? (rawConditionType as ValidConditionType)
            : 'template';

          // Build object with alias override for first condition
          const looseObj = {
            ...condition,
            alias: i === 0 ? (choice.alias ?? condition?.alias) : condition?.alias,
            // The condition's own alias/note, kept distinct from the display
            // `alias` above (which may instead be the branch's alias).
            conditionAlias: typeof condition?.alias === 'string' ? condition.alias : undefined,
            stepAlias: i === 0 && typeof choice.alias === 'string' ? choice.alias : undefined,
            stepNote: i === 0 && typeof choice.note === 'string' ? choice.note : undefined,
            condition: conditionType,
            enabled: getNodeEnabled(),
          };

          // Validate and normalize with HAConditionSchema
          let data: HACondition;
          try {
            data = HAConditionSchema.parse(looseObj);
          } catch {
            // Fallback: minimal valid template
            data = {
              alias: i === 0 ? choice.alias : undefined,
              conditionAlias: typeof condition?.alias === 'string' ? condition.alias : undefined,
              stepAlias: i === 0 && typeof choice.alias === 'string' ? choice.alias : undefined,
              stepNote: i === 0 && typeof choice.note === 'string' ? choice.note : undefined,
              condition: 'template',
              value_template: JSON.stringify(condition),
              enabled: getNodeEnabled(),
            };
          }

          conditionNode = {
            id: conditionId,
            type: 'condition',
            position: { x: 0, y: 0 },
            data,
          };
        }

        choiceConditionNodes.push(conditionNode);
        nodes.push(conditionNode);
        localConditionIds.add(conditionId);
        recorder.record(conditionId, `${branchPath}/conditions/${i}`);
        if (entryNodeId === null) entryNodeId = conditionId;
      }

      // Guard: skip this choice entirely if no condition nodes were created
      // (prevents "Cannot read properties of undefined (reading 'id')").
      if (choiceConditionNodes.length === 0) return;

      const firstConditionId = choiceConditionNodes[0].id;
      const lastConditionId = choiceConditionNodes[choiceConditionNodes.length - 1].id;

      // Connect from current previous nodes to first condition of this choice
      // For first choice, connect from original previousNodeIds
      // For subsequent choices, connect from previous choice's first condition's FALSE path
      for (const prevId of currentPreviousIds) {
        let sourceHandle: string | undefined;
        if (choiceIndex > 0 && localConditionIds.has(prevId) && !conditionNodeIds.has(prevId)) {
          // Previous is a condition from this choose block - use FALSE path
          sourceHandle = 'false';
        } else if (falsePathConditionIds.has(prevId)) {
          // Previous is a condition whose FALSE path should connect here
          sourceHandle = 'false';
        } else if (conditionNodeIds.has(prevId)) {
          // Previous is an external condition (e.g., root-level) - use TRUE path
          sourceHandle = 'true';
        }
        // else: previous is not a condition - no sourceHandle needed
        edges.push(this.createEdge(prevId, firstConditionId, sourceHandle));
      }

      // Chain condition nodes together with 'true' edges
      for (let i = 0; i < choiceConditionNodes.length - 1; i++) {
        edges.push(
          this.createEdge(choiceConditionNodes[i].id, choiceConditionNodes[i + 1].id, 'true')
        );
      }

      // Parse sequence for this choice (TRUE path from last condition)
      if (choice.sequence) {
        const sequence = Array.isArray(choice.sequence) ? choice.sequence : [choice.sequence];
        const sequenceResult = this.parseActions(sequence, {
          warnings,
          previousNodeIds: [lastConditionId],
          getNextNodeId,
          conditionNodeIds: localConditionIds,
          inheritedEnabled: effectiveEnabled,
          recorder,
          pathPrefix: `${branchPath}/sequence`,
        });
        nodes.push(...sequenceResult.nodes);
        edges.push(...sequenceResult.edges);

        // Connect last condition node to first action in sequence via 'true' handle
        if (sequenceResult.nodes.length > 0) {
          const firstActionId = sequenceResult.nodes[0].id;
          const trueEdge = edges.find(
            (e) => e.source === lastConditionId && e.target === firstActionId
          );
          if (trueEdge) {
            trueEdge.sourceHandle = 'true';
          }
          // The last node in the sequence is the output
          const lastNodeId = sequenceResult.nodes[sequenceResult.nodes.length - 1].id;
          outputNodeIds.push(lastNodeId);
        } else {
          // Empty sequence - last condition itself is output
          outputNodeIds.push(lastConditionId);
        }
      } else {
        // No sequence - the last condition's true path is an output
        outputNodeIds.push(lastConditionId);
      }

      // Next choice connects from this choice's FIRST condition's FALSE path
      // (If any condition in the chain fails, we skip to the next choice)
      currentPreviousIds = [firstConditionId];
    });

    // Handle default sequence (connects from last condition's FALSE path)
    if (chooseAction.default) {
      const defaultSequence = Array.isArray(chooseAction.default)
        ? chooseAction.default
        : [chooseAction.default];
      const defaultResult = this.parseActions(defaultSequence, {
        warnings,
        previousNodeIds: currentPreviousIds,
        getNextNodeId,
        conditionNodeIds: localConditionIds,
        inheritedEnabled: effectiveEnabled,
        recorder,
        pathPrefix: `${pathPrefix}/choose/default`,
      });
      nodes.push(...defaultResult.nodes);
      edges.push(...defaultResult.edges);

      // Connect from last condition's FALSE path to default
      if (currentPreviousIds.length > 0 && defaultResult.nodes.length > 0) {
        const lastConditionId = currentPreviousIds[0];
        const firstDefaultId = defaultResult.nodes[0].id;
        const falseEdge = edges.find(
          (e) => e.source === lastConditionId && e.target === firstDefaultId
        );
        if (falseEdge && localConditionIds.has(lastConditionId)) {
          falseEdge.sourceHandle = 'false';
        }
        // The last node in the default sequence is the output
        const lastNodeId = defaultResult.nodes[defaultResult.nodes.length - 1].id;
        outputNodeIds.push(lastNodeId);
      }
      // No branches ever ran (e.g. every choice was invalid) - the default
      // sequence's first node is this block's entry point instead.
      if (entryNodeId === null && defaultResult.nodes.length > 0) {
        entryNodeId = defaultResult.nodes[0].id;
      }
    } else if (validChoices.length > 0) {
      // No default - the last condition's false path is an implicit output
      // (the automation continues after the choose if no condition matches)
      const lastConditionId = currentPreviousIds[0];
      outputNodeIds.push(lastConditionId);
      // Track that this output should use FALSE path, not TRUE
      falsePathOutputIds.push(lastConditionId);
    }

    if (entryNodeId !== null) {
      recorder.record(entryNodeId, pathPrefix);
    }

    return { nodes, edges, outputNodeIds, falsePathOutputIds };
  }

  /**
   * Parse if/then/else block
   */
  private parseIfBlock(
    ifAction: {
      if: HACondition[];
      then: (HACondition | HAAction)[];
      else?: (HACondition | HAAction)[];
      alias?: string;
      note?: string;
      enabled?: unknown;
    },
    options: ParseOptions
  ): {
    nodes: FlowNode[];
    edges: FlowEdge[];
    outputNodeIds: string[];
    falsePathOutputIds: string[];
    unconsumedPreviousIds: string[];
  } {
    const {
      warnings,
      previousNodeIds,
      getNextNodeId,
      conditionNodeIds = new Set(),
      falsePathConditionIds: incomingFalsePathIds = new Set(),
      triggerNodeMap,
      inheritedEnabled,
      recorder,
      pathPrefix,
    } = options;

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const outputNodeIds: string[] = [];
    const falsePathOutputIds: string[] = [];
    const localConditionIds = new Set(conditionNodeIds);

    // Compute effective enabled state: if parent is disabled or this block is disabled
    const effectiveEnabled =
      inheritedEnabled === false ? false : ifAction.enabled === false ? false : undefined;

    // Helper to get enabled state for nodes in this block
    const getNodeEnabled = (): boolean | undefined => effectiveEnabled;

    const ifConditions = Array.isArray(ifAction.if) ? ifAction.if : [ifAction.if];

    // Create separate condition nodes for each condition in the if: array
    // This "explodes" combined conditions into separate linked nodes
    const conditionNodes: ConditionNode[] = [];

    for (let i = 0; i < ifConditions.length; i++) {
      const condition = ifConditions[i] as Record<string, unknown>;
      const conditionId = getNextNodeId('condition');

      let conditionNode: ConditionNode;

      if (condition && Array.isArray(condition.conditions)) {
        // Condition with nested conditions (or/and/not) - preserve structure
        const rawConditionType = (condition.condition as string) || 'and';
        const conditionType = VALID_CONDITIONS.includes(rawConditionType as ValidConditionType)
          ? (rawConditionType as ValidConditionType)
          : 'template';

        conditionNode = {
          id: conditionId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            // Only first condition gets the alias from ifAction
            alias: i === 0 ? ifAction.alias : undefined,
            // The group's own alias/note, kept distinct from the display
            // `alias` above (which may instead be the enclosing step's alias).
            conditionAlias: typeof condition?.alias === 'string' ? condition.alias : undefined,
            stepAlias: i === 0 && typeof ifAction.alias === 'string' ? ifAction.alias : undefined,
            stepNote: i === 0 && typeof ifAction.note === 'string' ? ifAction.note : undefined,
            note: typeof condition?.note === 'string' ? condition.note : undefined,
            condition: conditionType,
            conditions: transformConditions(condition.conditions),
            enabled: getNodeEnabled(),
          },
        };
      } else {
        // Simple condition - use its properties directly
        const rawConditionType = (condition?.condition as string) || 'numeric_state';
        const conditionType = VALID_CONDITIONS.includes(rawConditionType as ValidConditionType)
          ? (rawConditionType as ValidConditionType)
          : 'template';

        // Use Zod looseObject for normalization and type safety
        const looseObj = {
          ...condition,
          // Only first condition gets the alias from ifAction
          alias: i === 0 ? (ifAction.alias ?? condition?.alias) : condition?.alias,
          // The condition's own alias/note, kept distinct from the display
          // `alias` above (which may instead be the enclosing step's alias).
          conditionAlias: typeof condition?.alias === 'string' ? condition.alias : undefined,
          stepAlias: i === 0 && typeof ifAction.alias === 'string' ? ifAction.alias : undefined,
          stepNote: i === 0 && typeof ifAction.note === 'string' ? ifAction.note : undefined,
          condition: conditionType,
          enabled: getNodeEnabled(),
        };

        // Validate and normalize with HAConditionSchema
        let data: HACondition;
        try {
          data = HAConditionSchema.parse(looseObj);
        } catch {
          // Fallback: minimal valid template
          data = {
            alias: i === 0 ? ifAction.alias : undefined,
            conditionAlias: typeof condition?.alias === 'string' ? condition.alias : undefined,
            stepAlias: i === 0 && typeof ifAction.alias === 'string' ? ifAction.alias : undefined,
            stepNote: i === 0 && typeof ifAction.note === 'string' ? ifAction.note : undefined,
            condition: 'template',
            value_template: JSON.stringify(condition),
            enabled: getNodeEnabled(),
          };
        }

        conditionNode = {
          id: conditionId,
          type: 'condition',
          position: { x: 0, y: 0 },
          data,
        };
      }

      conditionNodes.push(conditionNode);
      nodes.push(conditionNode);
      localConditionIds.add(conditionId);
      recorder.record(conditionId, `${pathPrefix}/if/condition/${i}`);
    }
    // The if action's own trace step has no dedicated node; it maps to the
    // primary (first) condition node, mirroring HA's own `action/{i}` step.
    recorder.record(conditionNodes[0].id, pathPrefix);

    // Connect from previous nodes to the first condition.
    // Special case: if this is a single trigger-id condition (no else), only connect
    // the trigger(s) whose id matches — this creates independent parallel flows instead
    // of a single chained sequence when multiple if-trigger blocks exist.
    const firstConditionId = conditionNodes[0].id;

    // Detect trigger-id routing: a single `condition: trigger` with no else.
    // The `id` field can be a string or an array of strings in HA YAML.
    const triggerConditionIds: string[] | null = (() => {
      if (ifAction.else || ifConditions.length !== 1) return null;
      const cond = ifConditions[0] as Record<string, unknown>;
      if (cond?.condition !== 'trigger') return null;
      const rawId = cond?.id;
      if (typeof rawId === 'string') return [rawId];
      if (Array.isArray(rawId) && rawId.length > 0 && rawId.every((x) => typeof x === 'string'))
        return rawId as string[];
      return null;
    })();

    for (const prevId of previousNodeIds) {
      // If this is a trigger-id condition and we have trigger routing info,
      // only connect triggers whose id is listed in this condition's id array.
      if (triggerConditionIds !== null && triggerNodeMap) {
        const triggerIdForNode = triggerNodeMap.get(prevId);
        if (triggerIdForNode !== undefined && !triggerConditionIds.includes(triggerIdForNode)) {
          // This trigger's id doesn't match — don't connect it here
          continue;
        }
      }

      let sourceHandle: string | undefined;
      if (incomingFalsePathIds.has(prevId)) {
        sourceHandle = 'false';
      } else if (localConditionIds.has(prevId)) {
        sourceHandle = 'true';
      }
      edges.push(this.createEdge(prevId, firstConditionId, sourceHandle));
    }

    // Chain condition nodes together with 'true' edges
    for (let i = 0; i < conditionNodes.length - 1; i++) {
      edges.push(this.createEdge(conditionNodes[i].id, conditionNodes[i + 1].id, 'true'));
    }

    // The last condition node connects to the 'then' actions
    const lastConditionId = conditionNodes[conditionNodes.length - 1].id;

    // Parse 'then' sequence (true branch) - connects from last condition
    if (ifAction.then) {
      const thenSequence = Array.isArray(ifAction.then) ? ifAction.then : [ifAction.then];
      const thenResult = this.parseActions(thenSequence, {
        warnings,
        previousNodeIds: [lastConditionId],
        getNextNodeId,
        conditionNodeIds: localConditionIds,
        inheritedEnabled: effectiveEnabled,
        recorder,
        pathPrefix: `${pathPrefix}/then`,
      });
      nodes.push(...thenResult.nodes);
      edges.push(...thenResult.edges);

      // The edges from last condition to first action should use 'true' handle
      if (thenResult.nodes.length > 0) {
        const firstActionId = thenResult.nodes[0].id;
        const trueEdge = edges.find(
          (e) => e.source === lastConditionId && e.target === firstActionId
        );
        if (trueEdge) {
          trueEdge.sourceHandle = 'true';
        }
      }

      // Track all terminal nodes from then branch (not just the last created node,
      // as the last action in the sequence may itself be an if/then/else with multiple exits)
      outputNodeIds.push(...thenResult.terminalNodeIds);
    }

    // Parse 'else' sequence (false branch) - connects from FIRST condition only
    // (This matches the expected behavior: only the first condition handles the else path)
    if (ifAction.else) {
      const elseSequence = Array.isArray(ifAction.else) ? ifAction.else : [ifAction.else];
      // For else branch, we need to connect from first condition with 'false' handle
      const elseResult = this.parseActions(elseSequence, {
        warnings,
        previousNodeIds: [firstConditionId],
        getNextNodeId,
        conditionNodeIds: new Set(), // Don't use localConditionIds for else - we handle the edge manually
        inheritedEnabled: effectiveEnabled,
        recorder,
        pathPrefix: `${pathPrefix}/else`,
      });
      nodes.push(...elseResult.nodes);

      // Add edges manually with 'false' handle for first connection
      if (elseResult.nodes.length > 0) {
        const firstElseNodeId = elseResult.nodes[0].id;
        // Remove any auto-generated edges from first condition to first else node
        const existingEdgeIndex = elseResult.edges.findIndex(
          (e) => e.source === firstConditionId && e.target === firstElseNodeId
        );
        if (existingEdgeIndex >= 0) {
          elseResult.edges.splice(existingEdgeIndex, 1);
        }
        // Add edge with 'false' handle
        edges.push(this.createEdge(firstConditionId, firstElseNodeId, 'false'));
      }

      // Add remaining edges from else result
      edges.push(...elseResult.edges);

      // Track all terminal nodes from else branch
      outputNodeIds.push(...elseResult.terminalNodeIds);
    } else if (triggerConditionIds !== null) {
      // Trigger-id routing: this if block is a dedicated branch for one trigger.
      // There is no sequential false-path continuation — subsequent if blocks are
      // independent branches, each connected directly from their matching trigger.
      // Don't add condition nodes to outputs; they are leaf nodes for this branch.
    } else {
      // No else branch: every condition node is an implicit false exit.
      // The first condition's false path skips the entire if block; each subsequent
      // condition in the AND-chain also exits false when it fails.
      for (const condNode of conditionNodes) {
        outputNodeIds.push(condNode.id);
        falsePathOutputIds.push(condNode.id);
      }
    }

    // If no outputs were added (empty then + else branch), the last condition is the output
    if (outputNodeIds.length === 0 && triggerConditionIds === null) {
      outputNodeIds.push(lastConditionId);
      falsePathOutputIds.push(lastConditionId);
    }

    // For trigger-id routing: the trigger nodes that were NOT consumed by this if block
    // must remain available for subsequent if blocks.
    const unconsumedPreviousIds =
      triggerConditionIds !== null && triggerNodeMap
        ? previousNodeIds.filter((id) => {
            const triggerId = triggerNodeMap.get(id);
            // Keep: trigger nodes whose id is not in this condition's id list, OR non-trigger nodes
            return triggerId === undefined || !triggerConditionIds.includes(triggerId);
          })
        : [];

    return { nodes, edges, outputNodeIds, falsePathOutputIds, unconsumedPreviousIds };
  }

  /**
   * Create an unknown node for unparseable content
   */
  private createUnknownNode(nodeId: string, originalData: unknown): ActionNode {
    const data = originalData as Record<string, unknown> | null | undefined;
    return {
      id: nodeId,
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        alias: `Unknown: ${data?.service || data?.trigger || 'Node'}`,
        service: (data?.service as string) || 'unknown.unknown',
        data: data as Record<string, unknown> | undefined,
      },
    };
  }

  /**
   * Apply positions from metadata
   */
  private applyMetadataPositions(nodes: FlowNode[], metadata: CafeMetadata): FlowNode[] {
    return nodes.map((node) => ({
      ...node,
      position: metadata.nodes[node.id] || node.position,
    }));
  }

  /**
   * Create an edge between two nodes
   */
  private createEdge(source: string, target: string, sourceHandle?: string): FlowEdge {
    return {
      id: generateEdgeId(source, target),
      source,
      target,
      sourceHandle: sourceHandle || undefined,
    };
  }
}

// Export singleton instance
export const yamlParser = new YamlParser();
