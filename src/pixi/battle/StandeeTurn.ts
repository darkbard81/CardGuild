import type { Direction } from "../../game";

export interface StandeeCorner {
  readonly x: number;
  readonly y: number;
}

/** Local-space box a standee sprite occupies, with the feet at the origin. */
export interface StandeeRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface StandeeTurn {
  readonly rotationDegrees: number;
  readonly skewDegrees: number;
  readonly scaleX: number;
  /**
   * Perspective distance as a multiple of standee height, so the turn looks the same
   * whether the camera is zoomed in or out. 700px against the 152px standee the art
   * is authored at is the ratio the art direction asked for.
   */
  readonly perspectiveHeights: number;
  /** Pivot height: 0 is the top of the art, 1 the feet. */
  readonly originY: number;
}

/**
 * The turn the art direction specified as CSS:
 *
 *   transform: perspective(700px) rotateY(-28deg) skewY(1.5deg) scaleX(0.92);
 *   transform-origin: 50% 90%;
 */
export const DEFAULT_STANDEE_TURN: StandeeTurn = Object.freeze({
  rotationDegrees: 28,
  skewDegrees: 1.5,
  scaleX: 0.92,
  perspectiveHeights: 700 / 152,
  originY: 0.9,
});

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function turnsSideways(facing: Direction): boolean {
  return facing === "east" || facing === "west";
}

/**
 * Projects the standee quad through the same matrix the CSS describes, so a canvas
 * sprite can be drawn as the projective mesh CSS would have rasterised. CSS applies
 * transform functions right to left: a corner is scaled, then sheared, then rotated
 * about the vertical axis, and only then divided by the perspective.
 *
 * East is the authored turn, leaning the standee's right edge towards the camera.
 * West is that same rendering seen in a mirror: reflecting the finished quad about
 * the pivot carries the art with it, so the character faces the other way instead of
 * turning the same shoulder into the opposite direction.
 *
 * Corners come back in PerspectiveMesh order — the texture's top-left, top-right,
 * bottom-right and bottom-left — which is why a mirrored quad needs no reordering:
 * the texture's left edge simply lands on the right of the screen. A facing with no
 * turn returns the untouched rectangle, so the caller can always draw the same mesh.
 */
export function turnedStandeeCorners(
  rect: StandeeRect,
  facing: Direction,
  turn: StandeeTurn = DEFAULT_STANDEE_TURN,
): readonly [StandeeCorner, StandeeCorner, StandeeCorner, StandeeCorner] {
  const corners: readonly [StandeeCorner, StandeeCorner, StandeeCorner, StandeeCorner] = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  if (!turnsSideways(facing)) return corners;

  const height = rect.bottom - rect.top;
  const originX = (rect.left + rect.right) / 2;
  const originY = rect.top + height * turn.originY;
  // The authored rotateY is negative, which is what brings the right edge forward.
  const theta = -radians(turn.rotationDegrees);
  const shearPerPixel = Math.tan(radians(turn.skewDegrees));
  const distance = turn.perspectiveHeights * height;

  const project = (corner: StandeeCorner): StandeeCorner => {
    const horizontal = (corner.x - originX) * turn.scaleX;
    const vertical = corner.y - originY + horizontal * shearPerPixel;
    const depth = -horizontal * Math.sin(theta);
    // A standee is far narrower than the perspective distance, so the divisor cannot
    // reach zero from real art. The clamp keeps a mistuned config from inverting it.
    const divisor = Math.max(distance * 0.2, distance - depth);
    const scale = distance / divisor;
    return {
      x: originX + horizontal * Math.cos(theta) * scale,
      y: originY + vertical * scale,
    };
  };

  const turned = [project(corners[0]), project(corners[1]), project(corners[2]), project(corners[3])] as const;
  if (facing === "east") return turned;
  const mirror = (corner: StandeeCorner): StandeeCorner => ({ x: 2 * originX - corner.x, y: corner.y });
  return [mirror(turned[0]), mirror(turned[1]), mirror(turned[2]), mirror(turned[3])];
}
