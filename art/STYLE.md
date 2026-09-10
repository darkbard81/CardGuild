# CardGuild 2.5D Board Asset Style

Every generated battle asset prompt must reference this file.

## Projection and scale

- Game data stays on a flat rectangular square grid. Assets never encode gameplay projection.
- Terrain masters are exact top-down 1:1 squares on a 256x256 production canvas.
- The runtime composes terrain into one 128px-per-cell board texture, including its square grid lines, then draws that texture on a fixed affine plane with PixiJS: a quarter turn, then a 0.5 vertical squash. Every cell is the same 2:1 diamond; there is no perspective and no near/far size change.
- Props and characters are upright paper standees. Only their bottom-center contact point is projected onto the board, at the centre of the cell they stand on.
- Anything that *is* a square — floor, wall, gate — is a terrain master and belongs to the board plane instead.
- Props use normalized anchor `(0.5, 1)`. Character source sheets contain one front and one back full-body view, both with the same feet line and normalized anchor `(0.5, 1)`.
- Perspective, isometric diamonds, 3D scene renders, floor-aligned character art, and baked camera convergence are forbidden in source assets.

## What kind of asset is this?

One question decides it: **is the picture the state of the square itself, or a thing
standing on a square that would still be there without it?**

| Category | Examples | Plane | Production |
|---|---|---|---|
| **Board Tile Visual** | floor, difficult ground, chasm, web, wall, gate closed, gate open | board — takes the board's turn and squash | `square-terrain`, 256x256, anchor `(0.5, 0.5)`, drawn 128x128 |
| **Point Prop** | lever, chest, crate, barrel | upright — shares only a contact point | `grounded-object`, authored height, anchor `(0.5, 1)` |
| **Actor Standee** | characters, creatures | upright | `two-sided-actor`, front and back |

There is no fourth, in-between category. A wall and a gate are the state of their square,
so they are tile visuals; a lever bolted to that same wall is a thing on a square, so it
is a point prop. Nothing about which category a picture falls into decides gameplay:
movement, Fly and line of sight come from the tile's traits alone.

### Board Tile Visuals

One `square-terrain` master per state, all on the same 256x256 canvas as the floors,
drawn full bleed: the art fills the square edge to edge with no drawn outline, no frame
and no transparent margin, so two of them side by side read as one continuous surface.

- No direction-specific art, no convex/concave corner variants, no autotile atlas.
- Nothing in the picture marks where the surface ends. The runtime strokes the outline
  itself, only where a blocked square meets something that is not blocked.
- A wall reads against the floor at a glance: heavier masonry, colder and darker values.

### Gates

A gate is a board tile visual like any other, and its door, frame, ironwork and material
all live in the picture. Pixi never draws a gate: it places the authored tile and, where
the wall runs the other way, turns it.

- Two states, `terrain.gate.closed` and `terrain.gate.open`, on the same 256x256 canvas
  with the jambs in the same place at the same size, so swapping them moves nothing but
  the door.
- The canonical texture is drawn for a wall running north-south: the masonry jambs sit on
  the top and bottom edges and the way through opens off the left and right edges.
- **One texture per state covers every direction.** A wall running east-west reuses the
  same picture turned a quarter, decided at runtime from the barrier around it. Never
  author a second, rotated gate asset.

### Point Props

- Authored at the height it should read at; the runtime draws it height-first and lets the
  width follow. Anchor `(0.5, 1)`, the bottom-centre contact point.
- Generated one per image with a clear contact point and a transparent background.
- It stands on a cell without claiming it, so it never declares a footprint. Anything that
  wants one is asking to be a tile visual and has to be authored as one.

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
- Terrain types share the same exact square canvas and edge alignment, gate states included.
- Props are generated one per image with a clear bottom-center contact point.
- Each actor source contains exactly two non-overlapping views in this order: front, back.
- Actor and prop sprites remain upright and must never be children of the board plane. They share only the contact point the projection gives them; the turn and the squash stop at the floor.

## References

- Board composition and upright standee reference: `art/reference/board-standee-layout.png`.
- Character standee reference: `art/reference/character-standee.png`.
- User prompt convention: `art/reference/IMAGEGEN_PROMPT.md`.
