# Card capability foundation (#56)

`CardDefinition.traits` is the complete Trait contract of a Card capability.
`resolveEffectiveActionTraits` reads the owning actor's Card instance and its definition;
it never unions Action traits. Basic, contextual Basic, and Creature innate actions
continue to read `ActionDefinition.traits`. The plan, MAP advancement, legal-action DTO,
preview, and reaction validation use this resolver. Targeting, costs, movement primitives,
reaction triggers, and equipment/stat requirements remain on the Action definition.

`isCardEligible` uses the same compiled Class registry as Character rules. It delegates
to `matchesEligibilityGroups`: OR within each registry, AND across registries. Class
eligibility is enabled; ancestry eligibility is reserved for a future caller supplying
another registry. Trait category is authoring/presentation metadata, never eligibility
or combat dispatch. A Card without Class identities is unrestricted. Creature fixed
statistics bypass Character eligibility. Collection ownership remains unrestricted;
prepare/deck validation (including equipment grants) and combat use (including reactions) independently verify eligibility.

Characters cannot author or execute innate actions. Creature innate actions are preserved.
The full `listLegalActions` rules query still contains Cards. BattleController applies
`isRingAction` at the Ring boundary: only basic/context sources pass. Hand selection,
target highlights, preview, and commit remain the Card execution path.

Trait action grants are limited by the shared `isContextualBasicAction` policy:
`escape` allows `stand` / `escape-grab`, `interact` allows `interact-lever`,
`shield` allows `raise-shield`, and `sustain` allows `sustain-spell`.
Semantic validation rejects all other action/group pairs. Runtime context queries
apply the same policy before source resolution, preview, or dispatch, including
when compiled content bypasses authoring validation. Adding a new contextual Basic
requires an explicit shared policy change; arbitrary condition recovery or equipment
capabilities must otherwise be supplied as Cards.

## Flourish and compatibility

The version transitions in this table describe the preceding #56 foundation.
The subsequent Card level content change is documented below.

`TurnState.usedTraitsByActor` maps actor IDs to used rule Trait IDs. Currently only
`flourish` is recorded. Acceptance consumes the restriction even when a roll fails;
rejected commands consume nothing. Different Cards share the same Trait restriction.
Each global turn clears the map, including turns advanced after a reaction defeat.
Off-turn reactions use the reacting actor's entry, so another actor's Flourish does not
consume their allowance. A movement continuation is completion of an accepted action
and does not consume or revalidate the once-per-turn allowance again.

The map is deeply cloned and included in the existing full-state gameplay hash. Replay
reconstructs it from accepted commands; snapshot/save restoration retains it directly.
Session invariants and save shape/reference validation reject malformed bookkeeping.

| Artifact | Version / effect |
| --- | --- |
| Content schema | 11, unchanged JSON shape |
| Production content | Fingerprint changes with canonical Card Traits and Flourish text |
| CombatState | 4 → 5, required turn bookkeeping |
| AdventureState | 4, unchanged; CombatState is a separate session/save projection field |
| SessionCoreState | 3, unchanged outer shape; validates nested CombatState v5 |
| CampaignSave | 2 → 3, old payloads explicitly unsupported, stored rows retained |
| WebSocket protocol | 8 → 9, old envelopes rejected |
| Replay | Existing command-only shape; content identity rejects incompatible content |

No previous-content migration is registered for this gameplay change.

## Production audit

The #56 non-blocking decision is **Class Trait authoring**. The production pack
is `cardguild.m7@0.8.0`; the audit below covers all 32 Cards, including reserves.
Class-specific PF2e capabilities declare the supported Class identities directly on
the Card. Card eligibility also enforces the minimum Character levels below. It does not implement
feat prerequisites, archetype acquisition, spell traditions, or change adapted Action effects.

| Cards (`card.` prefix omitted) | Authored Class eligibility | Basis |
| --- | --- | --- |
| vicious-swing, knockdown, intimidating-strike, combat-grab, dueling-parry | fighter | Fighter feat capabilities; Knockdown keeps its existing ID/effects for the Slam Down adaptation |
| reactive-strike | fighter OR champion | Fighter class feature and Champion feat access |
| lay-on-hands | champion | Champion devotion spell |
| trip, grapple, demoralize, battle-medicine, slip-free | unrestricted | General skill capabilities; Slip Free is the existing Acrobatics Escape adaptation |
| frostbite, fear, harm, daze, telekinetic-projectile, force-barrage, heal, soothe | unrestricted | Shared spell capabilities; spell-tradition eligibility is outside the Class registry contract |
| fly | unrestricted | General movement capability, still requires flight |
| spirit-beacon, spirit-lance, aimed-shot, shield-press, iron-presence, ember-lash, spirit-edge, brace-behind-cover, arcane-ward, careful-advance, hover-step | unrestricted | CardGuild-authored capabilities, not acquisition of a named PF2e Class feat |

References checked for Class provenance: [Combat Grab](https://2e.aonprd.com/Feats.aspx?ID=4780),
[Dueling Parry (Fighter)](https://2e.aonprd.com/Feats.aspx?ID=4781),
[Intimidating Strike](https://2e.aonprd.com/Feats.aspx?ID=4782),
[Slam Down](https://2e.aonprd.com/Feats.aspx?ID=4794),
[Reactive Strike feat](https://2e.aonprd.com/Feats.aspx?ID=5832), and
[Lay on Hands](https://2e.aonprd.com/Spells.aspx?ID=2047).
Only implemented Class registries are authored. Future Barbarian, Swashbuckler,
Magus, Exemplar, or archetype support must audit and extend the applicable Card
identities with their rules definitions; an unregistered identity is not an eligibility
restriction. Existing Creature innate actions remain independent of Card eligibility.

Starter and acquisition adjustments:

- Lyra (Rogue): prepared Combat Grab becomes Grapple, preserving a control option.
- Nera (Cleric): prepared Lay on Hands becomes Heal, preserving a healing option.
- Aerin prepares Vicious Swing and Demoralize; Fighter Reactive Strike remains a base grant.
- Brom receives Shield Press ×2 instead of the level-6 Champion Reactive Strike.
- Spear Line adds Combat Grab; Ruined Gate adds Lay on Hands alongside Vicious Swing.
  Each offer retains unrestricted choices for other Classes. Ownership remains
  unrestricted, while prepare/use validates the selected actor's Class and current level.
- Dueling Rapier still grants Dueling Parry through `parry`. Its derived deck requires
  Fighter level 2; the weapon provider never overrides Card eligibility. Other weapon
  rewards remain available to non-Fighters.

Every starter loadout, reward Card, and reward equipment grant is checked against
these eligibility rules. The previous 0.6.0 content identity has no registered save
migration; existing rows are retained and rejected as incompatible rather than having
new Class restrictions silently imposed on an old loadout. Save schema 3, CombatState 5,
and protocol 9 retain their current shapes.

The network/restart campaign driver uses the existing preview-based playtest tactical
policy with seed 2. It selects a healing Card reward when the party can legally prepare
it, then sends a real loadout intent; Brom acquires Lay on Hands while Nera retains Heal.
The driver also validates equipment grants before wearing a reward. No runtime Class
exception or injected winning combat state is used to complete the recovery route.

Generic content validation rejects duplicate/unknown Traits and unknown action references,
Character innate grants, ineligible starter/base Cards, Class Traits without Class definitions,
and missing `move`/`reaction` Traits required by execution primitives. It deliberately
does not force Card `attack` to mirror Action `attack`: a Card without `attack` must not
participate in MAP even when its shared Action has that Trait.
Each authored Trait array is unique by `trait.id`, even when duplicate entries have
different `sourceId` or `params`. This applies to Cards and the other canonical
Trait arrays checked by the shared semantic validator.

## Verification

- `src/game/capabilities.test.ts`: registry grouping, prepare/use/ownership boundaries,
  authoritative MAP, Flourish, deterministic state/events, and production audit.
- `tests/unit/browser/capabilities.spec.ts`: real mouse/touch Ring and Hand interactions,
  Trip/Fly execution, Escape, Stand, Raise Shield, Interact. These are Browser Unit tests
  with injected state, not campaign E2E.
- `src/server/campaign-save.test.ts`: used Flourish survives serialization and restore;
  malformed bookkeeping is refused.
- `tests/integration/coop.test.ts`: protocol v9 snapshots and WebSocket reconnect retain
  Flourish, Card eligibility, and the server-side refusal of another Flourish.
- Existing action requirement, Creature AI, card library, campaign, E2E, and Recovery suites
  remain part of the full `npm run check` → `npm run build` → `npm test` gate.


## Minimum Character level (content 0.8.0)

`CardDefinition.level` is the minimum Character level for preparation and use.
`levelByClass` optionally replaces that requirement for a registered Class already
present in the Card Traits. It cannot grant access to another Class. Both fields
require positive safe integers. The default is explicitly authored, never supplied
by a loader. Creature fixed-stat capabilities keep the existing Character-rule bypass.

`resolveCardEligibility` supplies Class/level eligibility, the effective requirement,
current level, and rejection reason. `isCardEligible` is its boolean wrapper. Collection
ownership is unrestricted. Base, prepared, and equipment-granted Cards all follow the
same preparation and execution gates, including Reaction offering and revalidation.
An item whose Card grants are ineligible cannot be equipped; it does not silently lose
its Cards. Locked hand Cards remain visible with no legal targets or executable intent.
Rejected commands do not consume state, Cards, actions, Reactions, or RNG.

Runtime loadout validation and previews resolve the member's actual progression through
Character rules. Only static setups without progression use their compiled authored
profile. The Host publishing boundary and durable restore share Card invariants for
loadout and all combat Card zones, and refuse a combat level/Class inconsistent with the
Character's progression/definition. Nothing repairs or strips an invalid deck.

### Authoring audit

| Card | Level | Class override / basis |
| --- | ---: | --- |
| Aimed Shot | 1 | CardGuild original |
| Arcane Ward | 1 | CardGuild original |
| Battle Medicine | 1 | [Battle Medicine, Feat 1](https://2e.aonprd.com/Feats.aspx?ID=5125) |
| Brace Behind Cover | 1 | CardGuild original |
| Careful Advance | 1 | CardGuild original |
| Combat Grab | 2 | [Combat Grab, Feat 2](https://2e.aonprd.com/Feats.aspx?ID=4780) |
| Daze | 1 | Current non-feat spell/general capability policy |
| Demoralize | 1 | Current non-feat spell/general capability policy |
| Dueling Parry | 2 | [Dueling Parry, Feat 2](https://2e.aonprd.com/Feats.aspx?ID=4781) |
| Ember Lash | 1 | CardGuild original |
| Fear | 1 | Current non-feat spell/general capability policy |
| Fly | 1 | Current non-feat spell/general capability policy |
| Force Barrage | 1 | Current non-feat spell/general capability policy |
| Frostbite | 1 | Current non-feat spell/general capability policy |
| Grapple | 1 | Current non-feat spell/general capability policy |
| Harm | 1 | Current non-feat spell/general capability policy |
| Heal | 1 | Current non-feat spell/general capability policy |
| Hover Step | 1 | CardGuild original |
| Intimidating Strike | 2 | [Intimidating Strike, Feat 2](https://2e.aonprd.com/Feats.aspx?ID=4782) |
| Iron Presence | 1 | CardGuild original |
| Knockdown | 4 | [Slam Down, Feat 4](https://2e.aonprd.com/Feats.aspx?ID=4794); adapted Action retained |
| Lay on Hands | 1 | Current non-feat spell/general capability policy |
| Reactive Strike | 1 | [Fighter 1](https://2e.aonprd.com/Classes.aspx?ID=35), [Champion 6](https://2e.aonprd.com/Feats.aspx?ID=5832) |
| Shield Press | 1 | CardGuild original |
| Slip Free | 1 | Current non-feat spell/general capability policy |
| Soothe | 1 | Current non-feat spell/general capability policy |
| Spirit Beacon | 1 | CardGuild original |
| Spirit Edge | 1 | CardGuild original |
| Spirit Lance | 1 | CardGuild original |
| Telekinetic Projectile | 1 | Current non-feat spell/general capability policy |
| Trip | 1 | Current non-feat spell/general capability policy |
| Vicious Swing | 1 | [Vicious Swing, Feat 1](https://2e.aonprd.com/Feats.aspx?ID=4775) |

Current non-feat spells/general capabilities and all CardGuild originals explicitly
use level 1. Spell-rank conversion, feat prerequisites, new acquisition paths, and
automatic level-up Card grants remain outside this change. Class names and Card names
remain English; explanations shown to players are Korean.

### Starter and release changes

- Aerin: prepared Knockdown/Intimidating Strike → Vicious Swing/Demoralize.
- Brom: base Reactive Strike ×2 → Shield Press ×2, retaining the provider identity.
- Shared Trip weapon Trait: 3 → 1 Card on Halberd, Executioner Axe, and Flick Mace.
  Its Korean description matches the new grant. Aerin's deck is 8 Cards; Brom's is 7.
- Intimidating Strike and Knockdown become reserves tracked under the existing #21
  acquisition follow-up. Reachable Card floor changes explicitly from 26 to 24;
  all 32 definitions remain authored and validated.
- Reward lists and EXP stay unchanged. Release QA checks each starter has an immediately
  usable choice at each offer, and each individual reward is usable by some starter at
  an attainable later preparation boundary. The shared growth resolver and explicit
  legal advancement choices establish those levels. Combat Grab is collected at level 1
  after Spear Line and usable at level 2 after Goblin Chief; Dueling Rapier is judged at
  the level-2 reward boundary, not against the authored level-1 Fighter.
- Loadout/Card details expose selected-Character requirements; reward descriptions expose
  general and Class-specific requirements without disabling ownership. No new assets.

### Compatibility and verification

Content schema 12 and `cardguild.m7@0.8.0` fingerprint the new requirements, starters,
and Trip count. CampaignSave 3, CombatState 5, AdventureState 4, SessionCoreState 3,
and WebSocket protocol 9 retain their shapes. Legal-action requirement metadata is
query-only. Previous content identity is refused for saves/replays; no content migration
is registered, and stored rows are retained.

The tests cover invalid authoring, Class-specific boundaries, preparation and equipment
grants after growth, locked hand display/preview/dispatch, Reaction revalidation, Host
and restore ingress, and the real UI campaign from Spear Line ownership through level-2
preparation and next-encounter use. UI state-injection tests remain Browser Unit tests.
Durability test setup waits for a published player-input boundary after encounter start:
deck shuffles share the seeded RNG with initiative, so changing deck size can make an
enemy act first even with the same Adventure seed.
The release gate is `npm run check` → `npm run build` → `npm test`.

Implementation verification: `check` and `build` passed. Across the full test run and
the affected-suite reruns after fixes, Node Unit 644, Browser Unit 59, Integration 104,
E2E 26, and Recovery 4 unique cases passed (837 total). The real UI level-unlock case
passed at seed 1 in 4.1 minutes and used Combat Grab in Bone Cellar round 2. Keyboard
focus inspection and mouse/touch hold inspection were checked separately.

Same-seed balance evidence is in [card-level-playtest-comparison.json](evidence/card-level-playtest-comparison.json).
It compares all 36 existing policy/party runs at seed 1, not a selected winning subset.
Completion changes from 5/36 to 6/36; individual routes both improve and regress.
This is measured gameplay impact, not a claim that every party can complete the campaign.
