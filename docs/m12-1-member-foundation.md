# #63 — Persistent member foundation

Implements the domain/server foundation of [#62](https://github.com/darkbard81/CardGuild/issues/62) in [#63](https://github.com/darkbard81/CardGuild/issues/63). Creation screens, launch Class content and standees belong to #64; recruitment transitions to #65; preparation Co-op to #66; Tutorial production cutover to #67.

## Persistent contract

`PartyMemberState.id` is the Campaign-local instance identity, currently `party.hero-1` through `party.hero-3`. Slots remain ordered deployment positions. Account, session, player seat, display name and reconnect credentials do not determine member identity. `actorDefinitionId` references authored rules, never a user-specific definition registered in the pack.

Every runtime member has exactly one `identity` union:

- `player-created`: `name`, `gender` (`male` or `female`), `creationPresetId`.
- `companion`: `recruitmentSource`. The member's authored definition owns NPC name, appearance and Build; Guest display names cannot overwrite them. #65 supplies the actual reward/source ID.

`AdventureState.partyOrigin` distinguishes the existing authored starter path from the new player-created path. The latter requires exactly one protagonist in slot 1. The authored path contains companions only and remains available until #67 replaces the product entry flow. This is an explicit current-mode contract, not a migration for old saves. A companion NPC definition may appear once; the protagonist and a companion may share that definition or Class.

Progression and Loadout remain mutable instance data. Template Build, canonical ancestry/Class traits, base cards and capacity are authored once. `resolvePartyMemberDefinition()` projects display name, logical `appearanceKey`, the template and current `CharacterRulesInput`. Loadout preview/eligibility, growth, Combat bridge, preparation/detail/party views and Campaign summary consume this boundary. Creature placements continue using their fixed profiles and innate actions.

## Authoring and creation

`content/m7/creationPresets.json` is the explicit launch allowlist. It is empty in #63: no existing VS hero is implicitly exposed as a finished launch Class. #64 authors the supported presets and visuals. The check-content loader also permits packs without this optional file.

```json
{
  "id": "creation.human-fighter",
  "actorDefinitionId": "character.human-fighter",
  "appearance": {
    "male": "human.fighter.male",
    "female": "human.fighter.female"
  }
}
```

The referenced Character owns the complete free-boost/trained-skill Build, starterLoadout, baseCardGrants and preparedCardCapacity. It must be playable, Human, exactly one Class, Lv1 with empty history, and have a legal starter deck/inventory. Both appearance keys are required. Keys address `actorVisuals`; no texture/URL/DOM is saved. #64's asset gate must register those actual visuals. Different genders share the same rules template.

Preset structure is checked by the content schema. Compilation checks Human/Class/Build/level/appearance/capacity and starting Loadout legality. Nonempty presets enter the authored content fingerprint. An absent or empty list preserves the baseline pack fingerprint; user name/gender never change it.

The authenticated Host sends the existing protocol envelope containing:

```json
{
  "type": "create-character",
  "name": "하늘",
  "gender": "female",
  "creationPresetId": "creation.human-fighter"
}
```

Only these three choice fields are accepted. Names contain 1–40 Unicode code points, with no leading/trailing whitespace, control/format characters or line/paragraph separators. Inputs are rejected rather than silently renamed. Class and ancestry are resolved from the preset; clients cannot supply stats, Build, traits, progression, inventory or member ID.

Creation is Host-only in a solo, uncreated lobby. It atomically replaces any uncommitted authored party draft with one protagonist, Lv1/EXP0/empty history, one starter Collection, matching party slots and `between-encounters` state for the configured Adventure. It does not start Combat. #67 supplies the new Tutorial definition; #63 does not rename Goblin Trouble or switch packs.

SessionHost's existing serialized request journal and Campaign durability boundary own the commit. Until commit, snapshots retain the empty lobby and no success ACK is sent. Failure leaves the same request retryable. Replaying the successful request returns its ACK without reapplying; another creation command is rejected. An empty Campaign row remains `hasSave: false` and is not a created character.

## Save, ingress and versions

Save/Resume clone the persistent projection. Save restore and SessionHost construction share structural identity checks and Character/role/slot/Card invariants. The snapshot receiver checks persistent shape and role/slot invariants before rendering. Illegal unions, unknown presets, non-Human player templates, illegal Build/history, missing/duplicate protagonists and slot/member mismatch are rejected. Combat member name/appearance/template/level/Class must agree with the persistent member. In-progress Combat HP, RNG and zones are preserved, never rebuilt during Resume.

`Session.partySlots` remains the lobby draft and fixed projection of `Adventure.party` after creation; the creation transition updates both together and ingress enforces equality. Future recruitment must use the same atomic contract. The protagonist stays in Host-only slot 1; claims and presence remain live-only. Continue creates a fresh session with empty Guest claims and the same persistent party.

| Contract | Baseline | #63 | Reason |
| --- | --- | --- | --- |
| Campaign Save | 3 | 4 | Required member identity and party origin |
| AdventureState | 4 | 5 | Runtime identity/role contract |
| SessionCoreState | 3 | 4 | New creation transition and same-template instance semantics |
| Wire protocol | 10 | 11 | `create-character` and identity snapshots; versioned types renamed |
| CombatState | 5 | 6 | Instance appearance projection and identity validation |
| Combat setup fingerprint | Full setup hash | Same algorithm | Name/appearance are included in setup; instance inputs change its hash |
| Content schema / pack | 13 / 0.9.0 | Unchanged | Optional preset schema; production list empty; no authored gameplay changed |
| Presentation manifest | 5 | 5 | Existing keyed `actorVisuals` storage reused |

There is no registered Save 3→4 migration. Unsupported saves remain untouched and return `SAVE_SCHEMA_UNSUPPORTED`. No DB reset or fingerprint rewrite is introduced. This table records actual #63 changes; later issues must update it at their changed boundary rather than pre-reserving version numbers.

## Evidence ownership

- Domain `creation.test.ts`: valid/invalid choices, cosmetic gender, independent Campaigns, starter once, same-template companion, current growth/Loadout/HP across save and next encounter, initial checkpoint, ingress rejection, wire shape and old-save preservation.
- Integration `contracts/creation.test.ts`: commit delay/failure, same-request retry/deduplication; real file SQLite close/reopen, owned Continue, summary identity and next encounter via SessionHost.
- Existing Domain/Interaction/Journey contracts continue protecting the authored/Creature path and product navigation. No new creation UI Journey or physical-device validation is claimed in #63.

Execution status is reported with the final local gate; test collection alone is not evidence of passing.

## Local verification — 2026-09-21

Final executable state passed one uninterrupted `CI=true npm run check && CI=true npm run test:all` on Node 24.18.1 / npm 11.16.0:

| Gate | Result |
| --- | --- |
| check | Content, production policy, assets, all TypeScript projects, ESLint, client/server build passed |
| Domain | 77 passed across 8 files (including 26 foundation cases) |
| Integration | 16 passed across 6 files (including 2 creation durability cases) |
| Interaction | 37 passed, one Chromium worker |
| Journey | 4 passed, one Chromium worker |

The targeted preparation Interaction passed before the full gate. An early focused Integration run used the wrong fixture weapon ID (`longsword` instead of authored `halberd`); the expectation was corrected, the failed case passed, and the complete final gate above passed. No behavior timeout or retry was increased. The existing renderer-startup failure scenario intentionally logs its injected graphics error and passed. Build emitted the Vite bundle-size warning, without failing.

GitHub CI and physical iPad checks were not run. Production launch presets, creation UI/standees, recruitment and new Tutorial Journeys remain with their respective follow-up issues. Only this verification documentation changed after the executable gate; `git diff --check` was run afterward.
