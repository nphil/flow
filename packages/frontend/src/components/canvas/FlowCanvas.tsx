import type { OnBeforeDelete, OnConnectEnd } from '@xyflow/react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  type EdgeTypes,
  MarkerType,
  MiniMap,
  type NodeTypes,
  type OnSelectionChangeParams,
  Panel,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { LayoutGrid, Lock, LockOpen } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickAddMenu, type QuickAddPosition } from '@/components/canvas/QuickAddMenu';
import { DeletableEdge } from '@/components/edges';
import {
  ActionNode,
  ConditionNode,
  DelayNode,
  SetVariablesNode,
  TriggerNode,
  WaitNode,
} from '@/components/nodes';
import type { NodeCatalogEntry } from '@/components/nodes/catalog';
import { NodeToolbar } from '@/components/toolbar/NodeToolbar';
import { useFlowTheme } from '@/hooks/useFlowTheme';
import { buildQuickAddConnection, type QuickAddDirection } from '@/lib/quick-add';
import { generateNodeId } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';
import { isMacOS } from '@/utils/useAgentPlatform';

interface QuickAddState {
  screenPosition: QuickAddPosition;
  flowPosition: { x: number; y: number };
  fromNodeId: string;
  fromHandleId: string | null;
  direction: QuickAddDirection;
}

// New node types should be added here as needed!
const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
  delay: DelayNode,
  wait: WaitNode,
  set_variables: SetVariablesNode,
};

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
};

const NEW_NODE_WIDTH = 220;
const NEW_NODE_HEIGHT = 90;

export function FlowCanvas() {
  const { t } = useTranslation(['common', 'debug']);
  const { mode } = useFlowTheme();
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
    addNode,
    isSimulating,
    executionPath,
    isShowingTrace,
    traceExecutionPath,
    nodeTraceStates,
    traceData,
    canDeleteEdge,
    isArranging,
    autoArrange,
    animationsEnabled,
  } = useFlowStore();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, setViewport, fitView } = useReactFlow();
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [interactive, setInteractive] = useState(true);
  // Live-flow motion pause conditions (design doc §13): tab hidden or
  // canvas being dragged/zoomed. Both are discrete start/end events, not a
  // per-tick loop — feed a CSS class (`.flow-motion-active` below) so the
  // dash-flow/packet-dot keyframes themselves stay pure CSS.
  const [tabHidden, setTabHidden] = useState(() =>
    typeof document === 'undefined' ? false : document.hidden
  );
  const [interacting, setInteracting] = useState(false);

  useEffect(() => {
    const onVisibilityChange = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const motionActive = animationsEnabled && !tabHidden && !interacting;

  // Dropping a dragged connection on empty canvas offers a quick-add menu
  // instead of just discarding it — see QuickAddMenu.tsx.
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      // A real (or attempted, near-a-handle) connection was involved —
      // xyflow already handled it, nothing for us to do.
      if (connectionState.toNode || !connectionState.fromHandle || !connectionState.fromNode) {
        return;
      }
      // Released outside the canvas entirely (e.g. over the node palette).
      const targetEl = event.target as Element | null;
      if (!targetEl?.closest?.('.react-flow__pane')) return;

      const point = 'changedTouches' in event ? event.changedTouches[0] : event;
      if (!point) return;

      const flowPosition = screenToFlowPosition({ x: point.clientX, y: point.clientY });

      setQuickAdd({
        screenPosition: { screenX: point.clientX, screenY: point.clientY },
        flowPosition,
        fromNodeId: connectionState.fromHandle.nodeId,
        fromHandleId: connectionState.fromHandle.id ?? null,
        direction: connectionState.fromHandle.type === 'source' ? 'forward' : 'backward',
      });
    },
    [screenToFlowPosition]
  );

  const closeQuickAdd = useCallback(() => setQuickAdd(null), []);

  const handleQuickAddSelect = useCallback(
    (entry: NodeCatalogEntry) => {
      if (!quickAdd) return;
      const newNode = {
        id: generateNodeId(entry.kind),
        type: entry.kind,
        position: {
          x: quickAdd.flowPosition.x - NEW_NODE_WIDTH / 2,
          y: quickAdd.flowPosition.y - NEW_NODE_HEIGHT / 2,
        },
        data: { ...entry.defaultData },
      };
      addNode(newNode);
      onConnect(
        buildQuickAddConnection(
          quickAdd.direction,
          quickAdd.fromNodeId,
          quickAdd.fromHandleId,
          newNode.id
        )
      );
      setQuickAdd(null);
    },
    [quickAdd, addNode, onConnect]
  );

  // Set initial zoom level
  useEffect(() => {
    setViewport({ x: 0, y: 0, zoom: 0.75 });
  }, [setViewport]);

  // Auto-arrange (design doc §5): the store animates positions via CSS while
  // `isArranging` is true (see index.css's `.flow-arranging` rule below);
  // once it flips back to false the layout has settled, so fit the viewport
  // to the result. Centralized here so it fires identically whether the
  // header or the canvas control triggered the arrange.
  const wasArrangingRef = useRef(false);
  useEffect(() => {
    const wasArranging = wasArrangingRef.current;
    wasArrangingRef.current = isArranging;
    if (wasArranging && !isArranging) {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      fitView({ padding: 0.15, duration: reducedMotion ? 0 : 220 });
    }
  }, [isArranging, fitView]);

  const handleAutoArrange = useCallback(() => {
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const aspect = bounds && bounds.height > 0 ? bounds.width / bounds.height : 1;
    autoArrange(aspect >= 1 ? 'RIGHT' : 'DOWN');
  }, [autoArrange]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      if (selectedNodes.length === 1) {
        selectNode(selectedNodes[0].id);
      } else {
        selectNode(null);
      }
    },
    [selectNode]
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Prevent deletion of edges that would leave a condition node with no outgoing connections
  const onBeforeDelete = useCallback<OnBeforeDelete>(
    async ({ nodes: nodesToDelete, edges: edgesToDelete }) => {
      const allowedEdges = edgesToDelete.filter((edge) => canDeleteEdge(edge.id));
      return { nodes: nodesToDelete, edges: allowedEdges };
    },
    [canDeleteEdge]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const data = event.dataTransfer.getData('application/reactflow');
      if (!data) return;

      try {
        const { type, defaultData } = JSON.parse(data);

        // Get the position where the node was dropped
        const dropPosition = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        // Center the node at the cursor position by offsetting by half node dimensions
        const position = {
          x: dropPosition.x - NEW_NODE_WIDTH / 2,
          y: dropPosition.y - NEW_NODE_HEIGHT / 2,
        };

        const newNode = {
          id: generateNodeId(type),
          type,
          position,
          data: { ...defaultData },
        };

        addNode(newNode);
      } catch (err) {
        console.error('Failed to parse dropped node data:', err);
      }
    },
    [screenToFlowPosition, addNode]
  );

  const isTraceRunning = traceData?.state === 'running';

  // Node type lookup for handle-aware trace edge lighting
  const nodeTypeById = useMemo(() => {
    const byId: Record<string, string | undefined> = {};
    for (const node of nodes) byId[node.id] = node.type;
    return byId;
  }, [nodes]);

  // Style edges based on simulation state, trace state, and selected node.
  // Actual stroke/hover/selected coloring lives in CSS (index.css's
  // `.react-flow__edge` rules) — this derives: whether the edge is part of
  // an execution path (`isActive`, static accent highlight), whether it
  // should additionally get the animated dash-flow (`animated` — gated by
  // the motion-pause conditions above and capped at 24 concurrent per
  // design doc §13), which single edge gets the traveling packet dot
  // (`isMostRecent`), and its branch-label chip text.
  const styledEdges = useMemo(() => {
    // Which node was most recently entered — its incoming edge gets the
    // single packet dot (design doc §13: one dot total, not one per edge).
    const mostRecentNodeId = isSimulating
      ? executionPath[executionPath.length - 1]
      : isShowingTrace
        ? traceExecutionPath[traceExecutionPath.length - 1]
        : undefined;

    const withActivity = edges.map((edge) => {
      const sourceIdx = executionPath.indexOf(edge.source);
      const targetIdx = executionPath.indexOf(edge.target);

      const isActiveInSimulation =
        isSimulating &&
        executionPath.length >= 2 &&
        sourceIdx !== -1 &&
        targetIdx !== -1 &&
        targetIdx === sourceIdx + 1;

      // Trace lighting is handle-aware: an edge is lit iff both endpoints
      // were visited and — for condition sources — the edge leaves the
      // handle matching the recorded condition result. Unknown results
      // fall back to lighting every visited branch.
      const sourceTrace = nodeTraceStates[edge.source];
      const targetTrace = nodeTraceStates[edge.target];
      let isActiveInTrace = false;
      if (isShowingTrace && sourceTrace && targetTrace) {
        const conditionResult = sourceTrace.result?.result;
        isActiveInTrace =
          nodeTypeById[edge.source] === 'condition' && typeof conditionResult === 'boolean'
            ? edge.sourceHandle === (conditionResult ? 'true' : 'false')
            : true;
      }

      const isActive = isActiveInSimulation || (isActiveInTrace && isTraceRunning);
      const isMostRecent = isActive && edge.target === mostRecentNodeId;

      const branchLabel =
        typeof edge.label === 'string' && edge.label
          ? edge.label
          : nodeTypeById[edge.source] === 'condition' && edge.sourceHandle
            ? edge.sourceHandle === 'true'
              ? 'True'
              : edge.sourceHandle === 'false'
                ? 'False'
                : undefined
            : undefined;

      return { edge, isActive, isMostRecent, branchLabel };
    });

    // Cap simultaneously *animated* edges at 24 (design doc §13); beyond
    // that, still light up as executed but without motion. The most-recent
    // edge always gets a slot first so the packet dot never silently drops.
    const activeIndices = withActivity
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.isActive)
      .sort((a, b) => Number(b.item.isMostRecent) - Number(a.item.isMostRecent));
    const animatedIndexSet = new Set(activeIndices.slice(0, 24).map(({ index }) => index));

    return withActivity.map(({ edge, isActive, isMostRecent, branchLabel }, index) => {
      const animated = motionActive && animatedIndexSet.has(index);
      return {
        ...edge,
        type: 'deletable',
        data: {
          ...edge.data,
          isActive,
          branchLabel,
          animated,
          isMostRecent: isMostRecent && animated,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? 'var(--accent)' : 'var(--border)',
        },
      };
    });
  }, [
    edges,
    isSimulating,
    executionPath,
    isShowingTrace,
    traceExecutionPath,
    nodeTraceStates,
    nodeTypeById,
    isTraceRunning,
    motionActive,
  ]);

  return (
    <div className="h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        colorMode={mode}
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onBeforeDelete={onBeforeDelete}
        onSelectionChange={onSelectionChange}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMoveStart={() => setInteracting(true)}
        onMoveEnd={() => setInteracting(false)}
        onNodeDragStart={() => setInteracting(true)}
        onNodeDragStop={() => setInteracting(false)}
        panOnScroll={isMacOS()}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        elementsSelectable={interactive}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'deletable',
          markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border)' },
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.75 }}
        maxZoom={2}
        minZoom={0.3}
        fitView
        fitViewOptions={{ maxZoom: 0.75 }}
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={null}
        className={isArranging ? 'flow-arranging' : undefined}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="color-mix(in srgb, var(--text) 6%, transparent)"
        />
        <Controls showInteractive={false}>
          <ControlButton
            onClick={handleAutoArrange}
            title={t('debug:canvas.autoArrange', { defaultValue: 'Auto-arrange' })}
            disabled={nodes.length === 0 || isArranging}
          >
            <LayoutGrid />
          </ControlButton>
          <ControlButton
            onClick={() => setInteractive((prev) => !prev)}
            title={t('debug:canvas.toggleLock', { defaultValue: 'Toggle interactivity' })}
          >
            {interactive ? <LockOpen /> : <Lock />}
          </ControlButton>
        </Controls>
        <MiniMap
          nodeStrokeWidth={2}
          zoomable
          pannable
          nodeColor={(node) => {
            switch (node.type) {
              case 'trigger':
                return 'var(--node-trigger)';
              case 'condition':
                return 'var(--node-condition)';
              case 'action':
                return 'var(--node-action)';
              case 'delay':
              case 'wait':
                return 'var(--node-timing)';
              case 'set_variables':
                return 'var(--node-data)';
              default:
                return 'var(--node-unknown)';
            }
          }}
          maskColor="color-mix(in srgb, var(--bg) 65%, transparent)"
        />

        <NodeToolbar />

        {isSimulating && (
          <Panel
            position="top-left"
            className="!m-3 flex items-center gap-2 rounded-flow-control border border-flow-accent bg-flow-elevated px-3 py-1.5 font-mono text-flow-text text-xs shadow-flow-pop"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-flow-accent" />
            {t('debug:simulation.simulatingExecution')}
          </Panel>
        )}

        {isShowingTrace && !isSimulating && (
          <Panel
            position="top-left"
            className="!m-3 flex items-center gap-2 rounded-flow-control border border-flow-warn bg-flow-elevated px-3 py-1.5 font-mono text-flow-text text-xs shadow-flow-pop"
          >
            <span className="h-2 w-2 rounded-full bg-flow-warn" />
            {t('debug:simulation.showingTraceExecution', { steps: traceExecutionPath.length })}
          </Panel>
        )}
      </ReactFlow>

      <QuickAddMenu
        position={quickAdd?.screenPosition ?? null}
        direction={quickAdd?.direction ?? 'forward'}
        onSelect={handleQuickAddSelect}
        onClose={closeQuickAdd}
      />
    </div>
  );
}
