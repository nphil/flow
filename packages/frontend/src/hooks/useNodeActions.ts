import { useReactFlow } from '@xyflow/react';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAlignBottomAction,
  getAlignLeftAction,
  getAlignRightAction,
  getAlignTopAction,
  getCopyAction,
  getCutAction,
  getDeleteAction,
  getDisconnectAction,
  getDuplicateAction,
  getPasteAction,
  getRedoAction,
  getSelectAllAction,
  getToggleEnabledAction,
  getUndoAction,
  type NodeAction,
  type NodeActionContext,
} from '@/components/actions';
import { FIT_VIEW_MANUAL } from '@/lib/viewport';
import { type FlowState, useFlowStore } from '@/store/flow-store';
import { isMacOS } from '@/utils/useAgentPlatform';
import { useUndoRedo } from './useUndoRedo';

/** Display order for action groups in the header toolbar and its overflow menu. */
export const ACTION_GROUP_ORDER = [
  'history',
  'clipboard',
  'selection',
  'edit',
  'align',
  'delete',
] as const;

export type ActionGroupName = (typeof ACTION_GROUP_ORDER)[number];

/**
 * Builds a NodeActionContext from the store's *current* state. Always called
 * at the moment an action runs (click or keydown), never captured in a
 * closure, so position-sensitive actions (align) can't see stale drags.
 */
export function buildActionContext(
  undo: () => void = () => undefined,
  redo: () => void = () => undefined
): NodeActionContext {
  const s = useFlowStore.getState();
  const temporal = useFlowStore.temporal.getState();
  return {
    selectedNodes: s.nodes.filter((n) => n.selected),
    nodes: s.nodes,
    edges: s.edges,
    clipboard: s.clipboard,
    pasteCount: s.pasteCount,
    addNode: s.addNode,
    removeNode: s.removeNode,
    updateNodeData: s.updateNodeData,
    setNodes: s.setNodes,
    setEdges: s.setEdges,
    setClipboard: s.setClipboard,
    setPasteCount: s.setPasteCount,
    undo,
    redo,
    canUndo: temporal.pastStates.length > 0,
    canRedo: temporal.futureStates.length > 0,
  };
}

/** Formats a `ctrl+shift+x` shortcut string for display in tooltips. */
export function formatShortcut(shortcut: string, t: TFunction): string {
  const isMac = isMacOS();

  return shortcut
    .split('+')
    .map((part) => {
      if (part === 'ctrl') return isMac ? t('shortcuts.cmd') : t('shortcuts.ctrl');
      if (part === 'shift') return t('shortcuts.shift');
      if (part === 'alt') return t('shortcuts.alt');
      if (part === 'arrowup') return t('shortcuts.arrowUp');
      if (part === 'arrowdown') return t('shortcuts.arrowDown');
      if (part === 'arrowleft') return t('shortcuts.arrowLeft');
      if (part === 'arrowright') return t('shortcuts.arrowRight');
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('+');
}

/**
 * Selection signature: which nodes are selected and whether each is enabled
 * (the toggle-enabled action swaps its icon on that). A primitive string, so
 * per-frame drag updates (new nodes array, same selection) don't re-render
 * subscribers — only genuine selection/enabled changes do.
 */
const selectionSignature = (s: FlowState): string => {
  let sig = '';
  for (const n of s.nodes) {
    if (n.selected) sig += `${n.id}:${n.data.enabled === false ? 0 : 1};`;
  }
  return sig;
};

export interface UseNodeActionsResult {
  /** Actions keyed by their toolbar group. */
  actionsByGroup: Record<string, NodeAction[]>;
  /**
   * Context for *render-time* reads (isEnabled / getIcon / tooltip). Rebuilt
   * whenever selection, edges, clipboard, or history state change; NOT
   * per-frame during drags, so never use it to execute an action.
   */
  renderContext: NodeActionContext;
  /** Executes an action against a freshly built context. */
  runAction: (action: NodeAction) => void;
  /** Number of nodes currently on the internal clipboard (paste badge). */
  clipboardNodeCount: number;
  /** Formatted primary shortcut for an action, e.g. "Ctrl+Shift+L". */
  shortcutLabel: (action: NodeAction) => string | undefined;
}

/**
 * The canvas node-action system behind the header toolbar (design doc §4):
 * the action list, grouped; render state for enabled/disabled treatment; and
 * the global keyboard shortcuts, including Escape (clear selection) and
 * Shift+1 (zoom to fit).
 *
 * Mount exactly once (the Header does) — a second mount would double-run
 * every shortcut.
 */
export function useNodeActions(): UseNodeActionsResult {
  const { t } = useTranslation();
  const { undo, redo, canUndo, canRedo } = useUndoRedo();
  const { fitView } = useReactFlow();

  // Narrow render subscriptions: selection membership (string), edges array
  // (identity is stable across node drags), clipboard, and paste count.
  const selectionSig = useFlowStore(selectionSignature);
  const edges = useFlowStore((s) => s.edges);
  const clipboard = useFlowStore((s) => s.clipboard);
  const pasteCount = useFlowStore((s) => s.pasteCount);

  // The full action catalog. New actions should be added here as needed!
  const allActions = useMemo(
    () => [
      getUndoAction(t),
      getRedoAction(t),
      getDuplicateAction(t),
      getCopyAction(t),
      getCutAction(t),
      getPasteAction(t),
      getSelectAllAction(t),
      getToggleEnabledAction(t),
      getDisconnectAction(t),
      getAlignLeftAction(t),
      getAlignRightAction(t),
      getAlignTopAction(t),
      getAlignBottomAction(t),
      getDeleteAction(t),
    ],
    [t]
  );

  // The deps are external re-render triggers for a getState()-based rebuild,
  // not values read inside the factory (see selectionSignature above).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  const renderContext = useMemo(
    () => buildActionContext(undo, redo),
    [selectionSig, edges, clipboard, pasteCount, canUndo, canRedo, undo, redo]
  );

  const runAction = useCallback(
    (action: NodeAction) => {
      const context = buildActionContext(undo, redo);
      if (action.isEnabled && !action.isEnabled(context)) return;
      action.execute(context);
    },
    [undo, redo]
  );

  // Global keyboard shortcuts. Context is rebuilt per keypress, so the
  // handler itself only re-registers when the action list changes.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing in an input field
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Escape clears the canvas selection (and with it the Properties
      // panel's node focus). Only when the canvas/body owns the event —
      // dialogs, menus, and popovers keep their own Escape semantics.
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        if (target !== document.body && !target.closest('.react-flow')) return;
        const s = useFlowStore.getState();
        const hasSelectedNodes = s.nodes.some((n) => n.selected);
        const hasSelectedEdges = s.edges.some((e) => e.selected);
        if (!hasSelectedNodes && !hasSelectedEdges && s.selectedNodeId === null) return;
        event.preventDefault();
        if (hasSelectedNodes) {
          s.setNodes(s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)));
        }
        if (hasSelectedEdges) {
          s.setEdges(s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)));
        }
        if (s.selectedNodeId !== null) s.selectNode(null);
        return;
      }

      // Shift+1: zoom to fit (event.code — Shift+1 types "!" on many layouts).
      if (
        event.shiftKey &&
        event.code === 'Digit1' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        fitView({ ...FIT_VIEW_MANUAL, duration: 220 });
        return;
      }

      const isMac = isMacOS();
      const modifier = isMac ? event.metaKey : event.ctrlKey;

      // Build shortcut string from event
      let shortcut = '';
      if (modifier) shortcut += 'ctrl+';
      if (event.shiftKey) shortcut += 'shift+';
      if (event.altKey) shortcut += 'alt+';
      shortcut += event.key.toLowerCase();

      const context = buildActionContext(undo, redo);
      const action = allActions.find((a) => {
        if (!a.shortcut) return false;
        const shortcuts = Array.isArray(a.shortcut) ? a.shortcut : [a.shortcut];
        if (!shortcuts.includes(shortcut)) return false;
        return a.isEnabled ? a.isEnabled(context) : true;
      });

      if (action) {
        event.preventDefault();
        action.execute(context);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allActions, fitView, undo, redo]);

  const actionsByGroup = useMemo(() => {
    const groups: Record<string, NodeAction[]> = {};
    for (const action of allActions) {
      const group = action.group || 'node-specific';
      if (!groups[group]) groups[group] = [];
      groups[group].push(action);
    }
    return groups;
  }, [allActions]);

  const clipboardNodeCount = useMemo(() => {
    if (!clipboard) return 0;
    try {
      return JSON.parse(clipboard).nodes?.length || 0;
    } catch {
      return 0;
    }
  }, [clipboard]);

  const shortcutLabel = useCallback(
    (action: NodeAction) => {
      if (!action.shortcut) return undefined;
      const first = Array.isArray(action.shortcut) ? action.shortcut[0] : action.shortcut;
      return formatShortcut(first, t);
    },
    [t]
  );

  return { actionsByGroup, renderContext, runAction, clipboardNodeCount, shortcutLabel };
}
