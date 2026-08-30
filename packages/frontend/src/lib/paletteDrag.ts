import type { NodeCatalogEntry } from '@/components/nodes/catalog';

/**
 * Pointer-based palette → canvas drag-and-drop.
 *
 * Deliberately NOT HTML5 drag-and-drop: native `dragstart` never fires for
 * form controls (the palette cards are real `<button>`s) in Firefox, and
 * HTML5 DnD does not exist at all for touch input — both presented as
 * "dragging does nothing". Pointer events behave identically across engines
 * and input types, and let us own the ghost and the drop-target highlight
 * instead of taking whatever the OS renders.
 *
 * Flow: `beginPaletteDrag()` on a card's `pointerdown` arms a candidate.
 * Mouse/pen drags start after a small movement threshold (a plain click
 * stays a click); touch starts after a short hold so the palette can still
 * scroll. While dragging, a fixed-position clone of the card follows the
 * pointer (transform-only — no layout work), and the element carrying
 * `data-flow-dropzone` gets `.flow-dropzone-active` (index.css) while the
 * pointer is over it. Releasing over the dropzone dispatches
 * `PALETTE_DROP_EVENT` on it with the catalog entry and the release
 * coordinates; releasing anywhere else — or Escape, `pointercancel`, window
 * blur — cancels cleanly with no node created.
 */

/** Dispatched on the `data-flow-dropzone` element when a palette card is dropped on it. */
export const PALETTE_DROP_EVENT = 'flow:palette-drop';

/** Marks the canvas wrapper as the palette-drop target (see FlowCanvas.tsx). */
export const DROPZONE_ATTR = 'data-flow-dropzone';

/** Applied to the dropzone while a dragged card is over it (index.css highlight). */
const DROPZONE_ACTIVE_CLASS = 'flow-dropzone-active';

export interface PaletteDropDetail {
  entry: NodeCatalogEntry;
  /** Pointer release position, in viewport (client) coordinates. */
  clientX: number;
  clientY: number;
}

/** Movement (px) that turns a mouse/pen press into a drag rather than a click. */
const DRAG_START_DISTANCE_PX = 5;
/** Touch: hold this long without scrolling to pick a card up. */
const TOUCH_HOLD_MS = 220;
/** Touch: moving beyond this during the hold means the user is scrolling the palette. */
const TOUCH_SLOP_PX = 8;

interface PalettePress {
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
}

/**
 * Arms a palette drag from a card's `pointerdown`. Self-contained: installs
 * its own window listeners and removes every one of them (plus the ghost and
 * any highlight) once the pointer sequence ends.
 */
export function beginPaletteDrag(
  press: PalettePress,
  entry: NodeCatalogEntry,
  source: HTMLElement
): void {
  if (press.pointerType === 'mouse' && press.button !== 0) return;

  const doc = source.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;

  const isTouch = press.pointerType === 'touch';
  const sourceRect = source.getBoundingClientRect();
  // Keep the grab point: the ghost sits under the pointer exactly where the card was gripped.
  const grabDX = press.clientX - sourceRect.x;
  const grabDY = press.clientY - sourceRect.y;

  /** A drag was started at some point in this pointer sequence (even if since cancelled). */
  let dragStarted = false;
  /** A drag is live right now (ghost visible, drop possible). */
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let dropzone: Element | null = null;
  let holdTimer = 0;
  let lastX = press.clientX;
  let lastY = press.clientY;

  const setDropzone = (next: Element | null) => {
    if (next === dropzone) return;
    dropzone?.classList.remove(DROPZONE_ACTIVE_CLASS);
    next?.classList.add(DROPZONE_ACTIVE_CLASS);
    dropzone = next;
  };

  const moveGhost = () => {
    if (ghost) {
      ghost.style.transform = `translate3d(${lastX - grabDX}px, ${lastY - grabDY}px, 0)`;
    }
  };

  const blockTouchScroll = (event: TouchEvent) => event.preventDefault();

  const startDrag = () => {
    if (dragging) return;
    dragging = true;
    dragStarted = true;

    ghost = source.cloneNode(true) as HTMLElement;
    ghost.style.position = 'fixed';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.margin = '0';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.9';
    ghost.style.boxShadow = 'var(--shadow-pop)';
    ghost.style.willChange = 'transform';
    ghost.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(ghost);
    moveGhost();

    source.style.opacity = '0.5';
    doc.body.style.cursor = 'grabbing';
    doc.body.style.userSelect = 'none';
    // The card is being dragged, not scrolled — keep the browser from panning.
    if (isTouch) win.addEventListener('touchmove', blockTouchScroll, { passive: false });
  };

  /** Drops the ghost/highlight/global styles; the pointer sequence may go on. */
  const stopDrag = () => {
    dragging = false;
    setDropzone(null);
    ghost?.remove();
    ghost = null;
    source.style.opacity = '';
    doc.body.style.cursor = '';
    doc.body.style.userSelect = '';
    if (isTouch) win.removeEventListener('touchmove', blockTouchScroll);
  };

  // Once a drag has started, releasing the pointer must not ALSO fire the
  // card's click-to-add (React's click handler would place a second node at
  // the default position). The browser dispatches that click after our
  // pointerup handling finishes, so the suppressor is installed at finalize
  // time and removes itself one macrotask later.
  const suppressClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  /** Ends the whole pointer sequence: removes every listener this drag installed. */
  const finalize = () => {
    win.clearTimeout(holdTimer);
    win.removeEventListener('pointermove', onPointerMove);
    win.removeEventListener('pointerup', onPointerUp);
    win.removeEventListener('pointercancel', onPointerCancel);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('blur', onWindowBlur);
    stopDrag();
    if (dragStarted) {
      win.addEventListener('click', suppressClick, true);
      win.setTimeout(() => win.removeEventListener('click', suppressClick, true), 0);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== press.pointerId) return;
    lastX = event.clientX;
    lastY = event.clientY;

    if (!dragging) {
      if (dragStarted) return; // Escape-cancelled; ignore until the pointer lifts.
      const distance = Math.hypot(lastX - press.clientX, lastY - press.clientY);
      if (isTouch) {
        // Finger slid before the hold elapsed: it's a scroll — hand it back.
        if (distance > TOUCH_SLOP_PX) finalize();
      } else if (distance >= DRAG_START_DISTANCE_PX) {
        startDrag();
      }
      return;
    }

    moveGhost();
    const under = doc.elementFromPoint(lastX, lastY);
    setDropzone(under?.closest(`[${DROPZONE_ATTR}]`) ?? null);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== press.pointerId) return;
    const target = dragging
      ? doc.elementFromPoint(event.clientX, event.clientY)?.closest(`[${DROPZONE_ATTR}]`)
      : null;
    const detail: PaletteDropDetail = { entry, clientX: event.clientX, clientY: event.clientY };
    finalize();
    target?.dispatchEvent(new CustomEvent<PaletteDropDetail>(PALETTE_DROP_EVENT, { detail }));
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === press.pointerId) finalize();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && dragging) {
      // Cancel the drag but keep watching the still-held pointer, so the
      // eventual release can't fall through as a click-to-add.
      event.preventDefault();
      event.stopPropagation();
      stopDrag();
    }
  };

  const onWindowBlur = () => finalize();

  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerCancel);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('blur', onWindowBlur);
  if (isTouch) {
    holdTimer = win.setTimeout(startDrag, TOUCH_HOLD_MS);
  }
}
