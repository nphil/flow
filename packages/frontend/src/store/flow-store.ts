import type {
  FlowEdge,
  FlowGraph,
  FlowMetadata,
  FlowNode,
  NodeValidationError,
} from '@flow/shared';
import { validateNodeData } from '@flow/shared';
import type { TracePathMap } from '@flow/transpiler';
import { applyHeuristicLayout, FlowTranspiler, resolveTracePath } from '@flow/transpiler';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { dump as yamlDump } from 'js-yaml';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import type { AutomationTrace, TraceStep } from '@/lib/ha-api';
import { getHomeAssistantAPI } from '@/lib/ha-api';
import { generateNodeId, generateUUID } from '@/lib/utils';
import type { HomeAssistant } from '@/types/hass';
import { flowIndexedDBStorage } from '@/utils/indexeddb-storage';

/**
 * Node data types for React Flow
 */

export interface TriggerNodeData {
  alias?: string;
  trigger: string;
  entity_id?: string | string[];
  to?: string;
  from?: string;
  event_type?: string;
  [key: string]: unknown;
}

export interface ConditionNodeData {
  alias?: string;
  condition: string;
  entity_id?: string | string[];
  state?: string;
  template?: string;

  // Numeric state conditions
  above?: number;
  below?: number;

  // Time conditions
  after?: string;
  before?: string;
  weekday?: string | string[];

  // Zone conditions
  zone?: string;

  // Sun conditions
  after_offset?: string;
  before_offset?: string;

  // Device conditions
  device_id?: string;
  domain?: string;
  type?: string;
  subtype?: string;

  // Template conditions
  value_template?: string;

  // Generic conditions
  attribute?: string;
  for?: string | { hours?: number; minutes?: number; seconds?: number };

  [key: string]: unknown;
}

export interface ActionNodeData {
  alias?: string;
  service?: string;
  event?: string;
  event_data?: Record<string, unknown>;
  target?: {
    entity_id?: string | string[];
    area_id?: string | string[];
    device_id?: string | string[];
  };
  data?: Record<string, unknown>;
  // Stop action: halts automation execution with an optional message
  stop?: string;
  error?: boolean;
  [key: string]: unknown;
}

export interface DelayNodeData {
  alias?: string;
  delay: string | { hours?: number; minutes?: number; seconds?: number };
  [key: string]: unknown;
}

export interface WaitNodeData {
  alias?: string;
  wait_template?: string;
  wait_for_trigger?: TriggerNodeData[];
  timeout?: string;
  continue_on_timeout?: boolean;
  [key: string]: unknown;
}

export interface SetVariablesNodeData {
  alias?: string;
  variables: Record<string, unknown>;
  [key: string]: unknown;
}

export type FlowNodeData =
  | TriggerNodeData
  | ConditionNodeData
  | ActionNodeData
  | DelayNodeData
  | WaitNodeData
  | SetVariablesNodeData;

/**
 * Live-trace status for a canvas node, derived from HA trace steps resolved
 * onto it via the store's tracePathMap.
 */
export type NodeTraceStatus = 'ok' | 'active' | 'condition-false' | 'error';

export interface NodeTraceState {
  status: NodeTraceStatus;
  /** ISO timestamp of the first trace step that visited this node */
  timestamp: string;
  /** Result payload of the most recent trace step that visited this node */
  result?: Record<string, unknown>;
  error?: string;
  visitCount: number;
  /** The trace path this node was resolved from */
  path: string;
  /**
   * Elapsed ms from this step's timestamp to the next step's (or the run's
   * finish time, for the last step) — HA traces don't carry a per-step
   * duration directly, so this is the closest proxy. Undefined while the
   * step is still the active/last one in a running trace.
   */
  durationMs?: number;
}

/**
 * Flow store state
 */
export interface FlowState {
  // Graph state
  flowId: string;
  flowName: string;
  flowDescription: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];

  // Automation metadata (mode, max, max_exceeded, etc.)
  flowMetadata: FlowMetadata;

  // User-defined root-level variables (preserved across import/export round-trips)
  userVariables: Record<string, unknown> | undefined;

  // User-defined trigger_variables (preserved across import/export round-trips)
  userTriggerVariables: Record<string, unknown> | undefined;

  // Selection state
  selectedNodeId: string | null;

  // Save state
  automationId: string | null;
  isSaving: boolean;
  lastSaved: Date | null;
  hasUnsavedChanges: boolean;
  originalSnapshot: string | null; // JSON snapshot of original state for comparison

  // Simulation state
  isSimulating: boolean;
  activeNodeId: string | null;
  executionPath: string[];

  // Trace state
  isShowingTrace: boolean;
  traceData: AutomationTrace | null;
  traceExecutionPath: string[];
  traceTimestamps: Record<string, string>;
  nodeTraceStates: Record<string, NodeTraceState>;
  isLiveTrace: boolean;
  traceRunsVersion: number;
  /**
   * Trace path -> canvas node id map for the automation currently on the
   * canvas. Derived from the same YamlParser run that produced the canvas
   * nodes (or a re-parse of the YAML generated on save), so its node ids
   * always match the canvas — trace configs re-parsed on their own would
   * generate fresh ids that match nothing.
   */
  tracePathMap: TracePathMap | null;

  // Shared simulation/trace state
  simulationSpeed: number;

  // Layout state (auto-arrange in flight — see `autoArrange` below)
  isArranging: boolean;

  /**
   * Live-flow animation toggle (design doc §13): dash-flow + packet-dot on
   * the executed path. A UI preference, not graph data — persisted directly
   * to localStorage (`flow.animations`), independent of undo/redo history
   * and the IndexedDB graph-state persist middleware. Single shared source
   * for both the Debug tab header switch and the header overflow menu switch.
   */
  animationsEnabled: boolean;
  setAnimationsEnabled: (enabled: boolean) => void;

  // Toolbar state
  clipboard: string | null;
  pasteCount: number;

  // Actions
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: (changes: NodeChange<Node<FlowNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (node: Node<FlowNodeData>) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  addWaitTimeoutBranch: (waitNodeId: string) => void;

  selectNode: (nodeId: string | null) => void;
  /**
   * Asks the right panel to show the Properties tab for a node (canvas
   * double-click). `propertiesFocusRequest` is an ephemeral monotonic
   * counter — neither persisted nor undo-tracked — that subscribers watch
   * for edges; the node itself arrives via `selectedNodeId`.
   */
  propertiesFocusRequest: number;
  requestPropertiesFocus: (nodeId: string) => void;

  setFlowName: (name: string) => void;
  setFlowDescription: (description: string) => void;
  setFlowMetadata: (metadata: Partial<FlowMetadata>) => void;

  setClipboard: (data: string | null) => void;
  setPasteCount: (count: number) => void;

  // Save actions
  setAutomationId: (id: string | null) => void;
  setSaving: (saving: boolean) => void;
  setSaved: () => void;
  setUnsavedChanges: (hasChanges: boolean) => void;
  saveAutomation: (hassApi: HomeAssistant) => Promise<string>;
  updateAutomation: (hassApi: HomeAssistant) => Promise<void>;
  hasRealChanges: () => boolean; // Compare current state to original snapshot
  /** Same comparison as `hasRealChanges`, exposed as the canonical dirty-state selector. */
  isDirty: () => boolean;

  // Simulation
  startSimulation: () => void;
  stopSimulation: () => void;
  setActiveNode: (nodeId: string | null) => void;
  addToExecutionPath: (nodeId: string) => void;
  clearExecutionPath: () => void;

  // Trace
  showTrace: (traceData: AutomationTrace) => void;
  hideTrace: () => void;
  clearTraceExecutionPath: () => void;
  setLiveTrace: (isLive: boolean) => void;
  bumpTraceRuns: () => void;
  setTracePathMap: (map: TracePathMap | null) => void;

  // Shared simulation/trace actions
  setSimulationSpeed: (speed: number) => void;
  getExecutionStepNumber: (nodeId: string) => number | null;

  // Edge validation
  canDeleteEdge: (edgeId: string) => boolean;

  // Import/Export
  toFlowGraph: () => FlowGraph;
  fromFlowGraph: (graph: FlowGraph) => void;
  /** Loads an existing HA automation by id via the ha-api + YamlParser path, replacing the canvas. */
  openAutomationById: (id: string) => Promise<void>;
  reset: () => void;

  // Layout
  /**
   * Re-lays out the current graph with elkjs (via the transpiler's
   * `applyHeuristicLayout`) and animates positions in — see index.css's
   * `.flow-arranging` rule, toggled by `isArranging` while this runs.
   * `direction` defaults to 'RIGHT' when the caller has no viewport to judge
   * aspect ratio from (e.g. a header button); the canvas's own auto-arrange
   * control computes it from its own bounds instead.
   */
  autoArrange: (direction?: 'RIGHT' | 'DOWN') => Promise<void>;

  // Node validation
  nodeErrors: Map<string, NodeValidationError[]>;
  validateNode: (nodeId: string) => void;
  validateAllNodes: () => void;
  clearNodeErrors: (nodeId: string) => void;
  hasValidationErrors: () => boolean;
}

/**
 * Normalize trigger node data to use 'trigger' instead of legacy 'platform' field.
 * This ensures consistency across the codebase.
 */
function normalizeTriggerData(data: Record<string, unknown>): Record<string, unknown> {
  if ('platform' in data && !('trigger' in data)) {
    const { platform, ...rest } = data;
    return { ...rest, trigger: platform };
  }
  return data;
}

/**
 * Normalize node data based on node type.
 * Currently only normalizes trigger nodes.
 */
function normalizeNodeData(type: string, data: Record<string, unknown>): Record<string, unknown> {
  if (type === 'trigger') {
    return normalizeTriggerData(data);
  }
  return data;
}

// NOTE: Upstream CAFE (#170) treated any two nodes sharing `data.id` as a
// save-blocking error. That contradicts Home Assistant's own semantics:
// multiple triggers may legitimately share an id (it groups them), and a
// `condition: trigger` step's `id` is a REFERENCE to a trigger id, not an
// identity — HA's native editor generates exactly that pattern for branch
// routing. The check blocked saving unmodified real-world automations, so it
// was removed (Flow 1.0.1). Step ids carry no uniqueness requirement in HA.

/**
 * Computes a trace step's live-trace status in isolation. When a node is
 * visited more than once (e.g. inside a repeat loop), `showTrace` calls this
 * again for every visit so the most recently executed step always wins.
 */
function getTraceStepStatus(step: TraceStep): NodeTraceStatus {
  if (step.error || (step.template_errors?.length ?? 0) > 0) {
    return 'error';
  }
  const result = step.result;
  if (result && typeof result.result === 'boolean' && result.result === false) {
    return 'condition-false';
  }
  if (step.path.startsWith('trigger/') && result && typeof result.reason === 'string') {
    return 'condition-false';
  }
  return 'ok';
}

/**
 * Derive the trace path map for a fully assembled automation config by
 * round-tripping it through the transpiler's parser. The config carries
 * `_cafe_metadata`, so the parse restores the exact canvas node ids.
 * Returns null (never throws) when the config can't be parsed.
 */
async function deriveTracePathMap(
  automationConfig: Record<string, unknown>
): Promise<TracePathMap | null> {
  try {
    const transpiler = new FlowTranspiler();
    const result = await transpiler.fromYaml(yamlDump(automationConfig));
    return result.success ? (result.nodePathMap ?? null) : null;
  } catch {
    return null;
  }
}

const defaultFlowMetadata: FlowMetadata = {
  mode: 'single',
  initial_state: true,
};

const ANIMATIONS_STORAGE_KEY = 'flow.animations';

/** Mirrors useFlowTheme.ts's localStorage-read pattern for a plain UI preference. */
function readStoredAnimationsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(ANIMATIONS_STORAGE_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

const initialState = {
  flowId: generateUUID(),
  flowName: 'Untitled Automation',
  flowDescription: '',
  flowMetadata: defaultFlowMetadata,
  userVariables: undefined,
  userTriggerVariables: undefined,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  automationId: null,
  isSaving: false,
  lastSaved: null,
  hasUnsavedChanges: false,
  originalSnapshot: null,
  isSimulating: false,
  activeNodeId: null,
  executionPath: [],
  isShowingTrace: false,
  traceData: null,
  traceExecutionPath: [],
  traceTimestamps: {},
  nodeTraceStates: {},
  isLiveTrace: false,
  traceRunsVersion: 0,
  tracePathMap: null as TracePathMap | null,
  simulationSpeed: 800,
  isArranging: false,
  animationsEnabled: readStoredAnimationsEnabled(),
  nodeErrors: new Map<string, NodeValidationError[]>(),
  clipboard: null,
  pasteCount: 0,
  propertiesFocusRequest: 0,
};

/**
 * Persisted state for the flow store
 * This is duplicated here to avoid circular dependencies
 */
export type PersistedFlowState = Pick<
  FlowState,
  | 'flowId'
  | 'flowName'
  | 'flowDescription'
  | 'flowMetadata'
  | 'nodes'
  | 'edges'
  | 'selectedNodeId'
  | 'automationId'
  | 'lastSaved'
  | 'originalSnapshot'
  | 'tracePathMap'
>;

// Partial state selector for persistence
const persistSelector = (state: FlowState): PersistedFlowState => ({
  flowId: state.flowId,
  flowName: state.flowName,
  flowDescription: state.flowDescription,
  flowMetadata: state.flowMetadata,
  nodes: state.nodes,
  edges: state.edges,
  selectedNodeId: state.selectedNodeId,
  automationId: state.automationId,
  lastSaved: state.lastSaved,
  originalSnapshot: state.originalSnapshot,
  tracePathMap: state.tracePathMap,
});

/**
 * The subset of FlowState that undo/redo tracks — graph content only.
 * Selection, save/dirty bookkeeping, simulation/trace UI state, clipboard,
 * and derived validation errors are deliberately excluded so they don't
 * generate (or get reverted by) history entries.
 */
export type TemporalFlowState = Pick<
  FlowState,
  | 'nodes'
  | 'edges'
  | 'flowName'
  | 'flowDescription'
  | 'flowMetadata'
  | 'userVariables'
  | 'userTriggerVariables'
>;

const temporalSelector = (state: FlowState): TemporalFlowState => ({
  nodes: state.nodes,
  edges: state.edges,
  flowName: state.flowName,
  flowDescription: state.flowDescription,
  flowMetadata: state.flowMetadata,
  userVariables: state.userVariables,
  userTriggerVariables: state.userTriggerVariables,
});

let pendingHistoryCommit:
  | { timeoutId: ReturnType<typeof setTimeout>; burstStart: TemporalFlowState }
  | undefined;

/**
 * Cancels an in-flight debounced history commit (see `handleSet` below)
 * without flushing it. Called from `reset()`/`fromFlowGraph()` alongside
 * `temporal.getState().clear()` — clearing the past/future arrays alone
 * isn't enough, since a burst that was still debouncing when the graph got
 * replaced would otherwise fire *after* the clear and push a snapshot of the
 * *previous* automation into the *new* one's history.
 */
function cancelPendingHistoryCommit(): void {
  if (pendingHistoryCommit) {
    clearTimeout(pendingHistoryCommit.timeoutId);
    pendingHistoryCommit = undefined;
  }
}

export const useFlowStore = create<FlowState>()(
  persist(
    temporal(
      (set, get) => ({
        ...initialState,

        setNodes: (nodes) => set({ nodes }),
        setEdges: (edges) => set({ edges }),

        onNodesChange: (changes) =>
          set((state) => ({
            nodes: applyNodeChanges(changes, state.nodes),
            hasUnsavedChanges: true,
          })),

        onEdgesChange: (changes) =>
          set((state) => ({
            edges: applyEdgeChanges(changes, state.edges),
            hasUnsavedChanges: true,
          })),

        onConnect: (connection) =>
          set((state) => ({
            edges: addEdge(
              {
                ...connection,
                id: `e-${connection.source}-${connection.target}-${Date.now()}`,
                animated: false,
              },
              state.edges
            ),
            hasUnsavedChanges: true,
          })),

        addNode: (node) => {
          // Normalize node data (e.g., convert platform to trigger for trigger nodes)
          const normalizedNode = node.type
            ? {
                ...node,
                data: normalizeNodeData(
                  node.type,
                  node.data as Record<string, unknown>
                ) as FlowNodeData,
              }
            : node;

          set((state) => ({
            nodes: [...state.nodes, normalizedNode],
            hasUnsavedChanges: true,
          }));
          // Validate the newly added node
          get().validateNode(node.id);
        },

        updateNodeData: (nodeId, data) => {
          set((state) => ({
            nodes: state.nodes.map((node) =>
              node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
            ),
            hasUnsavedChanges: true,
          }));
          if ('id' in data) {
            // A rename can resolve a duplicate on one node while creating a new
            // one on another — single-node validation can't see that.
            get().validateAllNodes();
          } else {
            // Validate the node after data update
            get().validateNode(nodeId);
          }
        },

        removeNode: (nodeId) =>
          set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== nodeId),
            edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
            selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
            hasUnsavedChanges: true,
          })),

        // Inserts a template Condition node right after a Wait node so the user
        // can branch on `wait.trigger is not none` / `wait.completed` — i.e.
        // "did it happen in time, or did it time out". Any edges already
        // leaving the Wait node are re-parented onto the condition's 'true'
        // (completed-in-time) handle so the existing continuation keeps
        // working; the 'false' (timed-out) handle is left for the user to
        // wire up themselves.
        addWaitTimeoutBranch: (waitNodeId) => {
          const state = get();
          const waitNode = state.nodes.find((n) => n.id === waitNodeId);
          if (!waitNode || waitNode.type !== 'wait') return;
          const waitData = waitNode.data as WaitNodeData;
          if (!waitData.timeout) return;

          const conditionId = generateNodeId('condition');
          const template =
            waitData.wait_for_trigger !== undefined
              ? '{{ wait.trigger is not none }}'
              : '{{ wait.completed }}';

          const conditionNode: Node<FlowNodeData> = {
            id: conditionId,
            type: 'condition',
            position: { x: waitNode.position.x + 260, y: waitNode.position.y },
            data: {
              alias: 'Wait completed?',
              condition: 'template',
              value_template: template,
            } satisfies ConditionNodeData,
          };

          set((s) => ({
            nodes: [
              ...s.nodes.map((n) =>
                n.id === waitNodeId ? { ...n, data: { ...n.data, continue_on_timeout: true } } : n
              ),
              conditionNode,
            ],
            edges: [
              ...s.edges.map((e) =>
                e.source === waitNodeId ? { ...e, source: conditionId, sourceHandle: 'true' } : e
              ),
              {
                id: `e-${waitNodeId}-${conditionId}-${Date.now()}`,
                source: waitNodeId,
                target: conditionId,
                animated: false,
              },
            ],
            hasUnsavedChanges: true,
          }));
          get().validateNode(conditionId);
        },

        selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

        requestPropertiesFocus: (nodeId) =>
          set((state) => ({
            selectedNodeId: nodeId,
            propertiesFocusRequest: state.propertiesFocusRequest + 1,
          })),

        setClipboard: (data: string | null) => set({ clipboard: data }),
        setPasteCount: (count: number) => set({ pasteCount: count }),

        setFlowName: (name) => set({ flowName: name, hasUnsavedChanges: true }),
        setFlowDescription: (description) =>
          set({ flowDescription: description, hasUnsavedChanges: true }),
        setFlowMetadata: (metadata) =>
          set((state) => ({
            flowMetadata: { ...state.flowMetadata, ...metadata },
            hasUnsavedChanges: true,
          })),

        // Save actions
        setAutomationId: (id) => set({ automationId: id }),
        setSaving: (saving) => set({ isSaving: saving }),
        setSaved: () => set({ lastSaved: new Date(), hasUnsavedChanges: false }),
        setUnsavedChanges: (hasChanges) => set({ hasUnsavedChanges: hasChanges }),
        hasRealChanges: () => {
          const state = get();
          if (!state.originalSnapshot) {
            // No original snapshot means it's a new flow - check if there are any nodes
            return state.nodes.length > 0;
          }
          // Create current snapshot and compare
          const currentSnapshot = JSON.stringify({
            flowName: state.flowName,
            flowDescription: state.flowDescription,
            flowMetadata: state.flowMetadata,
            nodes: state.nodes.map((n) => ({
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data,
            })),
            edges: state.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            })),
          });
          return currentSnapshot !== state.originalSnapshot;
        },
        // `isDirty` is the canonical selector per the FlowShell/FlowParity
        // contract; kept as a delegate rather than folding `hasRealChanges`
        // into it so existing callers of the older name are untouched.
        isDirty: () => get().hasRealChanges(),

        saveAutomation: async (hassApi: HomeAssistant) => {
          const state = get();
          const api = getHomeAssistantAPI(hassApi);

          set({ isSaving: true });

          try {
            // Validate all nodes first
            get().validateAllNodes();

            // Check for validation errors
            const currentState = get();
            if (currentState.nodeErrors.size > 0) {
              const errorCount = currentState.nodeErrors.size;
              throw new Error(
                `Cannot save: ${errorCount} node(s) have validation errors. Fix the highlighted nodes before saving.`
              );
            }

            // Convert flow to graph
            const graph = state.toFlowGraph();

            // Check for empty automation
            if (graph.nodes.length === 0) {
              throw new Error(
                'Cannot save empty automation. Please add at least one trigger and one action node.'
              );
            }

            // Check for minimum required nodes
            const triggers = graph.nodes.filter((n) => n.type === 'trigger');
            const actions = graph.nodes.filter((n) => n.type === 'action');

            if (triggers.length === 0) {
              throw new Error(
                'Automation must have at least one trigger node. Please add a trigger from the node palette.'
              );
            }

            if (actions.length === 0) {
              throw new Error(
                'Automation must have at least one action node. Please add an action from the node palette.'
              );
            }

            const transpiler = new FlowTranspiler();

            // Validate first
            const validation = transpiler.validate(graph);

            if (validation.errors.length > 0) {
              console.error('Flow: Validation errors:', validation.errors);
              throw new Error(
                `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
              );
            }

            // Transpile to automation config
            const result = transpiler.transpile(graph);
            if (!result.success || !result.output?.automation) {
              throw new Error('Failed to transpile flow to automation config');
            }

            // Create automation in Home Assistant
            const automationConfig = {
              alias: state.flowName,
              description: state.flowDescription || '',
              ...result.output.automation,
              variables: {
                ...(result.output.automation.variables || {}),
                _cafe_metadata: {
                  version: 1,
                  strategy: 'native' as const,
                  nodes: graph.nodes.reduce(
                    (acc, node) => {
                      acc[node.id] = {
                        x: node.position.x,
                        y: node.position.y,
                      };
                      return acc;
                    },
                    {} as Record<string, { x: number; y: number }>
                  ),
                  graph_id: graph.id,
                  graph_version: 1,
                },
              },
            };

            const automationId = await api.createAutomation(automationConfig);

            set({
              automationId,
              isSaving: false,
              lastSaved: new Date(),
              hasUnsavedChanges: false,
              // The saved YAML is what future traces will reference; re-derive
              // the path map from it so it tracks the just-saved structure.
              tracePathMap: await deriveTracePathMap(automationConfig),
            });

            return automationId;
          } catch (error) {
            set({ isSaving: false });
            throw error;
          }
        },

        updateAutomation: async (hassApi: HomeAssistant) => {
          const state = get();
          const api = getHomeAssistantAPI(hassApi);

          if (!state.automationId) {
            throw new Error('No automation ID set. Use saveAutomation() for new automations.');
          }

          console.log('Flow: Updating automation with ID from store:', state.automationId);

          set({ isSaving: true });

          try {
            // Validate all nodes first
            get().validateAllNodes();

            // Check for validation errors
            const currentState = get();
            if (currentState.nodeErrors.size > 0) {
              const errorCount = currentState.nodeErrors.size;
              throw new Error(
                `Cannot save: ${errorCount} node(s) have validation errors. Fix the highlighted nodes before saving.`
              );
            }

            // Convert flow to graph
            const graph = state.toFlowGraph();

            // Check for empty automation
            if (graph.nodes.length === 0) {
              throw new Error(
                'Cannot save empty automation. Please add at least one trigger and one action node.'
              );
            }

            // Check for minimum required nodes
            const triggers = graph.nodes.filter((n) => n.type === 'trigger');
            const actions = graph.nodes.filter((n) => n.type === 'action');

            if (triggers.length === 0) {
              throw new Error(
                'Automation must have at least one trigger node. Please add a trigger from the node palette.'
              );
            }

            if (actions.length === 0) {
              throw new Error(
                'Automation must have at least one action node. Please add an action from the node palette.'
              );
            }

            const transpiler = new FlowTranspiler();

            // Validate first
            const validation = transpiler.validate(graph);
            if (validation.errors.length > 0) {
              throw new Error(
                `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`
              );
            }

            // Transpile to automation config
            const result = transpiler.transpile(graph);
            if (!result.success || !result.output?.automation) {
              throw new Error('Failed to transpile flow to automation config');
            }

            // Update automation in Home Assistant
            const automationConfig = {
              alias: state.flowName,
              description: state.flowDescription || '',
              ...result.output.automation,
              variables: {
                ...(result.output.automation.variables || {}),
                _cafe_metadata: {
                  version: 1,
                  strategy: 'native' as const,
                  nodes: graph.nodes.reduce(
                    (acc, node) => {
                      acc[node.id] = {
                        x: node.position.x,
                        y: node.position.y,
                      };
                      return acc;
                    },
                    {} as Record<string, { x: number; y: number }>
                  ),
                  graph_id: graph.id,
                  graph_version: 1,
                },
              },
            };

            await api.updateAutomation(state.automationId, automationConfig);

            set({
              isSaving: false,
              lastSaved: new Date(),
              hasUnsavedChanges: false,
              tracePathMap: await deriveTracePathMap(automationConfig),
            });
          } catch (error) {
            set({ isSaving: false });
            throw error;
          }
        },

        startSimulation: () => set({ isSimulating: true, executionPath: [], activeNodeId: null }),
        stopSimulation: () => set({ isSimulating: false, activeNodeId: null }),
        setActiveNode: (nodeId) => set({ activeNodeId: nodeId }),
        addToExecutionPath: (nodeId) =>
          set((state) => ({
            executionPath: [...state.executionPath, nodeId],
          })),
        clearExecutionPath: () => set({ executionPath: [] }),

        showTrace: (traceData) => {
          const pathMap = get().tracePathMap;
          const traceExecutionPath: string[] = [];
          const traceTimestamps: Record<string, string> = {};
          const nodeTraceStates: Record<string, NodeTraceState> = {};

          const sortedSteps = Object.values(traceData.trace)
            .flat()
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          for (let i = 0; i < sortedSteps.length; i++) {
            const step = sortedSteps[i];
            const nodeId = pathMap ? resolveTracePath(pathMap, step.path) : null;
            if (!nodeId) continue;

            if (!traceExecutionPath.includes(nodeId)) {
              traceExecutionPath.push(nodeId);
              traceTimestamps[nodeId] = step.timestamp;
            }

            // HA traces carry no per-step duration directly — approximate it
            // as the gap to the next step's timestamp (or the run's finish
            // time, for the last step). Left undefined while this step is
            // still the active/last one in a running trace.
            const nextTimestamp =
              sortedSteps[i + 1]?.timestamp ??
              (traceData.state === 'stopped' ? traceData.timestamp.finish : null);
            const durationMs = nextTimestamp
              ? Math.max(0, new Date(nextTimestamp).getTime() - new Date(step.timestamp).getTime())
              : undefined;

            const previous = nodeTraceStates[nodeId];
            nodeTraceStates[nodeId] = {
              status: getTraceStepStatus(step),
              timestamp: previous?.timestamp ?? step.timestamp,
              result: step.result,
              error: step.error ?? step.template_errors?.[0],
              visitCount: (previous?.visitCount ?? 0) + 1,
              path: previous?.path ?? step.path,
              durationMs: durationMs ?? previous?.durationMs,
            };
          }

          const lastStep = sortedSteps[sortedSteps.length - 1];
          const lastNodeId = lastStep && pathMap ? resolveTracePath(pathMap, lastStep.path) : null;
          const lastNodeState = lastNodeId ? nodeTraceStates[lastNodeId] : undefined;
          if (lastNodeId && lastNodeState && traceData.state === 'running') {
            nodeTraceStates[lastNodeId] = { ...lastNodeState, status: 'active' };
          }

          set({
            isShowingTrace: true,
            traceData,
            traceExecutionPath,
            traceTimestamps,
            nodeTraceStates,
            activeNodeId: null,
          });
        },
        hideTrace: () =>
          set({
            isShowingTrace: false,
            traceData: null,
            traceExecutionPath: [],
            traceTimestamps: {},
            nodeTraceStates: {},
            activeNodeId: null,
          }),
        clearTraceExecutionPath: () => set({ traceExecutionPath: [], traceTimestamps: {} }),
        setLiveTrace: (isLive) => set({ isLiveTrace: isLive }),
        bumpTraceRuns: () => set((state) => ({ traceRunsVersion: state.traceRunsVersion + 1 })),
        setTracePathMap: (map) => set({ tracePathMap: map }),

        setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),
        setAnimationsEnabled: (enabled) => {
          try {
            window.localStorage.setItem(ANIMATIONS_STORAGE_KEY, String(enabled));
          } catch {
            // localStorage unavailable (private browsing, etc.) — in-memory only.
          }
          set({ animationsEnabled: enabled });
        },
        getExecutionStepNumber: (nodeId) => {
          const state = get();
          // Check simulation execution path first
          if (state.isSimulating && state.executionPath.length > 0) {
            const stepIndex = state.executionPath.indexOf(nodeId);
            return stepIndex >= 0 ? stepIndex + 1 : null;
          }
          // Check trace execution path
          if (state.isShowingTrace && state.traceExecutionPath.length > 0) {
            const stepIndex = state.traceExecutionPath.indexOf(nodeId);
            return stepIndex >= 0 ? stepIndex + 1 : null;
          }
          return null;
        },

        canDeleteEdge: () => {
          // All edges are always deletable
          return true;
        },

        toFlowGraph: (): FlowGraph => {
          const state = get();
          const nodeIds = new Set(state.nodes.map((n) => n.id));

          return {
            id: state.flowId,
            name: state.flowName,
            description: state.flowDescription || undefined,
            nodes: state.nodes.map((n) => {
              // Ensure node has all required fields
              const nodeData = { ...n.data };

              // Add missing required fields for different node types
              if (n.type === 'trigger' && !nodeData.trigger) {
                console.warn(
                  `Flow: Trigger node ${n.id} missing trigger type, adding default 'state'`
                );
                nodeData.trigger = 'state';
              }

              if (n.type === 'action' && !nodeData.service) {
                console.warn(
                  `Flow: Action node ${n.id} missing service, adding default 'light.turn_on'`
                );
                nodeData.service = 'light.turn_on';
              }

              return {
                id: n.id,
                type: n.type as FlowNode['type'],
                position: n.position,
                data: nodeData as FlowNode['data'],
              };
            }) as FlowNode[],
            // Filter out orphaned edges that reference deleted nodes
            edges: state.edges
              .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
              .map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle,
                label: typeof e.label === 'string' ? e.label : undefined,
              })) as FlowEdge[],
            metadata: state.flowMetadata,
            version: 1,
            userVariables: state.userVariables,
            userTriggerVariables: state.userTriggerVariables,
          };
        },

        fromFlowGraph: (graph) => {
          const nodes = graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            // Normalize node data when loading (e.g., convert platform to trigger)
            data: normalizeNodeData(n.type, n.data as Record<string, unknown>) as FlowNodeData,
          }));
          const edges = graph.edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            label: e.label,
          }));
          const importedMetadata: FlowMetadata = {
            ...defaultFlowMetadata,
            ...graph.metadata,
          };
          // Create snapshot for comparison
          const originalSnapshot = JSON.stringify({
            flowName: graph.name,
            flowDescription: graph.description || '',
            flowMetadata: importedMetadata,
            nodes: nodes.map((n) => ({
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data,
            })),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            })),
          });
          set({
            flowId: graph.id,
            flowName: graph.name,
            flowDescription: graph.description || '',
            flowMetadata: importedMetadata,
            userVariables: graph.userVariables,
            userTriggerVariables: graph.userTriggerVariables,
            nodes,
            edges,
            selectedNodeId: null,
            // Reset save state when importing
            automationId: null,
            hasUnsavedChanges: false,
            lastSaved: null,
            originalSnapshot,
            // Any previous automation's path map is stale for this graph;
            // callers that parsed YAML set the fresh one via setTracePathMap.
            tracePathMap: null,
            nodeErrors: new Map(),
          });
          // Validate all nodes after loading
          get().validateAllNodes();
          // A freshly loaded automation shouldn't offer undo back into
          // whatever was open before it.
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        openAutomationById: async (id) => {
          const api = getHomeAssistantAPI();
          if (!api.isConnected()) {
            throw new Error('Not connected to Home Assistant');
          }
          const config = await api.getAutomationConfigWithFallback(id);
          get().reset();
          if (config) {
            const yamlString = yamlDump(config, {
              indent: 2,
              lineWidth: -1,
              quotingType: '"',
              forceQuotes: false,
            });
            const transpiler = new FlowTranspiler();
            const result = await transpiler.fromYaml(yamlString);
            if (!result.success || !result.graph) {
              throw new Error(result.errors?.join('\n') || 'Failed to parse automation YAML');
            }
            get().fromFlowGraph(result.graph);
            get().setTracePathMap(result.nodePathMap ?? null);
          }
          const alias = typeof config?.alias === 'string' && config.alias ? config.alias : id;
          get().setFlowName(alias);
          get().setAutomationId(id);
        },

        reset: () => {
          set({
            ...initialState,
            flowId: generateUUID(),
            flowMetadata: { ...defaultFlowMetadata },
            originalSnapshot: null,
            nodeErrors: new Map(),
          });
          cancelPendingHistoryCommit();
          useFlowStore.temporal.getState().clear();
        },

        autoArrange: async (direction) => {
          const state = get();
          if (state.nodes.length === 0) return;
          set({ isArranging: true });
          try {
            const graph = state.toFlowGraph();
            const positioned = await applyHeuristicLayout(graph.nodes, graph.edges, {
              direction: direction ?? 'RIGHT',
              spacing: { rank: 48, inRank: 24 },
            });
            const positionById: Record<string, { x: number; y: number }> = Object.fromEntries(
              positioned.map((n) => [n.id, n.position])
            );
            set((s) => ({
              nodes: s.nodes.map((n) => {
                const pos = positionById[n.id];
                return pos && (pos.x !== n.position.x || pos.y !== n.position.y)
                  ? { ...n, position: pos }
                  : n;
              }),
              hasUnsavedChanges: true,
            }));
          } finally {
            const reducedMotion =
              typeof window !== 'undefined' &&
              window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (reducedMotion) {
              set({ isArranging: false });
            } else {
              setTimeout(() => set({ isArranging: false }), 220);
            }
          }
        },

        // Node validation
        validateNode: (nodeId) => {
          const state = get();
          const node = state.nodes.find((n) => n.id === nodeId);
          if (!node || !node.type) return;

          const errors = validateNodeData(node.type, node.data as Record<string, unknown>);

          set((s) => {
            const newErrors = new Map(s.nodeErrors);
            if (errors.length > 0) {
              newErrors.set(nodeId, errors);
            } else {
              newErrors.delete(nodeId);
            }
            return { nodeErrors: newErrors };
          });
        },

        validateAllNodes: () => {
          const state = get();
          const newErrors = new Map<string, NodeValidationError[]>();

          for (const node of state.nodes) {
            if (!node.type) continue;
            const errors = validateNodeData(node.type, node.data as Record<string, unknown>);
            if (errors.length > 0) {
              newErrors.set(node.id, errors);
            }
          }

          set({ nodeErrors: newErrors });
        },

        clearNodeErrors: (nodeId) => {
          set((s) => {
            const newErrors = new Map(s.nodeErrors);
            newErrors.delete(nodeId);
            return { nodeErrors: newErrors };
          });
        },

        hasValidationErrors: () => {
          return get().nodeErrors.size > 0;
        },
      }),
      {
        partialize: temporalSelector,
        limit: 100,
        // Without this, zundo pushes a history entry on *every* set() call
        // regardless of whether the tracked (partialized) fields actually
        // changed — so UI-only actions like selectNode/setClipboard, which
        // never touch nodes/edges/flowName/etc., would still create no-op
        // undo steps. Shallow-compares the partialized fields; nodes/edges
        // get new array references on every real structural change, so this
        // only skips truly no-op sets.
        equality: shallow,
        // Coalesces bursts of rapid changes (every pointer-move frame of a
        // node drag, a run of keystrokes, an add-then-immediately-edit) into
        // ONE history entry spanning the whole burst, not just its last
        // step. A plain trailing-edge debounce would only keep the *last*
        // call's `pastState` — the state just before that final call —
        // silently discarding the earlier steps' undo information, so
        // undoing would only jump back one micro-step instead of to before
        // the burst started. This remembers the *first* call's `pastState`
        // for the duration of the burst and only actually commits 300ms
        // after it goes quiet. Only the trigger for committing a snapshot is
        // delayed; the live store state itself updates immediately.
        handleSet: (handleSet) => (pastStateArg: FlowState | ((state: FlowState) => FlowState)) => {
          // zundo's own .d.ts mistypes this parameter as `FlowState |
          // ((state: FlowState) => FlowState)` — an artifact of `Parameters<>`
          // only resolving the *last* overload of zustand's own overloaded
          // `setState`. Verified against zundo/dist/index.js's
          // `temporalHandleSet`: at runtime this is always
          // `options.partialize(get())`, i.e. our own `temporalSelector`
          // output — a genuine `TemporalFlowState`.
          const pastState = pastStateArg as unknown as TemporalFlowState;
          const burstStart = pendingHistoryCommit?.burstStart ?? pastState;
          cancelPendingHistoryCommit();
          const timeoutId = setTimeout(() => {
            pendingHistoryCommit = undefined;
            handleSet(burstStart);
          }, 300);
          pendingHistoryCommit = { timeoutId, burstStart };
        },
      }
    ),
    {
      name: 'flow-editor-storage',
      storage: flowIndexedDBStorage,
      partialize: persistSelector,
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Normalize node data after rehydration (e.g., convert platform to trigger)
          const normalizedNodes = state.nodes.map((n) => ({
            ...n,
            data: n.type
              ? (normalizeNodeData(n.type, n.data as Record<string, unknown>) as FlowNodeData)
              : n.data,
          }));

          // Update nodes if any were normalized
          const hasChanges = normalizedNodes.some(
            (n, i) => JSON.stringify(n.data) !== JSON.stringify(state.nodes[i].data)
          );
          if (hasChanges) {
            state.nodes = normalizedNodes;
          }

          // Validate all nodes after normalization
          state.validateAllNodes();
        }
      },
    }
  )
);
