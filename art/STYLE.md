# CardGuild 2.5D Board Asset Style

Every generated battle asset prompt must reference this file.

## Projection and scale

- Game data stays on a flat rectangular square grid. Assets never encode gameplay projection.
- Terrain masters are exact top-down 1:1 squares on a 256x256 production canvas.
- The runtime composes terrain into one 128px-per-cell board texture, including its square grid lines, then applies a subtle trapezoid perspective with PixiJS.
- Props and characters are upright paper standees. Only their bottom-center contact point is projected onto the board.
- Props use normalized anchor `(0.5, 1)`. Character source sheets contain one front and one back full-body view, both with the same feet line and normalized anchor `(0.5, 1)`.
- Perspective, isometric diamonds, 3D scene renders, floor-aligned character art, and baked camera convergence are forbidden in source assets.

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
- Each actor source contains exactly two non-overlapping views in this order: front, back.
- Actor and prop sprites remain upright and must never be children of the perspective floor mesh.

## References

- Board composition and upright standee reference: `documents/view_modify.png`.
- Character standee reference: `documents/Template.png`.
- User prompt convention: `documents/ImageGen_Prompt.md`.
