import { expect, it } from "vitest";
import {
  createResumedSessionCoreState, dispatchSessionIntent, joinSessionCore,
  type SessionCoreState, type SessionIntent,
} from "../../src/session";
import { createCampaignSave } from "../../src/server/campaign-save";
import { act, context, HERO, SECOND, prepared, reactionCheckpoint } from "../support/session";

function dispatch(state: SessionCoreState, player: string, intent: SessionIntent) {
  return dispatchSessionIntent(state, player, intent, context, {
    connectedPlayerIds: ["host", "guest"], effectiveControllerByMemberId: { [HERO]: "host", [SECOND]: "guest" },
  });
}
function coopLobby() {
  const joined = joinSessionCore(prepared(true), { playerId: "guest", displayName: "Guest" }, context);
  if (!joined.accepted) throw new Error(joined.error);
  return joined.state;
}
function refuses(state: SessionCoreState, player: string, intent: SessionIntent) {
  const result = dispatch(state, player, intent);
  expect(result.accepted).toBe(false);
  expect(result.state).toEqual(state);
}

it("G-AUTHORITY guests must claim their own character before host departure and cannot prepare the shared party", () => {
  const lobby = coopLobby();
  refuses(lobby, "guest", { type: "set-party-composition", actorDefinitionIds: ["hero.aerin"] });
  refuses(lobby, "host", { type: "begin-adventure" });
  refuses(lobby, "guest", { type: "select-character", memberId: HERO });
  const claimed = act(lobby, { type: "select-character", memberId: SECOND }, "guest");
  refuses(claimed, "guest", { type: "begin-adventure" });
  expect(dispatch(claimed, "host", { type: "begin-adventure" }).accepted).toBe(true);
});

it("G-AUTHORITY active preparation permits only the character's controller and only host departure", () => {
  const claimed = act(coopLobby(), { type: "select-character", memberId: SECOND }, "guest");
  const state = act(claimed, { type: "begin-adventure" });
  const loadout = state.adventure!.party.members[SECOND]!.loadout;
  refuses(state, "guest", { type: "start-encounter" });
  refuses(state, "host", { type: "set-loadout", memberId: SECOND, loadout });
  refuses(state, "stranger", { type: "set-loadout", memberId: SECOND, loadout });
  expect(dispatch(state, "guest", { type: "set-loadout", memberId: SECOND, loadout }).accepted).toBe(true);
});

it("G-AUTHORITY only the active actor's controller may end its turn; combat locks preparation", () => {
  const claimed = act(coopLobby(), { type: "select-character", memberId: SECOND }, "guest");
  let state = act(act(claimed, { type: "begin-adventure" }), { type: "start-encounter" });
  // A legal initiative checkpoint isolates the permission table from the initiative RNG.
  const combat = state.combat!;
  state = { ...state, combat: { ...combat, turn: { ...combat.turn, activeIndex: combat.turn.initiativeOrder.indexOf(SECOND), activeActorId: SECOND } } };
  refuses(state, "host", { type: "end-turn", facing: "south" });
  refuses(state, "guest", { type: "set-loadout", memberId: SECOND, loadout: state.adventure!.party.members[SECOND]!.loadout });
  expect(dispatch(state, "guest", { type: "end-turn", facing: "south" }).accepted).toBe(true);
});

it("G-AUTHORITY restored gameplay is gated until the host resumes", () => {
  const active = act(prepared(), { type: "begin-adventure" });
  const state = createResumedSessionCoreState({ sessionId: "fresh-session", playerId: "host", displayName: "Host" }, createCampaignSave(active), context);
  refuses(state, "host", { type: "start-encounter" });
  refuses(state, "host", { type: "set-loadout", memberId: HERO, loadout: active.adventure!.party.members[HERO]!.loadout });
  refuses(state, "stranger", { type: "resume-adventure" });
  const resumed = dispatch(state, "host", { type: "resume-adventure" });
  expect(resumed.accepted).toBe(true);
  expect(dispatch(resumed.state, "host", { type: "start-encounter" }).accepted).toBe(true);
});

it("G-AUTHORITY only the head reactor's controller can answer the current trigger", () => {
  const state = reactionCheckpoint();
  const pending = state.combat!.pendingReaction!;
  refuses(state, "guest", { type: "pass-reaction", triggerId: pending.triggerId });
  refuses(state, "host", { type: "pass-reaction", triggerId: "previous-trigger" });
  refuses(state, "guest", { type: "use-reaction", triggerId: pending.triggerId, cardInstanceId: pending.candidates[0]!.cardInstanceId });
  expect(dispatch(state, "host", { type: "pass-reaction", triggerId: pending.triggerId }).accepted).toBe(true);
});
