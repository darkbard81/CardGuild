# CardGuild M2 Isometric Asset Style

Every generated M2 asset prompt must reference this file.

## Projection and scale

- Projection: true 2:1 isometric (dimetric), no perspective convergence.
- Logical game tile: 64x32 px.
- Production terrain master: 128x96 px. Its top surface is one exact 128x64 diamond; the common 24px vertical base sits below it.
- Terrain ground anchor: the center of the top diamond, normalized `(0.5, 0.333333)` in the 128x96 master.
- Object ground anchor: bottom-center of the contact footprint. Keep every object within one logical tile unless its manifest footprint says otherwise.
- Character source cell: 320x320 px. Keep the feet contact at normalized `(0.5, 0.90)` in every direction.

## Light and rendering

- Key light: upper-left (north-west), identical for every asset.
- Shadow: short, soft contact shadow toward lower-right; no long cast shadows.
- Shading: clean hand-painted HD with crisp dark silhouettes, smooth cel-like value grouping, and restrained surface texture.
- Camera: the same fixed isometric elevation and scale across terrain, objects, and characters.
- Background during generation: solid flat `#FF00FF`; production output uses clean straight-alpha PNG.

## Palette

Only these core swatches and close value ramps derived from them are allowed:

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
| magic / selection blue | `#4A91B8` |

## Identity rules

- Terrain contains surface and shared base only. Walls, gates, levers, webs, rubble props, characters, UI, text, and FX are separate sprites or layers.
- Terrain types must share the exact same diamond, canvas, base thickness, light, and edge profile.
- Props are generated one per image and use a bottom-center ground anchor.
- Each character source contains eight static facings in row-major order: `south`, `south-west`, `west`, `north-west`, `north`, `north-east`, `east`, `south-east`.
- Character identity, anatomy, costume, equipment scale, body root, and feet line must remain fixed across all eight directions.

## References

- Terrain material and camera reference: `documents/isomatric.png`.
- Character readability and project rendering reference: `documents/ui_mockup.png`.
- User prompt convention: `documents/ImageGen_Prompt.md`.
