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
is `cardguild.m7@0.7.0`; the audit below covers all 32 Cards, including reserves.
Class-specific PF2e capabilities declare the supported Class identities directly on
the Card. Class eligibility does not implement feat levels, prerequisites, archetype
acquisition, spell traditions, or change the existing Action's adapted effects.

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
- Aerin and Brom retain their eligible starter Cards, including Reactive Strike.
- Spear Line adds Combat Grab; Ruined Gate adds Lay on Hands alongside Vicious Swing.
  Each offer retains unrestricted choices for other Classes. Ownership remains
  unrestricted, while prepare/use validates the selected actor's Class.
- Dueling Rapier still grants Dueling Parry through `parry`. Its derived deck is now
  Fighter-only; the weapon provider never overrides Card eligibility. Other weapon
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
