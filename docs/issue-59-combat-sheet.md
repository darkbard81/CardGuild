# Combat Action HUD / full-screen character sheet / Recall Knowledge

## Accepted interaction contract

The default viewport is 1024×768 landscape. The top row shows Objective followed by Round and initiative without wrapping. The right sidebar owns acting character, remaining Actions, request status, End Turn, targeting instructions and collapsed log. Shared theme tokens use the reference sheet’s slate surfaces and orange accent across entry, lobby, preparation and combat. Expanded Action details and log scroll inside the sidebar without moving the board. Board and Ring placement consume the measured HUD safe area. Hand owner and pile counts live beside the bottom fan hand.

The shared character sheet fills the viewport in lobby, preparation and combat. Following the supplied reference, its upper-left overview contains identity, attributes, AC, HP/shield and saves; Traits and Condition are side by side in the upper right; the stat overview is compacted into the left half. Class DC, Perception, Initiative and skills form the lower-right rail; trained skills are expanded and untrained skills are collapsible. Equipment and Cards tabs occupy the lower-left workspace. There are no CORE/SKILLS/TRAITS tabs or large portrait. All values use the shared resolvers; unavailable creature attributes and unsupported size/shield durability are not invented.

Explicit entry points do not submit gameplay commands. A native dialog blocks the underlying board, preserves valid selection on close, restores focus, updates from snapshots and yields to an owned Reaction or encounter exit.

## Recall Knowledge rule extension

This is a Basic Action, not a prepared Card. It costs 1 Action and uses the existing authoritative check/RNG/degree-of-success pipeline. The target is a visible, living enemy within 120ft; facing does not restrict Recall Knowledge. Concentrate and Skill traits describe it; it has no Attack trait and does not increase MAP.

The latest user decisions replace the initial Nature-only proposal:

- Select the target's **highest final skill modifier among its authored skills**. The acting character checks the same skill. Modifiers come from the shared statistics resolver. Ties use the fixed `SKILL_IDS` order. A creature with no authored skills falls back to Nature; existing production creatures all have skills.
- DC is the target's level-based standard DC. Every existing production creature is explicitly **level 1, DC 15**, by user request. This is a CardGuild content value, not a claim about published PF2e monsters of the same name.
- Success and critical success unlock the target's complete character sheet for the acting character's team for this combat.
- Failure and critical failure leave it locked. That actor cannot retry on the same target during this combat; another party member may try.
- Once the team knows the target, further Recall Knowledge against it is unavailable and spends no Action.
- Knowledge is keyed by actor instance and target instance, not creature definition. A new encounter starts with no attempts/unlocks.

Reference: [Recall Knowledge, Player Core](https://2e.aonprd.com/Skills.aspx?General=true&ID=5), [level-based DCs, GM Core](https://2e.aonprd.com/Rules.aspx?ID=2629). Choosing the enemy's strongest skill, full-sheet disclosure, team sharing, the explicit retry lock and treating critical failure as no unlock are CardGuild adaptations. This implementation does not claim PF2e's secret GM question/answer or false-information procedure; it uses the existing visible check log.

`canInspectActor` gates the sidebar button, initiative portraits, Ring entry and dialog target list. Until a confirmed server snapshot includes success, ACK alone cannot unlock the sheet. The existing public board/HP and tactical previews remain available. This is gameplay UI disclosure, not a transport secrecy boundary: the current cooperative client already receives full combat snapshots/content.

## State and compatibility

`CombatState.knowledge` stores immutable attempt records. Absence in a v5 state means no knowledge earned; ordinary pre-Recall states retain their existing shape. Turn changes preserve records; combat creation resets them. It participates in existing state serialization/hash and deterministic command replay.

Save schema 3 accepts the optional records and validates their structure. Session validation rejects unknown/same-team actor references, duplicate actor-target pairs, nonboolean results and invalid creature levels. Same-content save/Resume preserves success and failure. Older creature profiles lacking level use 1, matching the chosen initial content policy.

Content schema is 13 and production pack is 0.9.0. The gameplay/content fingerprint changes. Existing unregistered content identities remain rejected by the repository's content-mismatch policy; no migration, development DB deletion or save rewrite is performed. npm package version is unchanged. No new wire intent is introduced; Recall Knowledge uses `use-action` through normal authorization and durability.

## Verification

- Domain: strongest skill and level DC, cost, outcome gating, retry refusal without state mutation, replay; save/Resume preserves successful and failed attempts.
- Interaction: full-screen bounds, hidden enemy entry, live HP updates, selection restoration, owned Reaction priority, Ring read/execute separation, ACK-before-snapshot disclosure.
- Existing U-BOARD covers the relocated board's pick coordinates, zoom/pan/resize and deliberate touch direction. Test points are read from product screenshots, not production projection functions.
- Final top-row/right-sidebar/shared-theme gate: `CI=true npm run check && CI=true npm run test:all` completed with exit 0 on 2026-09-18: Domain 49, Integration 11, Interaction 29, Journey 4 (93 passing). Content/assets, all TypeScript configurations, ESLint and both builds passed in that same final-state run. Only documentation and screenshot copies changed afterward. GitHub CI was not run by this local verification.
- Screenshots: normal combat, selected Action and full-screen character sheet at 1024×768, under `test-results/review/`. The Action capture is a controlled success fixture with elevated Dexterity, not a production character build.
- Chromium automation is not physical iPad/Safari validation. No physical-device verification is claimed.

The final captures also verify the shared slate/orange theme in preparation. The Interaction sheet case asserts the top-row order/alignment and right-sidebar/log placement.

## Derived condition effects

`conditionEffects()` supplies read-only child effects. Grabbed derives Immobilized (movement restriction) and Off-guard (AC −2 circumstance); Prone derives Off-guard and retains the existing Stand-before-movement rule. The stat stack selects one strongest circumstance penalty across all condition and positional sources. Parent removal removes its contribution without persisting extra conditions. Production Trait descriptions now describe those effects, changing the content fingerprint; prior fingerprints remain subject to existing content mismatch handling.

The sheet compares current statistics against the same equipped/leveled actor without Conditions or Raised Shield. Reduced numbers use red plus a down arrow, increased numbers green plus an up arrow; equal final values retain ordinary styling. Tapping a changed value explains the baseline, current value and applied source changes. No Frightened controls were added.

The final derived-effects revision passed `CI=true npm run check && CI=true npm run test:all` on 2026-09-18 (exit 0): Domain 51, Integration 11, Interaction 30, Journey 4 — 96 passing. Content/assets, all TypeScript checks, ESLint and both builds passed. Only this verification note and screenshot copies changed afterward. The earlier 93-test count describes the preceding layout/theme revision. GitHub CI and physical iPad/Safari verification were not run.

## Compact active-actor feedback

The right HUD now shows parent Condition chips and a single Fort/Ref/Will row above the detail and End Turn buttons. Empty Conditions take no row. The shared `actor-effect-view.ts` owns display comparisons and stat buttons for both HUD and sheet. Chip/stat activation opens a read-only inline explanation. Live snapshots refresh values; unknown enemy summaries remain hidden under `canInspectActor`.

The compact-summary final gate passed `CI=true npm run check && CI=true npm run test:all` on 2026-09-18 (exit 0): Domain 51, Integration 11, Interaction 31, Journey 4 — 97 passing. Only verification documentation and screenshot copies changed afterward. GitHub CI and physical-device checks were not run.

Condition chips now use a shared squared shape and semantic left edge in HUD and sheet. Save tiles put 11px labels above 22px numbers on a shared slate background; the full tile is interactive and the dotted underline is removed. The final visual revision passed `CI=true npm run check && CI=true npm run test:all` (exit 0): Domain 51, Integration 11, Interaction 31, Journey 4 — 97 passing. Only this verification note and screenshot copies changed afterward; GitHub CI and physical-device checks were not run.


## Unified character preparation (2026-09-19)

The separate LoadoutUi and loadout-screen are removed. Adventure member details, the party detail button and unused-reward entry open the same full-screen sheet. `CharacterSheetDestination` carries member, equipment/cards tab, prepared/deck view, slot and reward filter. `CharacterDetailUi` adapts authoritative adventure snapshots and current control; BattleUi supplies the live combat actor to the shared panel. Lobby inspection is read-only.

The four equipment tiles are horizontal (armor/weapon/shield/feet, displayed as 몸/주손/보조손/악세서리), with no Standee. A selected slot opens its matching inventory beside detail/comparison. A candidate tap or drag never equips; explicit confirmation sends the existing set-loadout intent. Equipped items return to shared inventory through an explicit removal comparison. Header numbers stay committed while preview values remain in the workspace. Cards use prepared editing or a complete deck grouped by card with base/equipment/prepared provenance; innate actions remain visible.

Read/write boundaries, level/trait/copy/capacity rules, save format and protocol are unchanged. A pending request locks navigation and dismissal until ACK plus applied state. Rejection permits retry, reconnect cannot imply success, control loss clears uncommitted comparisons, and phase exit closes the sheet without cancelling the client's request tracking. The sample image's weapons/text are not new production content.

U-PREPARE owns confirmation ordering, long press, drag/cancel/wrong drop, reward routing, inventory/control refresh, skill grouping, read-only lobby and viewport screenshots. U-SHEET retains live effects, enemy disclosure and Reaction priority. J-PROGRESS now confirms an equipment removal through the real server and observes the result in the next combat sheet. The final gate passed `CI=true npm run check && CI=true npm run test:all` on 2026-09-19 (exit 0): Domain 51, Integration 14, Interaction 37, Journey 4 — 106 passing. This includes keyboard focus restoration after snapshot refresh. The 1024×768 and wider screenshots were inspected with horizontal Traits/Condition and compact statistics. Only this verification note and screenshot copies changed afterward. GitHub CI and physical-device checks were not run.

The compact picker revision replaces dropdowns with shared bust icons (initiative order in combat, party order in preparation), uses 32px action/tab buttons, fixes the prepared-card row above the independently scrolling owned-card list, and removes persistent footer help from layout. Operational status remains visible. The final local gate passed `CI=true npm run check && CI=true npm run test:all` (exit 0): Domain 51, Integration 14, Interaction 37, Journey 4 — 106 passing. U-PREPARE verifies that scrolling owned cards does not move prepared cards. GitHub CI and physical-device checks were not run.
