/**
 * The pointer, keyboard and dismissal behaviour a detail panel shares whichever control
 * opens it. Loadout tiles and Trait chips both hover, focus, press and dismiss the same
 * way; what they show, and whether a press is a hold or a tap, is theirs to decide.
 */

/** A mouse rests this long on a control before its detail opens. */
export const HOVER_OPEN_MS = 200;
/** Leaving a control gives the pointer this long to reach the panel before it closes. */
export const HOVER_CLOSE_MS = 150;
/** No panel edge comes closer than this to the viewport edge. */
export const VIEWPORT_MARGIN = 8;
/** Movement past this is a drag or a scroll, never a press. */
const PRESS_TOLERANCE_PX = 8;

export interface PressGestureHandlers {
  /** Fires once the pointer has been held still this long; omit for a tap-only control. */
  readonly holdMs?: number;
  readonly onHold?: () => void;
  /** A click that is neither the tail of a hold nor the tail of a cancelled gesture. */
  readonly onTap: (event: MouseEvent) => void;
  /** The browser took the pointer away (a scroll, a gesture), so nothing may activate. */
  readonly onCancel?: () => void;
}

/**
 * Reads a button's pointer events as "held" or "tapped" without letting one press mean
 * both. A press that moves more than a few pixels, that the browser cancels, or that a
 * scroll interrupts is neither, and its click is swallowed. The keyboard's synthetic click
 * (`detail === 0`) is always a tap: Enter and Space have no pointer to cancel.
 */
export function bindPressGesture(button: HTMLElement, handlers: PressGestureHandlers): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held = false;
  let cancelled = false;
  let origin: { x: number; y: number } | null = null;
  const clear = (): void => { clearTimeout(timer); timer = undefined; };
  const listeners: Array<[string, (event: never) => void]> = [
    ["pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      clear(); held = false; cancelled = false; origin = { x: event.clientX, y: event.clientY };
      if (handlers.onHold) timer = setTimeout(() => { held = true; handlers.onHold?.(); }, handlers.holdMs);
    }],
    ["pointermove", (event: PointerEvent) => {
      if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > PRESS_TOLERANCE_PX) { clear(); cancelled = true; }
    }],
    ["pointerup", () => { clear(); origin = null; }],
    ["pointercancel", () => { clear(); origin = null; cancelled = true; handlers.onCancel?.(); }],
    ["contextmenu", (event: Event) => event.preventDefault()],
    ["click", (event: MouseEvent) => {
      if ((held || cancelled) && event.detail !== 0) { event.preventDefault(); return; }
      clear();
      handlers.onTap(event);
    }],
  ];
  for (const [type, listener] of listeners) button.addEventListener(type, listener as EventListener);
  const scrolled = (): void => { clear(); if (origin) cancelled = true; };
  window.addEventListener("scroll", scrolled, true);
  return () => {
    clear();
    for (const [type, listener] of listeners) button.removeEventListener(type, listener as EventListener);
    window.removeEventListener("scroll", scrolled, true);
  };
}

export interface DismissalOptions {
  readonly panel: HTMLElement;
  /** The control the panel belongs to right now; input there is not "outside". */
  readonly anchor: () => HTMLElement | null;
  readonly hide: () => void;
  /**
   * Whether Escape stops with the panel. A Trait tooltip layered over a card detail or a
   * ring menu closes first and alone; a screen with nothing beneath it lets Escape carry.
   */
  readonly consumeEscape?: boolean;
  /**
   * What a scroll outside the panel does. Hiding is right for a panel beside a grid the
   * player is paging through; following is right for a tooltip on a chip inside a panel
   * that re-renders, where a layout-driven scroll is not the player's doing.
   */
  readonly onScroll?: () => void;
}

/**
 * Closes a panel on input that is not about it: a press outside it and its control,
 * Escape, the window resizing, or anything but the panel itself scrolling.
 */
export function bindDismissal(options: DismissalOptions): () => void {
  const { panel, hide } = options;
  const dismiss = (event: Event): void => {
    if (event.type === "scroll") {
      if (panel.contains(event.target as Node)) return;
      if (options.onScroll) { options.onScroll(); return; }
    }
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape" || panel.hidden) return;
      if (options.consumeEscape) event.stopPropagation();
    }
    if (event.type === "pointerdown" && (panel.contains(event.target as Node) || options.anchor()?.contains(event.target as Node))) return;
    hide();
  };
  document.addEventListener("pointerdown", dismiss);
  window.addEventListener("keydown", dismiss, true);
  window.addEventListener("resize", dismiss);
  window.addEventListener("scroll", dismiss, true);
  return () => {
    document.removeEventListener("pointerdown", dismiss);
    window.removeEventListener("keydown", dismiss, true);
    window.removeEventListener("resize", dismiss);
    window.removeEventListener("scroll", dismiss, true);
  };
}

export type PopoverSide = "right" | "below";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Shows a fixed-position panel beside its control, kept a margin inside the viewport on
 * every edge. `right` sits beside a grid tile; `below` hangs under an inline chip and
 * flips above it when the bottom of the screen is closer.
 */
export function placePopover(panel: HTMLElement, anchor: HTMLElement, side: PopoverSide = "right"): void {
  panel.hidden = false;
  panel.style.left = `${VIEWPORT_MARGIN}px`;
  panel.style.top = `${VIEWPORT_MARGIN}px`;
  const rect = anchor.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const maxLeft = window.innerWidth - bounds.width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - bounds.height - VIEWPORT_MARGIN;
  if (side === "right") {
    panel.style.left = `${clamp(rect.right + 10, VIEWPORT_MARGIN, maxLeft)}px`;
    panel.style.top = `${clamp(rect.top, VIEWPORT_MARGIN, maxTop)}px`;
    return;
  }
  const below = rect.bottom + 6;
  const above = rect.top - bounds.height - 6;
  panel.style.left = `${clamp(rect.left, VIEWPORT_MARGIN, maxLeft)}px`;
  panel.style.top = `${clamp(below <= maxTop || above < VIEWPORT_MARGIN ? below : above, VIEWPORT_MARGIN, maxTop)}px`;
}

/**
 * Whether a control can still be seen: on screen, and not scrolled out of every panel
 * that clips it. A tooltip has nothing to point at otherwise.
 */
export function isAnchorVisible(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  let frame = { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
  for (let node = anchor.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (/(auto|scroll|hidden)/.test(overflowX + overflowY)) {
      const box = node.getBoundingClientRect();
      frame = {
        top: Math.max(frame.top, box.top), left: Math.max(frame.left, box.left),
        bottom: Math.min(frame.bottom, box.bottom), right: Math.min(frame.right, box.right),
      };
    }
  }
  return rect.bottom > frame.top && rect.top < frame.bottom && rect.right > frame.left && rect.left < frame.right;
}
