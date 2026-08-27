import { BaseEdge, type EdgeProps, EdgeLabelRenderer, getBezierPath, useReactFlow } from '@xyflow/react';
import { X } from 'lucide-react';
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
 * midpoint. Shows a delete button on selection, same as before.
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
  const { setEdges } = useReactFlow();
  const setUnsavedChanges = useFlowStore((state) => state.setUnsavedChanges);
  const canDeleteEdge = useFlowStore((state) => state.canDeleteEdge);
  const edgeData = data as DeletableEdgeData | undefined;

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

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!canDelete) return;
    setEdges((edges) => edges.filter((edge) => edge.id !== id));
    setUnsavedChanges(true);
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

      {edgeData?.isMostRecent && (
        <circle r={3} className="flow-edge-packet" style={{ offsetPath: `path("${edgePath}")` }} />
      )}

      {edgeData?.branchLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded-full border border-flow-border bg-flow-panel px-1.5 py-0.5 font-mono text-[9px] text-flow-text-secondary shadow-flow-card"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {edgeData.branchLabel}
          </div>
        </EdgeLabelRenderer>
      )}

      {selected && canDelete && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) translate(0, ${edgeData?.branchLabel ? 18 : 0}px)`,
            }}
          >
            <button
              onClick={handleDelete}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-flow-danger bg-flow-elevated text-flow-danger shadow-flow-card transition-transform duration-flow-fast ease-flow-warm hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-flow-accent"
              title="Delete connection"
              aria-label="Delete connection"
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
