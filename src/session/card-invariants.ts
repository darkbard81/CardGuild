import { resolvePartyMemberDefinition } from "../character/member";
import type { AdventureState } from "../adventure/types";
import type { CompiledContentPack } from "../content/content-types";
import { resolveCardEligibility } from "../game/capabilities";
import type { CombatState } from "../game/types";
import { resolveLoadoutStatProfile, validatePartyLoadout } from "../loadout";

/** Shared publishing/restore boundary. Never repairs a deck or trusts a saved combat level. */
export function assertSessionCardInvariants(
  state: { readonly adventure: AdventureState | null; readonly combat: CombatState | null },
  pack: CompiledContentPack,
): void {
  if (state.adventure) {
    const validation = validatePartyLoadout(state.adventure.party, state.adventure.collection, pack);
    if (!validation.valid) throw new Error(`Party loadout is not legal: ${validation.issues.map(issue => issue.message).join(" ")}`);
  }
  if (!state.combat) return;
  const identities = (traits: readonly { readonly id: string }[]): string => traits
    .filter(trait => Object.hasOwn(pack.combatContent.classes, trait.id)).map(trait => trait.id).sort().join("|");
  for (const actor of Object.values(state.combat.actors)) {
    const member = state.adventure?.party.members[actor.id];
    const definition = member ? resolvePartyMemberDefinition(member, pack) : pack.actorDefinitions[actor.definitionId];
    if (!definition || definition.statProfile.kind !== actor.statProfile.kind) throw new Error(`Invalid combat actor "${actor.id}".`);
    if (member && member.actorDefinitionId !== actor.definitionId) throw new Error(`Combat Character "${actor.id}" does not match its party member.`);
    if (member) {
      const resolved = resolvePartyMemberDefinition(member, pack);
      if (actor.name !== resolved.name || actor.appearanceKey !== resolved.appearanceKey) throw new Error("Combat identity differs from its party member.");
    }
    const profile = member ? resolveLoadoutStatProfile(member, pack) : definition.statProfile;
    if (actor.statProfile.kind === "character" && (profile.kind !== "character"
      || actor.statProfile.stats.level !== profile.stats.level || identities(actor.traits) !== identities(definition.traits))) {
      throw new Error(`Combat Character "${actor.id}" level or Class does not match its progression.`);
    }
  }
  for (const [actorId, zones] of Object.entries(state.combat.cardZones)) {
    const actor = state.combat.actors[actorId];
    if (!actor) throw new Error(`Card zones reference unknown actor "${actorId}".`);
    for (const instance of [...zones.hand, ...zones.drawPile, ...zones.discardPile]) {
      const card = pack.combatContent.cards[instance.definitionId];
      if (!card) throw new Error(`Unknown Card "${instance.definitionId}".`);
      const eligibility = resolveCardEligibility(actor, card, pack.combatContent);
      if (!eligibility.eligible) throw new Error(`${actor.name}: ${eligibility.reason}`);
    }
  }
}
