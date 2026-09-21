# M12-3 — Companion Recruitment (#65)

Confirming a mandatory companion reward appends one authored NPC and its owned starter items in the same durable transition as reward settlement. The protagonist's identity, current Loadout, growth and existing Collection remain intact. The new member participates from the next encounter and starts with authored EXP, without receiving earlier victories' EXP.

## Authoring and the #67 boundary

The user selected existing **Aerin (Fighter)**. `content/m7/companions.json` registers `companion.aerin → hero.aerin`, `startingExperience: 0`, role text and existing `hero.aerin` appearance. The Character definition remains the sole source for name, traits, Build, starting level/advancement history, starter equipment/prepared cards and base grants. No images were generated or changed. Existing equipment rules are reused; the deferred PF2e RAW equipment correction is not part of this change.

`adventure.recruitment-tutorial` is a concrete integration slice for #67: created protagonist alone → Road Ambush victory → mandatory `reward.recruit-aerin` → preparation with Aerin → Spear Line. It awards 200 EXP before recruitment and 250 EXP after the next victory. It deliberately reuses current encounters; it is not the final Chapter's story or balance design.

`PRODUCTION_CONTENT` still selects Goblin Trouble. There is no Adventure selector or runtime switch. The release policy explicitly names the staged integration slice; it is compiled and validated alongside the pack. The new Chapter and default-start cutover, recruitment timing/story and J-PROGRESS migration belong to #67. Existing Goblin Trouble rewards are unchanged.

M12 companion rewards are mandatory single-choice offers, unique per NPC, before the final encounter. Recruitment adventures must start with one created protagonist and fit all recruits within the authored maximum (never above three). Every encounter has the necessary party spawn seats, and the existing validator checks party-size-dependent placement conflicts. Companions must reference authored playable Characters, excluding Creatures and creation templates. Non-Human NPCs remain supported. Compilation validates complete advancement history, starter ownership/eligibility and weapon/armor proficiency; asset checks require front/back visuals.

## One candidate, one commit

- `createCompanionMember` initializes the authored starter and identity `{ origin: "companion", recruitmentSource: reward.id }`. Stable reward IDs resolve the NPC through the containing Adventure. The next deterministic `party.hero-N` ID/seat is appended without regenerating existing identities.
- `addMemberStartingCollection` adds only the new member's equipped items and prepared cards. Base/trait/equipment-granted cards remain deck contributions, never duplicate owned cards. It never reapplies the entire party starter.
- Adventure validates the completed encounter, pending offer, authored choices, choice index, NPC, uniqueness, capacity and final Loadout before returning a candidate. Session authority updates `partySlots` from that same candidate.
- SessionHost's existing durability boundary saves the entire candidate before publishing events, ACK or snapshot. A failed commit leaves party, slots, items, pending reward, completion list and progression untouched. Same-request retry commits once; repeat choice after settlement is rejected.
- `COMPANION_RECRUITED` is published only with the saved result. The finished Combat is not modified. Encounter creation uses the expanded party, next seat spawn and existing party-size placement rules.

Save restore and SessionHost ingress share content-aware validation: unknown NPC/source, creation-template substitution, duplicated NPC, unsettled recruitment, missing mandatory recruit and party/slot mismatch are rejected. Pending reward choices must match authored content exactly. Current progression and Loadout are preserved; restore never recreates the starter or grants items.

## Interaction and control

The reward screen shows Aerin's standee, role, starting level/EXP and equipment. Selection and the shared read-only character sheet are inert. Explicit **동료 합류** is the only commit action; failure retains the selection for retry. Completion feedback waits for both ACK and the applied snapshot, in either order. The new member is then available in the common character/Loadout sheet, with next-encounter participation explained.

Recruitment neither creates a Guest nor claims a member. Created campaigns remain Host-controlled, including after Continue; they do not automatically expose an invitation or admit Guests. #66 owns the explicit Host allowlist and subsequent Guest claim. The existing authored-party Co-op path remains available for its current contracts.

## Evidence ownership

| Risk | Evidence |
| --- | --- |
| G-RECRUIT / G-LOADOUT / G-GROWTH | `tests/domain/recruitment.test.ts`: 1→2 and 2→3; same Class; existing current kit/growth/inventory preserved; owned starter only; unchanged invalid/duplicate/full refusal; non-Human authored EXP; next spawn and subsequent EXP |
| G-SAVE / ingress | Same Domain file: pending/recruited/current-kit round trips, source/NPC/origin/duplicate/slot corruption, missing recruit, old Save 4 preservation; existing identity suite now uses real recruitment for its companion precondition |
| B-RECRUIT / B-COMMIT | `tests/integration/contracts/recruitment.test.ts`: delayed/failed publication, same-envelope retry/deduplication, real file SQLite pending and recruited checkpoints, reopen and repeat rejection |
| U-RECRUIT | `tests/interaction/recruitment.spec.ts`: inert detail, visible role/kit, explicit confirm, retry, both ACK/snapshot orders, shared editable sheet after commit, Continue without automatic invitation; 1024×768 screenshot |
| Journey | Existing four production Journeys retained. New Tutorial J-PROGRESS connection is #67's owner, without duplicating the matrices above. |

Run the staged content through the existing playtest engine with `npm run playtest -- --recruitment --seeds 3 --json /tmp/cardguild-recruitment-playtest.json`. It starts each of the nine creation presets solo and uses normal reward, Loadout, encounter and combat commands. This tool option is not a product content selector.

Observed on the working tree based on `402eeb4`, content `cardguild.m7@0.11.0`, fingerprint `fnv1a64:7b3d5f01a90bfedf`: **27 runs, 15 complete, 12 combat defeats, no stalled encounters**. Six defeats happened before recruitment; the other six after recruitment. All nine Classes reached recruitment in at least one seed. The greedy policy did not complete Witch's second encounter in these three seeds. These are integration/playtest observations, not human win rates or #67 Chapter balance acceptance.

## Final local verification — 2026-09-21

The final executable state completed one uninterrupted `CI=true npm run check && CI=true npm run test:all` on Node 24.18.1 / npm 11.16.0:

| Gate | Result |
| --- | --- |
| check | Content, production policy, assets, all TypeScript projects, ESLint and client/server builds passed |
| Domain | 107 passed (21 recruitment cases) |
| Integration | 18 passed |
| Interaction | 46 passed, one Chromium worker |
| Journey | 4 passed, one Chromium worker |

The reward screen's legacy CSS initially hid NPC role/kit details; the companion-specific display was corrected and the focused Interaction passed. An assertion counting a hidden entry-form input was corrected to assert visibility. Final audit reproduced two wrongly accepted origin disguises, added ingress rejection, passed 56 focused recruitment/creation cases, then reran the entire final gate above. No timeout or retry was increased. The expected injected renderer-startup error case passed; the existing Vite bundle-size warning remained non-fatal.

The 1024×768 recruitment screenshot was inspected: standee, role, level/EXP, starter kit, read-only detail and confirm button are visible within the viewport. Physical iPad and remote GitHub CI were not verified. Only verification documentation changed after the final executable gate; `git diff --check` was run afterward.
