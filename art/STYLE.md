# CardGuild 2.5D Board Asset Style

Every generated battle asset prompt must reference this file.

## Projection and scale

- Game data stays on a flat rectangular square grid. Assets never encode gameplay projection.
- Terrain masters are exact top-down 1:1 squares on a 256x256 production canvas.
- The runtime composes terrain into one 128px-per-cell board texture, including its square grid lines, then draws that texture on a fixed affine plane with PixiJS: a quarter turn, then a 0.5 vertical squash. Every cell is the same 2:1 diamond; there is no perspective and no near/far size change.
- Props and characters are upright paper standees. Only their bottom-center contact point is projected onto the board, at the centre of the cell they stand on.
- Props use normalized anchor `(0.5, 1)`. Character source sheets contain one front and one back full-body view, both with the same feet line and normalized anchor `(0.5, 1)`.
- Perspective, isometric diamonds, 3D scene renders, floor-aligned character art, and baked camera convergence are forbidden in source assets.

## Point Props and Tile-Bound Structures

Two kinds of object stand on the board and they are produced differently.

- **Point Prop** — a crate, a lever, a chest, a barrel. It stands *on* a cell without claiming it. Authored at the height it should read at; the runtime draws it height-first and lets the width follow.
- **Tile-Bound Structure** — a gate, and later a fence or barricade. It *is* the cell it stands on. Produced on a 256px-wide canvas with the drawing spanning that width edge to edge and sitting on the bottom edge, so the runtime can draw it exactly one terrain cell (128px) wide and let the height follow the art.

A wall is neither. It is a square terrain master like the floors — see below.

Structure rules:

- Nominal width is always one terrain cell. Variants differ in silhouette height, never in width.
- Height is authored per structure. A structure canvas is 256 wide and as tall as that structure needs.
- Structures never rotate. There are no N/E/S/W variants.
- The bottom edge is the contact line with the tile; anchor `(0.5, 1)`.
- Nothing about the picture decides gameplay. Visual height is not elevation, cover, or an obstruction value: movement, Fly and line of sight come from the tile's traits alone.
- A gate is one structure in two states. The open state is generated from the accepted closed gate and keeps the same canvas, frame, posts, baseline and overall bounds — only the door changes.

## Walls

A wall is terrain, not a standee. One `square-terrain` master on the same 256x256 canvas as
the floors, drawn full bleed: the stone fills the square edge to edge with no drawn outline,
no frame and no transparent margin, so two blocked cells side by side read as one surface.

- No direction-specific wall art, no convex/concave corner variants, no autotile atlas.
- Nothing in the picture marks where the wall ends. The runtime strokes the outline itself,
  only where a blocked cell meets something that is not a wall.
- Read it against the floor at a glance: heavier masonry, colder and darker values.

## Character rendering

- Character style: 2D high detailed Japanese anime style.
- Silhouette: crisp, thick dark outer line with a narrow light paper border.
- Keep identity, anatomy, costume, equipment scale, pose energy, body root, and feet line consistent between front and back.
- North facing uses the back standee. East, south, and west use the front standee; the projected facing arrow communicates exact direction.

## Light and materials

- Key light: upper-left, identical across all assets.
- Shadow: no baked floor shadow. Runtime effects may add a projected contact marker.
- Shading: detailed cel-painted values, readable silhouettes, restrained surface texture.
- Generated output should use transparent background. The build preserves real alpha and removes edge-connected neutral checkerboard if a generator bakes it into RGB.

## Palette

| Role | Hex |
| --- | --- |
| ink / deepest crevice | `#1B1714` |
| dark iron | `#34363A` |
| stone shadow | `#55585A` |
| stone mid | `#77756E` |
| stone light | `#AAA38F` |
| moss shadow | `#33472B` |
| moss mid | `#5E7040` |
| leather / timber | `#6C452B` |
| brass accent | `#B5843F` |
| parchment highlight | `#D8C79F` |
| danger crimson | `#8E3028` |
| movement blue | `#4A91B8` |

## Identity and separation rules

- Terrain, overlays, props, actors, and effects remain separate production assets and runtime layers.
- Terrain types share the same exact square canvas and edge alignment.
- Props are generated one per image with a clear bottom-center contact point.
- Structures are generated one per image, one terrain cell wide, with the drawing touching the left, right and bottom edges of its frame.
- Each actor source contains exactly two non-overlapping views in this order: front, back.
- Actor and prop sprites remain upright and must never be children of the board plane. They share only the contact point the projection gives them; the turn and the squash stop at the floor.

## References

- Board composition and upright standee reference: `documents/view_modify.png`.
- Character standee reference: `documents/Template.png`.
- User prompt convention: `documents/ImageGen_Prompt.md`.
