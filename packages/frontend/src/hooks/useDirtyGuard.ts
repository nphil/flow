import { useCallback, useState } from 'react';
import { useFlowStore } from '@/store/flow-store';

export interface DirtyGuard {
  /** Live "does the canvas have unsaved changes" flag, for callers with their own guard predicate (e.g. `planAutomationOpen`). */
  isDirty: boolean;
  /** True while a guarded action is queued behind the confirmation dialog. */
  isPending: boolean;
  /** Runs `action` immediately if the canvas is clean, otherwise queues it behind the guard. */
  guard: (action: () => void) => void;
  /** Unconditionally queues `action` behind the guard dialog, skipping the isDirty check. */
  requestConfirm: (action: () => void) => void;
  /** Runs the queued action (Discard, or after a successful Save) and clears the guard. */
  proceed: () => void;
  /** Drops the queued action without running it (Cancel). */
  cancel: () => void;
}

/**
 * Shared "you have unsaved changes" gate for every action that would replace canvas content:
 * opening a different automation, starting a new one, or applying an import (design doc §0/§4).
 * Renders nothing -- pair with `<DirtyGuardDialog>` wired to the returned state.
 */
export function useDirtyGuard(): DirtyGuard {
  const isDirty = useFlowStore((s) => s.isDirty());
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const requestConfirm = useCallback((action: () => void) => {
    setPendingAction(() => action);
  }, []);

  const guard = useCallback(
    (action: () => void) => {
      if (isDirty) {
        requestConfirm(action);
      } else {
        action();
      }
    },
    [isDirty, requestConfirm]
  );

  const proceed = useCallback(() => {
    setPendingAction((current) => {
      current?.();
      return null;
    });
  }, []);

  const cancel = useCallback(() => setPendingAction(null), []);

  return { isDirty, isPending: pendingAction !== null, guard, requestConfirm, proceed, cancel };
}
