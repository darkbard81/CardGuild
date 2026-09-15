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

Every production Card is checked against its existing Action vocabulary, including Trip,
Fly, Reactive Strike, Knockdown, Vicious Swing, Intimidating Strike, Combat Grab, Aimed
Shot, Shield Press, Grapple, Demoralize, Battle Medicine, and spells/focus Cards.
Trip gains `skill`; Spirit Beacon gains `spell`. Vicious Swing declares `fighter`
eligibility and retains `attack`/`flourish`. Other existing Card identities remain as
authored; all current starter grants and prepared Cards remain eligible. Each reward retains at least one eligible choice for every starter; owning Vicious Swing does not by itself allow a non-Fighter to prepare it.

Generic content validation rejects duplicate/unknown Traits and unknown action references,
Character innate grants, ineligible starter/base Cards, Class Traits without Class definitions,
and missing `move`/`reaction` Traits required by execution primitives. It deliberately
does not force Card `attack` to mirror Action `attack`: a Card without `attack` must not
participate in MAP even when its shared Action has that Trait.

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
