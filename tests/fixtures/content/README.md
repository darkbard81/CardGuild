# Rules fixtures

These are the content packs the rules tests run against. They are not shipped, and
production code cannot reach them: they live outside `src/`, and ESLint refuses the import.

## What is here

```text
core/                  the base rules, as typed definitions
character-rules.ts     the core rules plus what a three-Character roster needs
json-pack/             one small pack still authored as JSON
identity.ts            the cardguild.test.* manifests
index.ts               the factories every test calls
```

| Factory | Gives you | Use it for |
|---|---|---|
| `createCoreRulesFixture()` | `LoadoutContent` | combat rules, loadout derivation, the log |
| `createCharacterRulesFixture()` | `LoadoutContent` | anything about choosing between Characters |
| `createTacticalCombatFixture({ rules })` | `CombatDefinition` | one battle, on the Ruined Gate board by default |
| `createCoreContentSource()` / `createCharacterRulesContentSource()` | `ContentPackSource` | schema, semantics, the compiler, the Adventure bridge |

Every call returns its own object graph, so a test may edit what it is handed.

## Why two rule sets, written as a diff

`character-rules.ts` is the core rules plus three deliberate edits, not a second copy:

1. the shared hero becomes `playable` and wears `scale-mail`,
2. the focus Action `spirit-beacon` gains the `spell` Trait,
3. the second reward offers `card.spirit-lance` instead of `card.spirit-beacon`.

A test that fails under both is failing on a rule; a test that fails under only one is
failing on something those three edits touch. Two full copies would drift until that
distinction meant nothing.

## Why one pack is still JSON

`json-pack/` is the smallest thing that still compiles — one hero, one goblin, a
three-by-three room. Its job is the boundary the shipped pack actually crosses: files on
disk, parsed as untyped JSON, refused by the schema before a single type exists. It is
deliberately too small to become a second rules fixture.

## Identity

Fixture packs are `cardguild.test.*` at a fixed version. A fixture is not released, so
bumping its version the way a production pack is bumped would only mean "someone edited a
test" — and would move every fingerprint and golden hash that depends on it for no reason a
reader could name. A source pack is fingerprinted by the compiler; a combat fixture is
fingerprinted from the combat content itself, because that is all a battle reads.

## What holds these promises

`src/content/fixture-contract.test.ts`. It checks that calls are independent, that a
hand-assembled battle is the battle the compiler would have produced, that the character
rules really are an extension of the core rules, and that the JSON pack passes and fails for
the same reasons a shipped pack would.
