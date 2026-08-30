import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  useReactFlow,
} from '@xyflow/react';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useFlowStore } from '@/store/flow-store';

export interface DeletableEdgeData {
  /** Branch alias / true-false chip text, rendered as a mono pill at the path midpoint. */
  branchLabel?: string;
  /** Executed in the currently-shown live trace or manual simulation (static accent highlight). */
  isActive?: boolean;
  /** `isActive` AND within the animation cap AND motion isn't paused/disabled (design doc §13). */
  animated?: boolean;
  /** The single most-recently-executed edge in the run — gets the traveling packet dot. */
  isMostRecent?: boolean;
  /**
   * Asks FlowCanvas to open the quick-add picker to splice a node into this
   * edge (the hover "+"). Injected per-render by FlowCanvas's styledEdges
   * memo — derived view state, never persisted.
   */
  onInsertRequest?: (
    edgeId: string,
    screen: { x: number; y: number },
    flow: { x: number; y: number }
  ) => void;
  [key: string]: unknown;
}

/**
 * Default edge (design doc §5): smooth bezier at curvature .35, 1.75px
 * `--border` at rest, `--accent` on hover/selected (pure CSS, see
 * index.css's `.react-flow__edge` rules). Executed-path edges get a static
 * accent highlight (`data.isActive`); when additionally `data.animated`
 * (design doc §13's cap/pause-aware flag), that highlight also dash-flows,
 * and the single `data.isMostRecent` edge gets a traveling packet dot — both
 * pure CSS (stroke-dashoffset / offset-distance), no JS ticking. Branch-
 * labeled edges (choose alias / condition true-false) get a chip pill at the
 * midpoint. Hovering or selecting the edge reveals a midpoint "+" to insert
 * a node inline; selection additionally shows the delete button.
 */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const { t } = useTranslation('common');
  const { setEdges } = useReactFlow();
  const setUnsavedChanges = useFlowStore((state) => state.setUnsavedChanges);
  const canDeleteEdge = useFlowStore((state) => state.canDeleteEdge);
  const edgeData = data as DeletableEdgeData | undefined;
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.35,
  });

  const canDelete = canDeleteEdge(id);
  const canInsert = Boolean(edgeData?.onInsertRequest);
  const showInsert = canInsert && (hovered || selected);
  const showDelete = Boolean(selected && canDelete);
  // With both buttons visible they flank the midpoint; alone, each centers on it.
  const insertOffsetX = showDelete ? -14 : 0;
  const deleteOffsetX = showInsert ? 14 : 0;
  const buttonOffsetY = edgeData?.branchLabel ? 18 : 0;

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!canDelete) return;
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
    setUnsavedChanges(true);
  };

  const handleInsert = (event: React.MouseEvent) => {
    event.stopPropagation();
    edgeData?.onInsertRequest?.(
      id,
      { x: event.clientX, y: event.clientY },
      { x: labelX, y: labelY }
    );
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={cn(
          'flow-edge-path',
          edgeData?.isActive && 'flow-edge-highlighted',
          edgeData?.animated && 'flow-edge-active'
        )}
      />

      {/* Invisible widened twin of the path purely for hover detection — the
          EdgeLabelRenderer content below portals OUTSIDE this edge's <g>, so
          CSS :hover on the edge can't reach it. */}
      {canInsert && (
        // biome-ignore lint/a11y/noStaticElementInteractions: hover detection only — the revealed "+" is a real, focusable button
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      )}

      {edgeData?.isMostRecent && (
        <circle r={3} className="flow-edge-packet" style={{ offsetPath: `path("${edgePath}")` }} />
      )}

      {edgeData?.branchLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border border-flow-border bg-flow-panel px-1.5 py-0.5 font-mono text-[10px] text-flow-text-secondary shadow-flow-card"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeData.branchLabel}
          </div>
        </EdgeLabelRenderer>
      )}

      {showInsert && (
        <EdgeLabelRenderer>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps the hover state alive while the pointer crosses onto the button */}
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX + insertOffsetX}px, ${labelY + buttonOffsetY}px)`,
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={handleInsert}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-flow-border bg-flow-elevated text-flow-text-muted shadow-flow-card transition-all duration-flow-fast ease-flow-warm hover:scale-110 hover:border-flow-accent hover:text-flow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-flow-accent"
              title={t('toolbar.insertNode')}
              aria-label={t('toolbar.insertNode')}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}

      {showDelete && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX + deleteOffsetX}px, ${labelY + buttonOffsetY}px)`,
            }}
          >
            <button
              onClick={handleDelete}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-flow-danger bg-flow-elevated text-flow-danger shadow-flow-card transition-transform duration-flow-fast ease-flow-warm hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-flow-accent"
              title={t('toolbar.deleteConnection')}
              aria-label={t('toolbar.deleteConnection')}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
