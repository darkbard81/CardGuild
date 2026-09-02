import type { BoardSafeArea } from "../pixi/BattleView";
import { ZERO_BOARD_SAFE_AREA } from "../pixi/BattleView";

/** Breathing room between the board quad and the HUD panel it sits next to. */
const BOARD_EDGE_PADDING = 8;

type GutterEdge = "left" | "top" | "right" | "bottom";

function isGutterEdge(value: string | undefined): value is GutterEdge {
  return value === "left" || value === "top" || value === "right" || value === "bottom";
}

/**
 * Measures the HUD gutters straight off the laid-out overlay panels, so the board
 * projection follows whatever style.css does instead of mirroring its numbers.
 * Elements opt in with `data-hud-gutter="left|top|right|bottom"`.
 */
export function measureHudSafeArea(stage: HTMLElement): BoardSafeArea {
  const bounds = stage.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return ZERO_BOARD_SAFE_AREA;

  const insets: Record<GutterEdge, number> = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const element of stage.querySelectorAll<HTMLElement>("[data-hud-gutter]")) {
    const edge = element.dataset.hudGutter;
    if (!isGutterEdge(edge)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const inset =
      edge === "left"
        ? rect.right - bounds.left
        : edge === "right"
          ? bounds.right - rect.left
          : edge === "top"
            ? rect.bottom - bounds.top
            : bounds.bottom - rect.top;
    insets[edge] = Math.max(insets[edge], inset + BOARD_EDGE_PADDING);
  }

  // A HUD taller or wider than its own stage would leave no board at all.
  const horizontal = Math.min(1, (bounds.width * 0.5) / Math.max(1, insets.left + insets.right));
  const vertical = Math.min(1, (bounds.height * 0.5) / Math.max(1, insets.top + insets.bottom));
  return {
    left: insets.left * horizontal,
    right: insets.right * horizontal,
    top: insets.top * vertical,
    bottom: insets.bottom * vertical,
  };
}
