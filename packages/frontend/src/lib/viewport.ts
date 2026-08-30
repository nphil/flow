import type { FitViewOptions } from '@xyflow/react';

/**
 * Fit-view policy when content lands on the canvas (initial mount, opening an
 * automation, importing YAML): prioritize readable node text over seeing the
 * whole graph. Large graphs open at 0.85 zoom minimum and pan for the rest
 * instead of shrinking every label below legibility; small graphs cap at 1:1
 * so a couple of nodes never balloon to fill the screen.
 */
export const FIT_VIEW_OPEN: FitViewOptions = { padding: 0.15, minZoom: 0.85, maxZoom: 1 };

/**
 * Fit-view policy for an explicit user request (toolbar button, Shift+1,
 * post-arrange): show the entire graph, however small that makes it, but
 * still never zoom past 1:1.
 */
export const FIT_VIEW_MANUAL: FitViewOptions = { padding: 0.15, maxZoom: 1 };
