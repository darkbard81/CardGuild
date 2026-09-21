import { buildAdventureEncounter } from "../adventure";
import { getContentIdentity } from "../content/compile-content";
import type { CompiledContentPack } from "../content/content-types";
import { computeCombatSetupFingerprint } from "../game";
import type { CombatState, ContentIdentity } from "../game";
import type { SessionAuthorityContext } from "../session";
import type { CampaignSaveV4 } from "./campaign-save";

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

/** Build, capability, and Card-level changes retain old saves without silently reinterpreting them. */
export const REGISTERED_CONTENT_MIGRATIONS: readonly ContentMigration[] = [];

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
  save: CampaignSaveV4,
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
  save: CampaignSaveV4,
  migration: ContentMigration,
  setupFingerprint: string | null,
): CampaignSaveV4 {
  return {
    ...save,
    contentIdentity: { ...migration.to },
    combat: save.combat && setupFingerprint
      ? { ...save.combat, contentIdentity: { ...migration.to }, setupFingerprint }
      : save.combat,
  };
}
