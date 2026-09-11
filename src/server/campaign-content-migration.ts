import { buildAdventureEncounter } from "../adventure";
import { getContentIdentity } from "../content/compile-content";
import type { CompiledContentPack } from "../content/content-types";
import { normalizeContentPack } from "../content/fingerprint";
import { computeCombatSetupFingerprint, fingerprintValue } from "../game";
import type { CombatState, ContentIdentity } from "../game";
import type { SessionAuthorityContext } from "../session";
import type { CampaignSaveV1 } from "./campaign-save";

/**
 * One explicitly registered previous content identity and the identity it becomes.
 *
 * A migration is a claim about two specific packs, never a rule about "anything older".
 * `verify` is what turns the claim into something the build can check: it reconstructs the
 * source fingerprint out of the *current* pack, so registering a migration cannot silently
 * carry a combat-content change along with the authoring change it is meant to cover.
 */
export interface ContentMigration {
  readonly from: ContentIdentity;
  readonly to: ContentIdentity;
  readonly verify: (pack: CompiledContentPack) => boolean;
}

/** The fields `TraitDefinition` gained in schema v10, and nothing else. */
const TRAIT_VOCABULARY_FIELDS: readonly string[] = ["source", "category", "description"];

/**
 * The two labels 0.5.0 renamed. They used to describe the provider role ("Grabbed
 * Recovery" grants the escape Action); now that `name` is the canonical chip label they
 * name the Condition itself. A label is not a rule, so the rename rides with the metadata.
 */
const PREVIOUS_TRAIT_NAMES: Readonly<Record<string, string>> = {
  grabbed: "Grabbed Recovery",
  prone: "Prone Recovery",
};

/**
 * M11-1's only migration: every Trait gained `source`, `category` and `description`, two
 * Traits were relabelled, and nothing about gameplay moved. Stripping those three fields,
 * putting the two old labels back and re-applying the previous manifest has to reproduce
 * `from.fingerprint` exactly; if it does not, a provider grant, an Actor, an Action, an
 * Encounter or a reward changed too, and this save is not the save this migration was
 * written for.
 */
export const TRAIT_VOCABULARY_MIGRATION: ContentMigration = {
  from: { packId: "cardguild.m7", packVersion: "0.4.0", fingerprint: "fnv1a64:8795c80164042fbf" },
  to: { packId: "cardguild.m7", packVersion: "0.5.0", fingerprint: "fnv1a64:352d6c3f8b950173" },
  verify: (pack) => {
    const normalized = normalizeContentPack({
      manifest: pack.manifest,
      traits: Object.values(pack.combatContent.traits),
      conditions: Object.values(pack.combatContent.conditions),
      actions: Object.values(pack.combatContent.actions),
      cards: Object.values(pack.combatContent.cards),
      equipment: Object.values(pack.combatContent.equipment),
      actors: Object.values(pack.actorDefinitions),
      scenarios: Object.values(pack.scenarioSources),
      adventures: Object.values(pack.adventures),
    });
    const previous = {
      ...normalized,
      manifest: {
        schemaVersion: 9,
        id: TRAIT_VOCABULARY_MIGRATION.from.packId,
        version: TRAIT_VOCABULARY_MIGRATION.from.packVersion,
        rulesetId: normalized.manifest.rulesetId,
      },
      // Only the three v10 fields come off and only the two labels go back. Everything
      // else must survive untouched.
      traits: normalized.traits.map((trait) => Object.fromEntries(Object.entries(trait)
        .filter(([key]) => !TRAIT_VOCABULARY_FIELDS.includes(key))
        .map(([key, value]) => [key, key === "name" ? PREVIOUS_TRAIT_NAMES[trait.id] ?? value : value]))),
    };
    return fingerprintValue(previous) === TRAIT_VOCABULARY_MIGRATION.from.fingerprint;
  },
};

export const REGISTERED_CONTENT_MIGRATIONS: readonly ContentMigration[] = [TRAIT_VOCABULARY_MIGRATION];

function sameIdentity(left: ContentIdentity, right: ContentIdentity): boolean {
  return left.packId === right.packId
    && left.packVersion === right.packVersion
    && left.fingerprint === right.fingerprint;
}

/**
 * The migration that carries `saved` onto the pack this build serves, or nothing. A
 * registered source whose `verify` fails is treated as unregistered: the caller then
 * refuses the save instead of reinterpreting it.
 */
export function findContentMigration(
  saved: ContentIdentity,
  pack: CompiledContentPack,
): ContentMigration | undefined {
  const current = getContentIdentity(pack);
  return REGISTERED_CONTENT_MIGRATIONS.find((migration) =>
    sameIdentity(migration.from, saved) && sameIdentity(migration.to, current) && migration.verify(pack));
}

/**
 * Recompute the setup fingerprint of a saved in-progress Combat under both identities.
 *
 * The saved battle is never re-created or replayed: the Encounter definition rebuilt here
 * exists only so the *previous* fingerprint can be reproduced from the saved Party, Loadout
 * and Level and compared with what the save actually holds. Only when that matches is the
 * same definition re-fingerprinted under the target identity.
 */
export function migrateCombatSetupFingerprint(
  save: CampaignSaveV1,
  combat: CombatState,
  migration: ContentMigration,
  context: SessionAuthorityContext,
): { readonly ok: true; readonly setupFingerprint: string } | { readonly ok: false; readonly reason: string } {
  let encounter;
  try {
    encounter = buildAdventureEncounter(context.pack, save.adventure);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Saved encounter cannot be rebuilt." };
  }
  if (encounter.seed !== combat.seed) {
    return { ok: false, reason: "Saved combat seed does not match the seed its encounter derives." };
  }
  const previous = computeCombatSetupFingerprint(
    { ...encounter.definition, contentIdentity: migration.from },
    encounter.seed,
  );
  if (previous !== combat.setupFingerprint) {
    return { ok: false, reason: "Saved combat setup does not match the content it was written against." };
  }
  return {
    ok: true,
    setupFingerprint: computeCombatSetupFingerprint(
      { ...encounter.definition, contentIdentity: migration.to },
      encounter.seed,
    ),
  };
}

/**
 * Re-stamp a save onto the target content. Party, Level/EXP, completed encounters,
 * Collection, Loadout, pending reward and the whole in-progress Combat are carried across
 * untouched: the only things that move are the content identity and the one fingerprint
 * that embeds it. No EXP is granted retroactively for battles already won.
 */
export function migrateCampaignSave(
  save: CampaignSaveV1,
  migration: ContentMigration,
  setupFingerprint: string | null,
): CampaignSaveV1 {
  return {
    ...save,
    contentIdentity: { ...migration.to },
    combat: save.combat && setupFingerprint
      ? { ...save.combat, contentIdentity: { ...migration.to }, setupFingerprint }
      : save.combat,
  };
}
