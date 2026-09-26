import { resolvePartyMemberDefinition } from "../character/member";
import { getContentIdentity } from "../content/compile-content";
import { placementAppliesToPartySize } from "../content/content-types";
import type { CompiledContentPack } from "../content/content-types";
import { resolveStrike } from "../game/offense";
import { positionKey } from "../game/grid";
import type { CombatDefinition } from "../game/types";
import { deriveActorSetup, validatePartyLoadout } from "../loadout";
import { deriveCombatSeed } from "./runtime";
import { assertAdventureInvariants, resolveEffectiveCharacterStatProfile } from "./progression";
import type { AdventureState } from "./types";

export interface AdventureEncounterDefinition {
  readonly definition: CombatDefinition;
  readonly seed: number;
}

export function buildAdventureEncounter(
  pack: CompiledContentPack,
  state: AdventureState,
): AdventureEncounterDefinition {
  assertAdventureInvariants(state);
  const scenarioId = state.currentEncounterId;
  if (state.phase !== "combat" || !scenarioId) throw new Error("Adventure is not in an active combat phase.");
  const source = pack.scenarioSources[scenarioId];
  if (!source) throw new Error(`Scenario "${scenarioId}" is not present in the compiled content pack.`);
  const validation = validatePartyLoadout(state.party, state.collection, pack);
  if (!validation.valid) throw new Error(`Adventure party loadout is invalid: ${validation.issues[0]?.message ?? "unknown error"}`);

  // Static composition follows the party that actually walked in.
  const partySize = Object.keys(state.party.members).length;
  if (source.rules?.partySize && (partySize < source.rules.partySize.min || partySize > source.rules.partySize.max)) {
    throw new Error("Party size does not satisfy the scenario rules.");
  }
  const staticActors = source.placements
    .filter((placement) => placementAppliesToPartySize(placement, partySize))
    .map((placement) => {
    const actorDefinition = pack.actorDefinitions[placement.actorDefinitionId];
    if (!actorDefinition) throw new Error(`Actor definition "${placement.actorDefinitionId}" is missing.`);
    return deriveActorSetup(actorDefinition, placement, actorDefinition.starterLoadout, pack.combatContent);
  });
  const spawnSlots = new Map(source.partySpawnSlots.map((slot) => [slot.seat, slot]));
  const partyActors = Object.values(state.party.members)
    .sort((left, right) => left.seat - right.seat || left.id.localeCompare(right.id))
    .map((partyMember) => {
      const actorDefinition = resolvePartyMemberDefinition(partyMember, pack);
      const spawn = spawnSlots.get(partyMember.seat);
      if (!spawn) throw new Error(`Scenario "${source.id}" has no spawn slot for seat ${partyMember.seat}.`);
      const override = source.rules?.partyWeaponOverride;
      const loadout = override?.seat === partyMember.seat
        ? { ...partyMember.loadout, equipment: { ...partyMember.loadout.equipment, weapon: override.equipmentId } }
        : partyMember.loadout;
      return deriveActorSetup(actorDefinition, {
        instanceId: partyMember.id,
        actorDefinitionId: partyMember.actorDefinitionId,
        team: "heroes",
        position: { ...spawn.position },
        facing: spawn.facing,
      }, loadout, pack.combatContent, partyMember.id,
      resolveEffectiveCharacterStatProfile(actorDefinition, partyMember.progression, pack.characterRules));
    });
  const actors = [...partyActors, ...staticActors];
  if (source.rules?.damageRequiresFlanking === "enemies" && partyActors.filter(actor =>
    resolveStrike({ ...actor, reactionAvailable: true, shieldRaised: false, defeated: false }, { content: pack.combatContent }).attackMode !== "ranged").length < 2) {
    throw new Error("협공에는 근접 무기를 사용하는 아군 두 명이 필요해요. 동료의 장비를 확인해주세요.");
  }

  return {
    seed: deriveCombatSeed(state.adventureSeed, scenarioId),
    definition: {
      content: pack.combatContent,
      contentIdentity: getContentIdentity(pack),
      scenario: {
        id: source.id,
        name: source.name,
        objective: { ...source.objective },
        ...(source.partyHpFloor === undefined ? {} : { partyHpFloor: source.partyHpFloor }),
        ...(source.rules ? { rules: source.rules } : {}),
        actors,
        map: {
          width: source.map.width,
          height: source.map.height,
          tiles: Object.fromEntries(source.map.tiles.map((tile) => [positionKey(tile.position), tile])),
          objects: Object.fromEntries(source.map.objects.map((object) => [object.id, object])),
        },
      },
    },
  };
}
