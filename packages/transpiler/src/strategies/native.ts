import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowGraph,
  FlowNode,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@flow/shared';
import { isDeviceAction, isRecord, readNodeHints, stripInternalKeys } from '@flow/shared';
import type { TopologyAnalysis } from '../analyzer/topology';
import { BaseStrategy, type HAYamlOutput } from './base';
import { SequenceBuilder } from './sequence-builder';

/**
 * Steps kept exactly as the author wrote them (`scene:`, a `sequence:` group, ...). They are not
 * tidied on the way out: an empty `else: []` inside one stays.
 */
const verbatimSteps = new WeakSet<object>();

/** Step keys whose value is (or holds) a nested list of steps. */
const NESTED_STEP_KEYS = ['then', 'else', 'default', 'sequence', 'parallel', 'choose', 'repeat'];

/**
 * An empty `else: []` / `default: []` means the same as no else/default, but
 * clutters the YAML and shows up as an empty section in Home Assistant's own
 * editor. Remove them, recursively, from a generated step tree.
 */
function pruneEmptyBranches(step: unknown): void {
  if (Array.isArray(step)) {
    for (const child of step) pruneEmptyBranches(child);
    return;
  }
  if (!isRecord(step) || verbatimSteps.has(step)) return;
  for (const key of ['else', 'default']) {
    const branch = step[key];
    if (Array.isArray(branch) && branch.length === 0) delete step[key];
  }
  for (const key of NESTED_STEP_KEYS) pruneEmptyBranches(step[key]);
}

/**
 * A trigger config without its unset fields. `from: null` and `to: null` are NOT unset: they limit
 * a state trigger to real state changes (attribute-only updates stop firing it), so they stay.
 */
function cleanTrigger(trigger: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(trigger).filter(
      ([key, value]) =>
        value !== undefined && value !== '' && (value !== null || key === 'from' || key === 'to')
    )
  );
}

/**
 * Native strategy for simple tree-shaped automations
 * Generates standard nested Home Assistant YAML with choose blocks
 */
export class NativeStrategy extends BaseStrategy {
  readonly name = 'native';
  readonly description = 'Generates nested HA YAML for simple tree-shaped automations';

  canHandle(analysis: TopologyAnalysis): boolean {
    return analysis.isTree;
  }

  generate(flow: FlowGraph, _analysis: TopologyAnalysis): HAYamlOutput {
    const triggers = this.extractTriggers(flow);
    const builder = new SequenceBuilder(flow, {
      buildNodeAction: (node) => this.buildNodeAction(node),
      buildCondition: (node) => this.buildCondition(node),
    });
    const { rootConditions, actions, warnings, unplaced } = builder.buildActions(
      flow.nodes.filter((node) => node.type === 'trigger').map((node) => node.id)
    );

    const automation: Record<string, unknown> = {
      alias: flow.name,
      description: flow.description || '',
      triggers: triggers,
    };

    if (rootConditions && rootConditions.length > 0) {
      automation.conditions = rootConditions;
    }

    pruneEmptyBranches(actions);
    automation.actions = actions;
    automation.mode = flow.metadata?.mode ?? 'single';

    // Add optional metadata
    if (flow.metadata?.max) {
      automation.max = flow.metadata.max;
    }
    if (flow.metadata?.max_exceeded) {
      automation.max_exceeded = flow.metadata.max_exceeded;
    }
    if (typeof flow.metadata?.initial_state === 'boolean') {
      automation.initial_state = flow.metadata.initial_state;
    }
    if (typeof flow.metadata?.hide_entity === 'boolean') {
      automation.hide_entity = flow.metadata.hide_entity;
    }
    if (flow.metadata?.trace) {
      automation.trace = flow.metadata.trace;
    }
    if (flow.userTriggerVariables && Object.keys(flow.userTriggerVariables).length > 0) {
      automation.trigger_variables = flow.userTriggerVariables;
    }

    return {
      automation,
      warnings,
      strategy: this.name,
      incomplete: unplaced.length > 0,
    };
  }

  /**
   * Extract trigger configurations from trigger nodes
   */
  private extractTriggers(flow: FlowGraph): unknown[] {
    return flow.nodes
      .filter((n): n is TriggerNode => n.type === 'trigger')
      .map((node) => cleanTrigger({ ...node.data }));
  }

  /**
   * The step a non-condition node stands for. The node's own data is what gets written: the hints
   * the parser left on it are removed first.
   */
  private buildNodeAction(node: FlowNode): unknown {
    const { verbatimStep, legacyServiceKey } = readNodeHints(node.data);
    if (verbatimStep !== undefined) return this.buildVerbatim(node.data, verbatimStep);

    switch (node.type) {
      case 'action':
        return this.buildActionCall(
          { ...node, data: stripInternalKeys(node.data) },
          legacyServiceKey
        );

      case 'delay':
        return this.buildDelay({ ...node, data: stripInternalKeys(node.data) });

      case 'wait':
        return this.buildWait({ ...node, data: stripInternalKeys(node.data) });

      case 'set_variables':
        return this.buildSetVariables({ ...node, data: stripInternalKeys(node.data) });

      default:
        return null; // Triggers are handled separately, conditions by the sequence builder
    }
  }

  /**
   * A step Flow has no node for, written back exactly as it was read. The alias, note and enabled
   * switch the canvas shows for it are the ones that can be edited, so they win over the step's own.
   */
  private buildVerbatim(data: Record<string, unknown>, raw: unknown): unknown {
    if (!isRecord(raw)) return raw;
    const step = structuredClone(raw);
    for (const key of ['alias', 'note']) {
      const edited = data[key];
      if (typeof edited === 'string' && edited !== '') step[key] = edited;
      else if (typeof raw[key] === 'string') Reflect.deleteProperty(step, key);
    }
    if (typeof data.enabled === 'boolean') step.enabled = data.enabled;
    else if (typeof raw.enabled === 'boolean') Reflect.deleteProperty(step, 'enabled');
    verbatimSteps.add(step);
    return step;
  }

  /**
   * Build condition configuration. A condition's own alias comes from `conditionAlias`, never from
   * `alias` (which may be the alias of the step that owns the condition); the hints the parser
   * left on the node are not part of the condition.
   */
  private buildCondition(node: ConditionNode): Record<string, unknown> {
    // Helper to recursively map condition to condition
    function mapCondition(data: Record<string, unknown>): Record<string, unknown> {
      if (!data || typeof data !== 'object') return data;
      const { conditionAlias } = data;
      // Destructure and exclude 'template' - HA uses 'value_template' for template conditions
      const { condition, conditions, alias: _alias, template, ...rest } = stripInternalKeys(data);
      const out: Record<string, unknown> = {
        condition: condition,
        ...rest,
      };
      // Omit entirely when the source condition had none, rather than fabricating it from `alias`.
      if (typeof conditionAlias === 'string') {
        out.alias = conditionAlias;
      }
      // For template conditions, ensure value_template is set from template if needed
      if (condition === 'template' && !rest.value_template && template) {
        out.value_template = template;
      }
      // Recursively map nested group conditions
      if (Array.isArray(conditions) && conditions.length > 0) {
        out.conditions = conditions
          .map(mapCondition)
          .filter((c) => c && (!Array.isArray(c.conditions) || c.conditions.length > 0));
      }
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== ''));
    }
    return mapCondition(node.data);
  }

  /**
   * Build service call action or device action
   */
  private buildActionCall(node: ActionNode, legacyServiceKey?: boolean): Record<string, unknown> {
    // Check if this is a device action (needs special format)
    if (isDeviceAction(node.data.data)) {
      const deviceData = node.data.data;
      const action: Record<string, unknown> = {
        device_id: deviceData.device_id,
        domain: deviceData.domain,
        type: deviceData.type,
      };

      if (node.data.alias) {
        action.alias = node.data.alias;
      }

      // Add entity_id if present
      if (deviceData.entity_id) {
        action.entity_id = deviceData.entity_id;
      }

      // Add subtype if present
      if (deviceData.subtype) {
        action.subtype = deviceData.subtype;
      }

      // Add any additional parameters (like 'option' for select)
      const knownFields = ['type', 'device_id', 'domain', 'entity_id', 'subtype'];
      for (const [key, value] of Object.entries(deviceData)) {
        if (!knownFields.includes(key) && value !== undefined) {
          action[key] = value;
        }
      }

      if (node.data.enabled === false) {
        action.enabled = false;
      }

      if (typeof node.data.note === 'string') {
        action.note = node.data.note;
      }

      return action;
    }

    // Check if this is a fallback repeat action (opaque repeat block)
    if (node.data.repeat) {
      const repeatData = node.data.repeat;
      const action: Record<string, unknown> = {
        repeat: {
          ...(repeatData.count !== undefined ? { count: repeatData.count } : {}),
          ...(repeatData.while ? { while: repeatData.while } : {}),
          ...(repeatData.until ? { until: repeatData.until } : {}),
          ...(repeatData.for_each ? { for_each: repeatData.for_each } : {}),
          sequence: repeatData.sequence ?? [],
        },
      };
      if (node.data.alias) action.alias = node.data.alias;
      if (node.data.enabled === false) action.enabled = false;
      if (typeof node.data.note === 'string') action.note = node.data.note;
      return action;
    }

    // Check if this is a fire event action
    if (typeof node.data.event === 'string' && node.data.event.trim() !== '') {
      // `id` is dropped like on every other step; event_data_template, note, ... stay.
      const { event, alias, event_data, enabled, id: _id, ...extraProps } = node.data;
      const action: Record<string, unknown> = { ...extraProps, event };
      if (alias) action.alias = alias;
      if (event_data && Object.keys(event_data).length > 0) action.event_data = event_data;
      if (enabled === false) action.enabled = false;
      return action;
    }

    // Check if this is a stop action
    if ('stop' in node.data) {
      const { stop, error, alias, note, enabled, id: _id, ...extraProps } = node.data;
      // `stop: null` (no reason given) is not the same text as `stop: ""`; keep what was written.
      const action: Record<string, unknown> = {
        stop: stop === undefined ? '' : stop,
        ...extraProps,
      };
      if (alias) action.alias = alias;
      if (error === true) action.error = true;
      if (enabled === false) action.enabled = false;
      if (typeof note === 'string') action.note = note;
      return action;
    }

    // Standard service call format
    // Use spread pattern to preserve unknown properties from custom integrations
    const {
      alias,
      service,
      // `id` is intentionally dropped (not just excluded from extraProps) —
      // HA's action-step schemas (service call, delay, wait, set_variables)
      // don't support a per-step `id:` at all; only triggers do. Real HA
      // rejects it outright ("extra keys not allowed"), so it can't be
      // preserved even for round-trip fidelity.
      id: _id,
      target,
      data,
      data_template,
      response_variable,
      continue_on_error,
      enabled,
      repeat: _repeat,
      ...extraProps
    } = node.data;
    const action: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      // `action:` is the current spelling; `service:` only when the opened step used it.
      [legacyServiceKey === true ? 'service' : 'action']: service,
    };

    if (target) {
      action.target = target;
    }

    if (data) {
      action.data = data;
    }

    if (data_template) {
      action.data_template = data_template;
    }

    if (response_variable) {
      action.response_variable = response_variable;
    }

    if (continue_on_error) {
      action.continue_on_error = continue_on_error;
    }

    if (enabled === false) {
      action.enabled = false;
    }

    return action;
  }

  /**
   * Build delay action
   */
  private buildDelay(node: DelayNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, delay: delayValue, id: _id, ...extraProps } = node.data;
    const delay: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
      delay: delayValue,
    };

    return delay;
  }

  /**
   * Build wait action
   */
  private buildWait(node: WaitNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const {
      alias,
      id: _id,
      wait_template,
      wait_for_trigger,
      timeout,
      continue_on_timeout,
      ...extraProps
    } = node.data;
    const wait: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      alias,
    };

    if (wait_template) {
      wait.wait_template = wait_template;
    } else if (wait_for_trigger) {
      wait.wait_for_trigger = wait_for_trigger.map((triggerData) =>
        cleanTrigger({ ...triggerData })
      );
    }

    if (timeout !== undefined && timeout !== '') {
      wait.timeout = timeout;
    }

    if (continue_on_timeout !== undefined) {
      wait.continue_on_timeout = continue_on_timeout;
    }

    return wait;
  }

  /**
   * Build set variables action
   */
  private buildSetVariables(node: SetVariablesNode): Record<string, unknown> {
    // Use spread pattern to preserve unknown properties from custom integrations.
    // `id` is dropped — HA's action-step schemas don't support it, only triggers do.
    const { alias, id: _id, variables, ...extraProps } = node.data;
    const setVars: Record<string, unknown> = {
      ...extraProps, // Preserve extra properties
      variables,
    };

    if (alias) {
      setVars.alias = alias;
    }

    return setVars;
  }
}
