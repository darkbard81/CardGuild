# Card illustration contract

Card illustrations use their own contract, separate from the transparent board/standee
rules in STYLE.md. All 32 current production cards use individual illustrations.
The original Vicious Swing, Force Barrage and Heal pilot images are preserved.

- One complete, opaque 1024x1536 PNG illustration per card, no text or frame.
- Fixed prompt: `2:3 ratio. 2D hyper Detailed Chibi Anime Style. Chibi Elf Woman has Massive bust.`
- The subject is clearly an adult woman (25+), fully clothed in class-appropriate attire.
- Class can change appearance, clothing and equipment. Each card has one shared image;
  its visual class theme does not change gameplay eligibility.
- Depict the current production action, not additional tabletop rules.
- Keep defining action/face visible at small sizes; leave top corners and bottom 20%
  low-detail for DOM overlays, without drawing blank strips or a border.
- Store original PNGs in ignored `art/local/cards/`; keep an independent backup.
- Use the built-in image generation tool through `luna-gen`, one call per card.
- Record the exact prompt and accepted source/output SHA-256 in `source/card-art-plan.json`.
- Convert with Sharp: 50% in each dimension, Lanczos3, WebP quality 85, effort 6.
- Only explicit conversion requires local PNGs. Checks, application builds and asset
  packaging consume the tracked 512x768 WebPs without requiring local originals.

Commands:

```sh
npm run assets:cards -- card.vicious-swing
npm run assets:cards -- all
npm run assets:build
```

Inspect both the original and the actual small DOM card before accepting an image.
Do not crop/stretch an unexpected generation to make it pass the source-size check.

## Production delivery

All 32 production cards are registered in `source/card-art-plan.json`. The remaining
29 illustrations were generated through separate built-in calls by `luna-gen`, using
the exact recorded prompts. Each 1024x1536 original was inspected and converted to
an opaque 512x768 WebP. Source and output SHA-256 values are recorded in the plan.

Every card uses its full image as a 2:3 DOM face. Names, action costs and badges are
DOM overlays. CSS may display the image smaller than its delivery resolution.
No card images remain in the delivered atlas or the Pixi encounter image bundle.
Actors, equipment and board storage contracts are unchanged. Source sheets retain
their original cell indexing for the asset builder.

Run individual `assets:cards` commands sequentially: each updates the shared plan.
Use `all` only for an intended full reconversion with every local original present.
Normal check/build/asset packaging requires only the delivery WebPs, not the PNGs.

## Verification

`npm run check` validates production asset mappings and delivery assets. The current
preparation Interaction suite checks readable card detail and explicit user confirmation
at 1024×768. It does not claim exhaustive card/viewport visual coverage.
See [the test risk map](../docs/test-risk-map.md) and [execution guide](../docs/TESTING.md).

```sh
npm run check
npm run test:interaction -- tests/interaction/preparation.spec.ts
```

Local visual review artifacts are stored in ignored `art/processed/qc/cards/`.

Historical evidence before the #60 suite replacement, verified on 2026-09-16 after the full migration: check and build passed;
13 catalog tests and 15 Browser Unit tests passed. All 32 originals and WebPs
passed dimensions, opacity, SHA-256 and mapping checks; there are zero card
frames in the delivered atlas. The 32 WebPs total 3,752,490 bytes.
