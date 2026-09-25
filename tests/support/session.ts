import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import {
  createSessionCoreState, dispatchServerCombatCommand, dispatchSessionIntent, hashSessionGameplayState,
  type SessionCoreState, type SessionIntent,
} from "../../src/session";
import { createCampaignSave } from "../../src/server/campaign-save";
import type { CampaignSaveRecord } from "../../src/server/persistence/types";

export const context = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };
export const HERO = "party.hero-1";
export const SECOND = "party.hero-2";
export const adventureContext = {
  ...context.pack, definition: PRODUCTION_CONTENT.adventure,
};

export function lobby(): SessionCoreState {
  return createSessionCoreState({ sessionId: "session-contract", playerId: "host", displayName: "Host", adventureSeed: 60 }, context);
}

export function act(state: SessionCoreState, intent: SessionIntent, playerId = "host"): SessionCoreState {
  const result = dispatchSessionIntent(state, playerId, intent, context, {
    connectedPlayerIds: state.seats.map(seat => seat.playerId),
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => [slot.memberId, state.guestClaims.byMemberId[slot.memberId] ?? "host"])),
  });
  if (!result.accepted) throw new Error(`Fixture intent ${intent.type} rejected: ${result.error}`);
  return result.state;
}

export function prepared(two = false): SessionCoreState {
  return act(lobby(), { type: "set-party-composition", actorDefinitionIds: two ? ["hero.aerin", "hero.lyra"] : ["hero.aerin"] });
}

export function adventure(two = false): SessionCoreState {
  return act(prepared(two), { type: "begin-adventure" });
}

export function saveRecord(state: SessionCoreState): CampaignSaveRecord {
  const save = createCampaignSave(state);
  return {
    campaignId: "campaign-contract", ownerAccountId: "account-contract", campaignRevision: 1, saveSchemaVersion: save.saveSchemaVersion,
    contentIdentity: save.contentIdentity, snapshotJson: JSON.stringify(save),
    snapshotHash: hashSessionGameplayState(state), updatedAt: 1,
  };
}

export function combatCheckpoint(): SessionCoreState {
  const session = act(adventure(), { type: "start-encounter" });
  const combat = session.combat!;
  return { ...session, combat: { ...combat, turn: { ...combat.turn,
    activeIndex: combat.turn.initiativeOrder.indexOf(HERO), activeActorId: HERO,
  } } };
}

export function reactionCheckpoint(): SessionCoreState {
  // This checkpoint tests a later acquired reaction, not the two-card starter deck.
  const ready = adventure();
  const member = ready.adventure!.party.members[HERO]!;
  const equipped: SessionCoreState = { ...ready, adventure: { ...ready.adventure!,
    collection: { ...ready.adventure!.collection, cards: { ...ready.adventure!.collection.cards, "card.reactive-strike": 1 } },
    party: { members: { [HERO]: { ...member, loadout: { ...member.loadout,
      preparedCards: ["card.reactive-strike"],
    } } } },
  } };
  const active = act(equipped, { type: "start-encounter" });
  const combat = active.combat!;
  const heroTurn = { ...active, combat: { ...combat, turn: { ...combat.turn,
    activeIndex: combat.turn.initiativeOrder.indexOf(HERO), activeActorId: HERO,
  } } };
  const ended = act(heroTurn, { type: "end-turn", facing: "east" });
  const result = dispatchServerCombatCommand(ended, {
    type: "use-action", id: "fixture-enemy-move", sequence: 0,
    actorId: "slime-trainee", action: { kind: "basic", id: "stride" },
    target: { kind: "tile", position: { x: 2, y: 2 } },
  }, context);
  if (!result.accepted || !result.state.combat?.pendingReaction) throw new Error("Reaction checkpoint did not open");
  return result.state;
}
