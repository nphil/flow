import type {
  ActionNode,
  ConditionNode,
  DelayNode,
  FlowEdge,
  FlowNode,
  HACondition,
  HADelay,
  NodeHints,
  ParallelBlockProps,
  ParallelBranchHint,
  SetVariablesNode,
  WaitNode,
} from '@flow/shared';
import { HATriggerSchema, isDeviceAction, isRecord, readNodeHints } from '@flow/shared';
import { generateEdgeId } from '../utils/generateIds';
import type { PathRecorder } from '../utils/tracePathMap';
import { conditionNodeData } from './condition-nodes';
import { normalizeConditionList } from './conditions';

/**
 * Parses a list of Home Assistant steps (an automation's `actions`, a `then`, a choose branch, a
 * loop body, a parallel branch) into graph nodes and edges.
 *
 * Every list of steps hands control on through its EXITS: the nodes (and, for a condition, the
 * handle) the step after the list connects from. A `stop` ends the run, so a list that ends in one
 * has no exit; an inline `- condition:` step that fails ends only its own list, so it is an exit
 * through its false handle. The block that owns the list merges the exits of its lists, which is
 * how the graph says where a block ends and what runs after it.
 */

export type Handle = 'true' | 'false';

/** Where control leaves a node: through one handle of a condition, or straight on. */
export interface Exit {
  id: string;
  handle?: Handle;
}

export interface StepsResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** The nodes the list's first step connects from the previous exits to. */
  entryIds: string[];
  /** Where control leaves the list (see above). */
  exits: Exit[];
  /**
   * Only when the list has no exit: the `stop` nodes it ends in. Steps written after such a list
   * can never run, but they are still part of the automation, so they hang off these.
   */
  deadEnds: Exit[];
}

export interface StepsOptions {
  /** The exits the first step connects from. */
  previous: Exit[];
  /** Nesting level of this list: 0 for the top-level actions, one more inside every block. */
  depth: number;
  /** Home Assistant trace path of this list; step `i` is `${pathPrefix}/${i}`. */
  pathPrefix: string;
  /** Trigger node id -> the trigger's own `id`, to give `if: trigger id` its own trigger. */
  triggerNodeMap?: Map<string, string>;
}

export interface StepParserServices {
  warnings: string[];
  getNextNodeId: (type: string) => string;
  recorder: PathRecorder;
}

interface BlockResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
  exits: Exit[];
  deadEnds: Exit[];
}

const GROUP_KEYS = ['and', 'or', 'not'];

export function createEdge(source: string, target: string, sourceHandle?: string): FlowEdge {
  return {
    id: generateEdgeId(source, target),
    source,
    target,
    sourceHandle: sourceHandle || undefined,
  };
}

/** The exits as a unique list (a node can leave through both handles, but never twice the same). */
function uniqueExits(exits: Exit[]): Exit[] {
  const seen: Record<string, true> = {};
  return exits.filter((exit) => {
    const key = `${exit.id}/${exit.handle ?? ''}`;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

/** A block's exits and, when it never continues, the `stop` nodes its lists end in. */
function closeBlock(exits: Exit[], lists: StepsResult[]): { exits: Exit[]; deadEnds: Exit[] } {
  const unique = uniqueExits(exits);
  return { exits: unique, deadEnds: unique.length === 0 ? lists.flatMap((l) => l.deadEnds) : [] };
}

/** The record without its undefined entries. */
function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** `enabled` as a block states it: `false` or a template, never `true` (that is the default). */
function blockEnabledOf(value: unknown): false | string | undefined {
  return value === false || typeof value === 'string' ? value : undefined;
}

/** Steps written as one mapping instead of a list are a list of one. */
function toStepList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? [value] : [];
}

/** An inline condition step: a `condition:`, or a shorthand `and:` / `or:` / `not:` group. */
function isConditionStep(step: Record<string, unknown>): boolean {
  return 'condition' in step || GROUP_KEYS.some((key) => key in step);
}

function isVariablesStep(step: Record<string, unknown>): boolean {
  return (
    isRecord(step.variables) &&
    !('service' in step) &&
    !('action' in step) &&
    !('delay' in step) &&
    !('wait_template' in step) &&
    !('choose' in step) &&
    !('if' in step)
  );
}

function isDelayValue(value: unknown): value is HADelay['delay'] {
  return typeof value === 'string' || typeof value === 'number' || isRecord(value);
}

function isServiceStep(step: Record<string, unknown>): boolean {
  return typeof step.service === 'string' || typeof step.action === 'string';
}

/** One `parallel` branch: its steps, and the alias / note of a `{alias, note, sequence}` wrapper. */
interface ParallelBranchSteps {
  steps: unknown[];
  alias?: string;
  note?: string;
}

/** The steps of one `parallel` branch (a bare list, a `{sequence: [...]}` wrapper, or one step). */
function parallelBranch(branch: unknown): ParallelBranchSteps {
  if (Array.isArray(branch)) return { steps: branch };
  if (isRecord(branch) && Array.isArray(branch.sequence)) {
    const { sequence, alias, note, ...others } = branch;
    // A wrapper that carries anything else (`enabled`, ...) is itself a step of the branch.
    if (Object.keys(others).length === 0) {
      return { steps: sequence, alias: str(alias), note: str(note) };
    }
  }
  return { steps: [branch] };
}

/** The trigger ids of a lone `condition: trigger` (no else), or null when the `if` is not one. */
function routedTriggerIds(conditions: HACondition[], hasElse: boolean): string[] | null {
  if (hasElse || conditions.length !== 1) return null;
  const [only] = conditions;
  if (only.condition !== 'trigger') return null;
  const id = only.id;
  if (typeof id === 'string') return [id];
  if (Array.isArray(id) && id.length > 0 && id.every((x) => typeof x === 'string')) return id;
  return null;
}

export class StepParser {
  constructor(private readonly services: StepParserServices) {}

  parseActions(actions: unknown[], options: StepsOptions): StepsResult {
    const { previous, depth, pathPrefix, triggerNodeMap } = options;
    const { warnings, getNextNodeId } = this.services;

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    /** Where the steps parsed so far leave from. */
    let current: Exit[] = previous;
    /** The dead ends of the last step, when it is a block that never continues. */
    let lastDeadEnds: Exit[] = [];
    /** Inline conditions: when one fails, the list ends and control leaves through its false handle. */
    const gateExits: Exit[] = [];
    /** True while the last step parsed is a `stop`. */
    let ended = false;

    const linkFromCurrent = (targetId: string): void => {
      // Steps after a block that never continues (dead code) hang off its stops.
      const sources = current.length > 0 ? current : lastDeadEnds;
      for (const exit of sources) edges.push(createEdge(exit.id, targetId, exit.handle));
    };

    /** A plain step: one node, connected after everything before it. */
    const addStep = (node: FlowNode, tracePath: string): void => {
      nodes.push(node);
      this.services.recorder.record(node.id, tracePath);
      linkFromCurrent(node.id);
      current = [{ id: node.id }];
      lastDeadEnds = [];
    };

    const takeBlock = (block: BlockResult): void => {
      nodes.push(...block.nodes);
      edges.push(...block.edges);
      current = block.exits;
      lastDeadEnds = block.deadEnds;
    };

    actions.forEach((raw, index) => {
      const actionPath = `${pathPrefix}/${index}`;
      ended = false;

      if (!isRecord(raw)) {
        warnings.push(`Unknown action type (${JSON.stringify(raw)}) at index ${index}`);
        addStep(this.verbatimNode(raw), actionPath);
        return;
      }
      const step = raw;

      if (isConditionStep(step)) {
        const gate = this.gateNode(step, index);
        addStep(gate, actionPath);
        current = [{ id: gate.id, handle: 'true' }];
        // A disabled condition never fails, so it never ends the list.
        if (step.enabled !== false) gateExits.push({ id: gate.id, handle: 'false' });
      } else if (isVariablesStep(step)) {
        const { alias, variables, enabled, ...extraProps } = step;
        const node: SetVariablesNode = {
          id: getNextNodeId('set_variables'),
          type: 'set_variables',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // note and any other key the step carries
            alias: str(alias),
            variables: isRecord(variables) ? variables : {},
            enabled: typeof enabled === 'boolean' ? enabled : undefined,
          },
        };
        addStep(node, actionPath);
      } else if (isDelayValue(step.delay)) {
        // Use spread pattern to preserve unknown properties from custom integrations. The delay is
        // kept exactly as written: seconds as a number, HH:MM:SS text, a template, or a mapping of
        // units (days included, any unit may be a template).
        const { alias, delay: _delay, enabled, ...extraProps } = step;
        const node: DelayNode = {
          id: getNextNodeId('delay'),
          type: 'delay',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // Preserve extra properties
            alias: str(alias),
            delay: step.delay,
            enabled: typeof enabled === 'boolean' ? enabled : undefined,
          },
        };
        addStep(node, actionPath);
      } else if ('wait_template' in step || 'wait_for_trigger' in step) {
        addStep(this.waitNode(step), actionPath);
      } else if ('choose' in step) {
        takeBlock(
          this.parseChoose(step, {
            previous: current,
            depth,
            pathPrefix: actionPath,
          })
        );
      } else if ('if' in step && 'then' in step) {
        const block = this.parseIf(step, {
          previous: current,
          depth,
          pathPrefix: actionPath,
          triggerNodeMap,
        });
        takeBlock(block);
        // Trigger-id routing: the triggers that did not match this block stay available as the
        // entry of the next `if`; the matched branch does not feed the steps that follow.
        if (block.unconsumed.length > 0) current = block.unconsumed;
      } else if (isDeviceAction(raw)) {
        addStep(this.deviceNode(step), actionPath);
      } else if ('parallel' in step && (Array.isArray(step.parallel) || isRecord(step.parallel))) {
        takeBlock(
          this.parseParallel(step, {
            previous: current,
            depth,
            pathPrefix: actionPath,
          })
        );
      } else if (typeof step.event === 'string') {
        const { alias, event, event_data, enabled, ...extraProps } = step;
        const node: ActionNode = {
          id: getNextNodeId('action'),
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // note, event_data_template and any other key the step carries
            alias: str(alias),
            event,
            event_data: isRecord(event_data) ? event_data : undefined,
            enabled: typeof enabled === 'boolean' ? enabled : undefined,
          },
        };
        addStep(node, actionPath);
      } else if (isRecord(step.repeat)) {
        takeBlock(
          this.parseRepeat(step, step.repeat, {
            previous: current,
            depth,
            pathPrefix: actionPath,
          })
        );
      } else if (isServiceStep(step)) {
        addStep(this.serviceNode(step), actionPath);
      } else if ('set_conversation_response' in step) {
        const { alias, set_conversation_response, enabled, ...extraProps } = step;
        const node: ActionNode = {
          id: getNextNodeId('action'),
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // note and any other key the step carries
            alias: str(alias),
            // A string replies; null clears the reply (keep it: an empty step is invalid).
            set_conversation_response:
              typeof set_conversation_response === 'string' || set_conversation_response === null
                ? set_conversation_response
                : undefined,
            enabled: typeof enabled === 'boolean' ? enabled : undefined,
          },
        };
        addStep(node, actionPath);
      } else if ('stop' in step) {
        // Halts the run: nothing after it in the same list can run, so a list that ends in an
        // enabled `stop` has no exit.
        const { alias, stop, error, note, enabled, ...extraProps } = step;
        const node: ActionNode = {
          id: getNextNodeId('action'),
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            ...extraProps, // e.g. response_variable
            alias: str(alias),
            stop: typeof stop === 'string' || stop === null ? stop : '',
            ...(error === true ? { error: true } : {}),
            note: str(note),
            enabled: typeof enabled === 'boolean' ? enabled : undefined,
          },
        };
        addStep(node, actionPath);
        ended = enabled !== false;
      } else {
        // A step Flow has no node for (`scene:`, `service_template:`, a `sequence:` group, an
        // integration's own step): it stays on the canvas and is saved back exactly as written.
        warnings.push(`Step ${index} is kept exactly as written: ${Object.keys(step).join(', ')}`);
        addStep(this.verbatimNode(step), actionPath);
      }
    });

    const previousIds = new Set(previous.map((exit) => exit.id));
    const entryIds = [
      ...new Set(edges.filter((edge) => previousIds.has(edge.source)).map((edge) => edge.target)),
    ];
    for (const node of nodes) {
      if (!Object.hasOwn(node.data, 'stepDepth')) setHints(node, { stepDepth: depth });
    }
    const exits = uniqueExits([...(ended ? [] : current), ...gateExits]);
    return {
      nodes,
      edges,
      entryIds,
      exits,
      deadEnds: exits.length > 0 ? [] : ended ? current : lastDeadEnds,
    };
  }

  // ---------------------------------------------------------------------------
  // Plain steps
  // ---------------------------------------------------------------------------

  private waitNode(step: Record<string, unknown>): WaitNode {
    const {
      alias,
      wait_template: waitTemplate,
      wait_for_trigger: waitForTrigger,
      timeout: timeoutValue,
      continue_on_timeout: continueOnTimeoutValue,
      enabled,
      ...extraProps
    } = step;

    // `timeout` is HH:MM:SS text, a number of seconds, a mapping (any unit may be a template)
    // or a template. Keep whatever was written: dropping it lets a wait block forever.
    const timeout =
      typeof timeoutValue === 'string' || typeof timeoutValue === 'number' || isRecord(timeoutValue)
        ? timeoutValue
        : undefined;

    const waitData: WaitNode['data'] = {
      ...extraProps, // Preserve extra properties
      alias: str(alias),
      timeout,
      continue_on_timeout:
        typeof continueOnTimeoutValue === 'boolean' ? continueOnTimeoutValue : undefined,
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
    };

    // HA also accepts a single trigger mapping where a list is expected.
    const waitTriggers = Array.isArray(waitForTrigger)
      ? waitForTrigger
      : isRecord(waitForTrigger)
        ? [waitForTrigger]
        : undefined;
    if (typeof waitTemplate === 'string') {
      waitData.wait_template = waitTemplate;
    } else if (waitTriggers) {
      const parsedTriggers = [];
      for (const trigger of waitTriggers) {
        const result = HATriggerSchema.safeParse(trigger);
        if (result.success) {
          parsedTriggers.push(result.data);
        } else {
          this.services.warnings.push(
            `Failed to parse a trigger inside wait_for_trigger: ${result.error.message}`
          );
        }
      }
      waitData.wait_for_trigger = parsedTriggers;
    }

    return {
      id: this.services.getNextNodeId('wait'),
      type: 'wait',
      position: { x: 0, y: 0 },
      data: waitData,
    };
  }

  /** Device action (type + device_id + domain), shown like a service call. */
  private deviceNode(step: Record<string, unknown>): ActionNode {
    // Extract known metadata fields vs additional parameters
    const knownFields = ['type', 'device_id', 'domain', 'entity_id', 'subtype', 'alias', 'enabled'];
    const additionalParams = Object.fromEntries(
      Object.entries(step).filter(
        ([key, value]) => !knownFields.includes(key) && value !== undefined
      )
    );

    return {
      id: this.services.getNextNodeId('action'),
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        alias: str(step.alias),
        service: `${step.domain}.${step.type}`,
        target: {
          device_id: typeof step.device_id === 'string' ? step.device_id : undefined,
        },
        // Preserve original device action metadata and additional params (like 'option')
        data: {
          type: step.type,
          device_id: step.device_id,
          domain: step.domain,
          entity_id: step.entity_id,
          subtype: step.subtype,
          ...additionalParams,
        },
        enabled: typeof step.enabled === 'boolean' ? step.enabled : undefined,
      },
    };
  }

  /** Regular service call (`action:`, or the older `service:`). */
  private serviceNode(step: Record<string, unknown>): ActionNode {
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
    } = step;
    return {
      id: this.services.getNextNodeId('action'),
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        ...extraProps, // Preserve extra properties
        alias: str(alias),
        service: typeof service === 'string' ? service : str(actionField),
        // `target` and `data` may also be one template that renders to a mapping.
        target: isRecord(target) || typeof target === 'string' ? target : undefined,
        data: isRecord(data) || typeof data === 'string' ? data : undefined,
        data_template: isRecord(data_template) ? data_template : undefined,
        response_variable: str(response_variable),
        continue_on_error: typeof continue_on_error === 'boolean' ? continue_on_error : undefined,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        // The step said `service:` (the spelling before HA renamed it to `action:`); keep it
        // that way on save. Steps made in Flow carry no marker and are written as `action:`.
        ...(typeof service === 'string' ? { legacyServiceKey: true } : {}),
      },
    };
  }

  /** A step Flow cannot model: one node that holds the step as written and saves it unchanged. */
  private verbatimNode(step: unknown): ActionNode {
    const own = isRecord(step) ? step : {};
    return {
      id: this.services.getNextNodeId('action'),
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        alias: str(own.alias),
        note: str(own.note),
        enabled: typeof own.enabled === 'boolean' ? own.enabled : undefined,
        verbatimStep: step,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Conditions
  // ---------------------------------------------------------------------------

  /** A condition node: the condition as written plus the hints and display fields given. */
  private conditionNode(
    condition: HACondition,
    label: string,
    layer: Record<string, unknown>
  ): ConditionNode {
    return {
      id: this.services.getNextNodeId('condition'),
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        ...conditionNodeData(condition, this.services.warnings, label),
        // The condition's own alias, kept apart from the alias the canvas shows (which may be the
        // alias of the step that owns this condition).
        conditionAlias: str(condition.alias),
        ...compact(layer),
      },
    };
  }

  /** The conditions of one `if` / choose branch / loop test, chained with `true` edges. */
  private conditionChain(
    conditions: HACondition[],
    label: string,
    layerOf: (index: number) => Record<string, unknown>
  ): { nodes: ConditionNode[]; edges: FlowEdge[] } {
    const nodes = conditions.map((condition, index) =>
      this.conditionNode(condition, `${label} condition ${index}`, {
        conditionIndex: index,
        ...layerOf(index),
      })
    );
    const edges = nodes.slice(1).map((node, index) => createEdge(nodes[index].id, node.id, 'true'));
    return { nodes, edges };
  }

  /** An inline `- condition:` step. */
  private gateNode(step: Record<string, unknown>, index: number): ConditionNode {
    const [condition] = normalizeConditionList([step]);
    return {
      id: this.services.getNextNodeId('condition'),
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        ...conditionNodeData(condition ?? {}, this.services.warnings, `Inline condition ${index}`),
        gateStep: true,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // if / then / else
  // ---------------------------------------------------------------------------

  private parseIf(
    step: Record<string, unknown>,
    options: StepsOptions
  ): BlockResult & { unconsumed: Exit[] } {
    const { previous, depth, pathPrefix, triggerNodeMap } = options;
    const { recorder } = this.services;

    const conditions = normalizeConditionList(step.if);
    const thenSteps = toStepList(step.then);
    const elseSteps = toStepList(step.else);
    // An empty `else: []` (which Flow itself used to write) is no else at all
    const hasElse = elseSteps.length > 0;
    const stepAlias = str(step.alias);
    const stepNote = str(step.note);

    const chain = this.conditionChain(conditions, 'If', (index) => ({
      // The alias the canvas shows on the first condition is the alias of the `if` step.
      alias: index === 0 ? (stepAlias ?? str(conditions[0]?.alias)) : undefined,
      ...(index === 0 ? { stepAlias, stepNote, blockEnabled: blockEnabledOf(step.enabled) } : {}),
    }));
    const nodes: FlowNode[] = [...chain.nodes];
    const edges: FlowEdge[] = [...chain.edges];
    const first = chain.nodes[0];
    const last = chain.nodes[chain.nodes.length - 1];

    chain.nodes.forEach((node, index) => {
      recorder.record(node.id, `${pathPrefix}/if/condition/${index}`);
    });
    // The if step's own trace step has no node of its own; it maps to the first condition.
    recorder.record(first.id, pathPrefix);

    // A lone `condition: trigger` with no else gives each trigger its own branch: only the
    // triggers it names connect to it.
    const routed = routedTriggerIds(conditions, hasElse);
    const isRouted = (id: string): boolean => {
      const triggerId = triggerNodeMap?.get(id);
      return triggerId === undefined || (routed?.includes(triggerId) ?? true);
    };
    for (const exit of previous) {
      if (routed !== null && !isRouted(exit.id)) continue;
      edges.push(createEdge(exit.id, first.id, exit.handle));
    }
    const unconsumed = routed === null ? [] : previous.filter((exit) => !isRouted(exit.id));

    const lists: StepsResult[] = [];
    const thenResult = this.parseActions(thenSteps, {
      previous: [{ id: last.id, handle: 'true' }],
      depth: depth + 1,
      pathPrefix: `${pathPrefix}/then`,
    });
    lists.push(thenResult);
    nodes.push(...thenResult.nodes);
    edges.push(...thenResult.edges);
    // An empty `then` leaves straight through the true handle.
    const exits: Exit[] =
      thenResult.nodes.length > 0 ? [...thenResult.exits] : [{ id: last.id, handle: 'true' }];

    if (hasElse) {
      // The else branch hangs off the FIRST condition: it is the one that decides.
      const elseResult = this.parseActions(elseSteps, {
        previous: [{ id: first.id, handle: 'false' }],
        depth: depth + 1,
        pathPrefix: `${pathPrefix}/else`,
      });
      lists.push(elseResult);
      nodes.push(...elseResult.nodes);
      edges.push(...elseResult.edges);
      exits.push(...elseResult.exits);
    } else if (routed === null) {
      // No else: failing any condition continues straight after the block.
      for (const node of chain.nodes) exits.push({ id: node.id, handle: 'false' });
    }

    return { nodes, edges, ...closeBlock(exits, lists), unconsumed };
  }

  // ---------------------------------------------------------------------------
  // choose
  // ---------------------------------------------------------------------------

  /**
   * `choose`: the first branch whose conditions pass runs. Each branch is its chain of condition
   * nodes; the next branch (or the default) hangs off the first condition's false handle.
   */
  private parseChoose(step: Record<string, unknown>, options: StepsOptions): BlockResult {
    const { previous, depth, pathPrefix } = options;
    const { recorder } = this.services;

    const choices = Array.isArray(step.choose) ? step.choose : [step.choose];
    // A branch with no conditions is skipped. Home Assistant trace paths (`choose/{b}`) count
    // the branches as written, so the original index is kept.
    const branches = choices.flatMap((choice, originalIndex) => {
      if (!isRecord(choice)) return [];
      const conditions = normalizeConditionList(choice.conditions ?? choice.condition);
      return conditions.length > 0 ? [{ choice, conditions, originalIndex }] : [];
    });

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const exits: Exit[] = [];
    const lists: StepsResult[] = [];
    // Where the next branch (and finally the default) connects from.
    let from: Exit[] = previous;
    let entryNodeId: string | null = null;

    branches.forEach(({ choice, conditions, originalIndex }, branchIndex) => {
      const branchPath = `${pathPrefix}/choose/${originalIndex}`;
      const branchAlias = str(choice.alias);
      const chain = this.conditionChain(conditions, `Choose branch ${branchIndex}`, (index) => ({
        ...(index === 0
          ? {
              // The alias the canvas shows on the first condition is the alias of its branch.
              alias: branchAlias ?? str(conditions[0]?.alias),
              chooseBranch: branchIndex,
              stepAlias: branchAlias,
              stepNote: str(choice.note),
            }
          : {}),
        // The `choose` step's own alias / note / enabled ride on the very first condition.
        ...(branchIndex === 0 && index === 0
          ? {
              blockAlias: str(step.alias),
              blockNote: str(step.note),
              blockEnabled: blockEnabledOf(step.enabled),
            }
          : {}),
      }));
      const first = chain.nodes[0];
      const last = chain.nodes[chain.nodes.length - 1];
      nodes.push(...chain.nodes);
      edges.push(...chain.edges);
      chain.nodes.forEach((node, index) => {
        recorder.record(node.id, `${branchPath}/conditions/${index}`);
      });
      entryNodeId ??= first.id;

      for (const exit of from) edges.push(createEdge(exit.id, first.id, exit.handle));

      const sequence = this.parseActions(toStepList(choice.sequence), {
        previous: [{ id: last.id, handle: 'true' }],
        depth: depth + 1,
        pathPrefix: `${branchPath}/sequence`,
      });
      lists.push(sequence);
      nodes.push(...sequence.nodes);
      edges.push(...sequence.edges);
      // An empty sequence leaves straight through the true handle.
      exits.push(
        ...(sequence.nodes.length > 0 ? sequence.exits : [{ id: last.id, handle: 'true' as const }])
      );

      from = [{ id: first.id, handle: 'false' }];
    });

    const defaultSteps = toStepList(step.default);
    const defaultResult = this.parseActions(defaultSteps, {
      previous: from,
      depth: depth + 1,
      pathPrefix: `${pathPrefix}/choose/default`,
    });
    lists.push(defaultResult);
    nodes.push(...defaultResult.nodes);
    edges.push(...defaultResult.edges);
    if (defaultResult.nodes.length > 0) {
      exits.push(...defaultResult.exits);
      // No branch ran at all (every one was skipped): the default is the block's entry.
      entryNodeId ??= defaultResult.nodes[0].id;
    } else if (branches.length > 0) {
      // No default: when no branch matches, control falls out through the last false handle.
      exits.push(...from);
    } else {
      exits.push(...previous);
    }

    if (entryNodeId !== null) {
      // The choose step's own trace step has no node of its own; it maps to the first condition.
      recorder.record(entryNodeId, pathPrefix);
    }
    return { nodes, edges, ...closeBlock(exits, lists) };
  }

  // ---------------------------------------------------------------------------
  // parallel
  // ---------------------------------------------------------------------------

  /**
   * `parallel`: every branch starts from the same exits and the steps after the block follow all
   * of them. The block has no node of its own; each branch's first node says which branch it
   * opens (`parallelPath`).
   */
  private parseParallel(step: Record<string, unknown>, options: StepsOptions): BlockResult {
    const { previous, depth, pathPrefix } = options;

    const items = Array.isArray(step.parallel) ? step.parallel : [step.parallel];
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    const exits: Exit[] = [];
    const branches: { entryIds: string[]; nodes: FlowNode[]; alias?: string; note?: string }[] = [];
    const lists: StepsResult[] = [];

    items.forEach((item, branchIndex) => {
      const { steps, alias, note } = parallelBranch(item);
      const result = this.parseActions(steps, {
        previous,
        depth: depth + 1,
        // HA wraps every parallel branch in a sequence, even a single action.
        pathPrefix: `${pathPrefix}/parallel/${branchIndex}/sequence`,
      });
      if (result.nodes.length === 0) return;
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      exits.push(...result.exits);
      lists.push(result);
      branches.push({ entryIds: result.entryIds, nodes: result.nodes, alias, note });
    });

    if (branches.length === 0) return { nodes, edges, exits: previous, deadEnds: [] };

    const block: ParallelBlockProps = {
      alias: str(step.alias),
      note: str(step.note),
      enabled: blockEnabledOf(step.enabled),
    };
    const hasBlockProps = Object.values(block).some((value) => value !== undefined);
    branches.forEach((branch, branchIndex) => {
      for (const entryId of branch.entryIds) {
        const entry = branch.nodes.find((node) => node.id === entryId);
        if (!entry) continue;
        // A branch that starts with another parallel block lists the outer one first.
        setHints(entry, {
          parallelPath: [
            {
              branch: branchIndex,
              count: branches.length,
              alias: branch.alias,
              note: branch.note,
              block: branchIndex === 0 && hasBlockProps ? block : undefined,
            },
            ...readParallelPath(entry),
          ],
        });
      }
    });
    return { nodes, edges, ...closeBlock(exits, lists) };
  }

  // ---------------------------------------------------------------------------
  // repeat
  // ---------------------------------------------------------------------------

  /**
   * `repeat` is spread over the graph so the loop can be seen: `while` and `until` become their
   * condition nodes, `count` a counter (set variables, a check) and `for_each` stays one step
   * that holds its own sequence. The loop's nodes carry a `loopRole`, the back-edges are the
   * loop.
   */
  private parseRepeat(
    step: Record<string, unknown>,
    repeat: Record<string, unknown>,
    options: StepsOptions
  ): BlockResult {
    const whileConditions = normalizeConditionList(repeat.while);
    const untilConditions = normalizeConditionList(repeat.until);
    if (whileConditions.length > 0) {
      return this.parseRepeatWhile(step, repeat, whileConditions, options);
    }
    if (untilConditions.length > 0) {
      return this.parseRepeatUntil(step, repeat, untilConditions, options);
    }
    if (repeat.count !== undefined) return this.parseRepeatCount(step, repeat, options);
    return this.parseRepeatOpaque(step, repeat, options);
  }

  /** The loop's own alias / note / enabled, carried by its first node. */
  private loopBlockHints(step: Record<string, unknown>): NodeHints {
    return {
      blockAlias: str(step.alias),
      blockNote: str(step.note),
      blockEnabled: blockEnabledOf(step.enabled),
    };
  }

  private parseRepeatWhile(
    step: Record<string, unknown>,
    repeat: Record<string, unknown>,
    conditions: HACondition[],
    options: StepsOptions
  ): BlockResult {
    const { previous, depth, pathPrefix } = options;
    const { recorder } = this.services;
    const block = this.loopBlockHints(step);

    // condition →(true)→ body … →(back-edge)→ condition;  condition →(false)→ what follows
    const chain = this.conditionChain(conditions, 'While', (index) => ({
      loopRole: 'while',
      ...(index === 0 ? { ...block, alias: block.blockAlias } : {}),
    }));
    const first = chain.nodes[0];
    const last = chain.nodes[chain.nodes.length - 1];
    chain.nodes.forEach((node, index) => {
      recorder.record(node.id, `${pathPrefix}/repeat/while/${index}`);
    });
    // The repeat step's own trace step maps to the loop's entry: for `while` the test runs first.
    recorder.record(first.id, pathPrefix);

    const edges: FlowEdge[] = [...chain.edges];
    for (const exit of previous) edges.push(createEdge(exit.id, first.id, exit.handle));

    const body = this.parseActions(toStepList(repeat.sequence), {
      previous: [{ id: last.id, handle: 'true' }],
      depth: depth + 1,
      pathPrefix: `${pathPrefix}/repeat/sequence`,
    });
    edges.push(...body.edges);
    // Everything that leaves the body goes back to the first test.
    if (body.nodes.length > 0) {
      for (const exit of body.exits) edges.push(createEdge(exit.id, first.id, exit.handle));
    }

    return {
      nodes: [...chain.nodes, ...body.nodes],
      edges,
      exits: [{ id: first.id, handle: 'false' }],
      deadEnds: [],
    };
  }

  private parseRepeatUntil(
    step: Record<string, unknown>,
    repeat: Record<string, unknown>,
    conditions: HACondition[],
    options: StepsOptions
  ): BlockResult {
    const { previous, depth, pathPrefix } = options;
    const { recorder } = this.services;
    const block = this.loopBlockHints(step);

    // body … → condition →(true)→ what follows;  condition →(false, back-edge)→ body start
    const body = this.parseActions(toStepList(repeat.sequence), {
      previous,
      depth: depth + 1,
      pathPrefix: `${pathPrefix}/repeat/sequence`,
    });
    const hasBody = body.nodes.length > 0;

    const chain = this.conditionChain(conditions, 'Until', (index) => ({
      loopRole: 'until',
      ...(index === 0
        ? {
            ...block,
            // The canvas shows the block's alias on the first test only while there is no body.
            ...(hasBody ? {} : { alias: block.blockAlias }),
          }
        : {}),
    }));
    const first = chain.nodes[0];
    const last = chain.nodes[chain.nodes.length - 1];
    chain.nodes.forEach((node, index) => {
      recorder.record(node.id, `${pathPrefix}/repeat/until/${index}`);
    });
    // The repeat step's own trace step maps to the loop's entry: for `until` the body runs before
    // the first test, so the entry is the first body node (or the first test when it is empty).
    recorder.record(body.entryIds[0] ?? first.id, pathPrefix);

    const edges: FlowEdge[] = [...body.edges, ...chain.edges];
    if (hasBody) {
      // Everything that leaves the body reaches the first test.
      // (A body that always stops leaves from its stops: the tests are dead code but still there.)
      const bodyEnds = body.exits.length > 0 ? body.exits : body.deadEnds;
      for (const exit of bodyEnds) edges.push(createEdge(exit.id, first.id, exit.handle));
      // EVERY test loops back on its false handle: until = AND of the tests, any failure repeats.
      for (const node of chain.nodes) {
        for (const entryId of body.entryIds) edges.push(createEdge(node.id, entryId, 'false'));
      }
    } else {
      for (const exit of previous) edges.push(createEdge(exit.id, first.id, exit.handle));
    }

    return {
      nodes: [...body.nodes, ...chain.nodes],
      edges,
      exits: [{ id: last.id, handle: 'true' }],
      deadEnds: [],
    };
  }

  /**
   * `count`: set variables (counter = 0) → body → set variables (counter + 1) → check
   * (counter < N); the check loops back to the body on true and continues on false.
   */
  private parseRepeatCount(
    step: Record<string, unknown>,
    repeat: Record<string, unknown>,
    options: StepsOptions
  ): BlockResult {
    const { previous, depth, pathPrefix } = options;
    const { getNextNodeId, recorder } = this.services;
    const count = repeat.count;
    const block = this.loopBlockHints(step);

    const counterId = getNextNodeId('set_variables');
    const counterVar = `_repeat_counter_${counterId.replace(/[^a-zA-Z0-9_]/g, '_')}`;

    const init: SetVariablesNode = {
      id: counterId,
      type: 'set_variables',
      position: { x: 0, y: 0 },
      data: {
        alias: block.blockAlias,
        note: block.blockNote,
        variables: { [counterVar]: 0 },
        loopRole: 'count-init',
        loopCount: typeof count === 'number' || typeof count === 'string' ? count : undefined,
        blockEnabled: block.blockEnabled,
      },
    };
    // The repeat step's own trace step maps to the loop's entry: the counter-init runs first.
    recorder.record(counterId, pathPrefix);

    const edges: FlowEdge[] = [];
    for (const exit of previous) edges.push(createEdge(exit.id, counterId, exit.handle));

    const body = this.parseActions(toStepList(repeat.sequence), {
      previous: [{ id: counterId }],
      depth: depth + 1,
      pathPrefix: `${pathPrefix}/repeat/sequence`,
    });
    edges.push(...body.edges);

    const increment: SetVariablesNode = {
      id: getNextNodeId('set_variables'),
      type: 'set_variables',
      position: { x: 0, y: 0 },
      data: {
        variables: { [counterVar]: `{{ ${counterVar} + 1 }}` },
        loopRole: 'count-step',
      },
    };
    // A body that always stops leaves from its stops: the increment is dead code but still there.
    const bodyEnds = body.exits.length > 0 ? body.exits : body.deadEnds;
    const exitsOfBody: Exit[] = body.nodes.length > 0 ? bodyEnds : [{ id: counterId }];
    for (const exit of exitsOfBody) edges.push(createEdge(exit.id, increment.id, exit.handle));

    const check: ConditionNode = {
      id: getNextNodeId('condition'),
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        condition: 'template',
        value_template: `{{ ${counterVar} < ${countLimit(count)} }}`,
        loopRole: 'count-check',
      },
    };
    edges.push(createEdge(increment.id, check.id));
    // Back-edge: the check goes back to the body's start (or to the increment when it is empty).
    const loopTargets = body.nodes.length > 0 ? body.entryIds : [increment.id];
    for (const target of loopTargets) edges.push(createEdge(check.id, target, 'true'));

    return {
      nodes: [init, ...body.nodes, increment, check],
      edges,
      exits: [{ id: check.id, handle: 'false' }],
      deadEnds: [],
    };
  }

  /**
   * `for_each` (and any `repeat` of a kind Flow does not know) stays one step that holds its own
   * `repeat` block: the per-item binding (`repeat.item`) has no fixed place in a graph.
   */
  private parseRepeatOpaque(
    step: Record<string, unknown>,
    repeat: Record<string, unknown>,
    options: StepsOptions
  ): BlockResult {
    const { previous, pathPrefix } = options;
    const { alias, note, enabled } = step;
    const node: ActionNode = {
      id: this.services.getNextNodeId('action'),
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        alias: str(alias),
        note: str(note),
        repeat: repeat as ActionNode['data']['repeat'],
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
      },
    };
    this.services.recorder.record(node.id, pathPrefix);
    return {
      nodes: [node],
      edges: previous.map((exit) => createEdge(exit.id, node.id, exit.handle)),
      exits: [{ id: node.id }],
      deadEnds: [],
    };
  }
}

/** What `repeat.count` counts to, as a template operand for the counter check shown on the canvas. */
function countLimit(count: unknown): string {
  if (typeof count === 'number') return String(count);
  if (typeof count !== 'string') return '0';
  const single = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(count.trim());
  return single ? `(${single[1]})` : count;
}

function setHints(node: FlowNode, hints: NodeHints): void {
  Object.assign(node.data, hints);
}

function readParallelPath(node: FlowNode): ParallelBranchHint[] {
  return readNodeHints(node.data).parallelPath ?? [];
}
