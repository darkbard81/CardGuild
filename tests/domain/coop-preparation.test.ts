import { restoredCoopCheckpoint } from "../support/coop-checkpoints";
import { expect, it } from "vitest";
import { createCampaignSave } from "../../src/server/campaign-save";
import { assertSessionInvariants, createResumedSessionCoreState, dispatchSessionIntent, hashSessionGameplayState, isCoopPreparation, joinSessionCore, type SessionCoreState, type SessionIntent } from "../../src/session";
import { recruitmentAct, recruitmentContext as context, recruitmentReward, recruitmentStart, recruitIntent } from "../support/recruitment";
import { HERO, SECOND } from "../support/session";

const recruited = () => recruitmentAct(recruitmentReward(), recruitIntent);
function dispatch(state: SessionCoreState, intent: SessionIntent, player = "host", connected = state.seats.map(seat => seat.playerId)) {
  return dispatchSessionIntent(state, player, intent, context, { connectedPlayerIds: connected,
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => {
      const claimant = state.guestClaims.byMemberId[slot.memberId];
      return [slot.memberId, claimant && connected.includes(claimant) ? claimant : "host"];
    })) });
}
function act(state: SessionCoreState, intent: SessionIntent, player = "host", connected?: string[]) {
  const result = dispatch(state, intent, player, connected); expect(result.accepted, result.error).toBe(true); return result.state;
}
function shared() { return act(recruited(), { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false }); }
function admitted(state = shared()) {
  const result = joinSessionCore(state, { playerId: "guest", displayName: "Guest" }, context);
  expect(result.accepted, result.error).toBe(true); return result.state;
}
function claimed() { return act(admitted(), { type: "select-character", memberId: SECOND }, "guest"); }
function denied(state: SessionCoreState, intent: SessionIntent, player = "host") {
  const result = dispatch(state, intent, player); expect(result.accepted).toBe(false); expect(result.state).toBe(state);
}

it("G-COOP only an explicit existing companion allowlist permits admission; HTTP reserves the sole slot", () => {
  for (const state of [recruitmentStart(), recruitmentReward(), recruited()]) expect(joinSessionCore(state, { playerId: "g", displayName: "G" }, context).accepted).toBe(false);
  for (const memberIds of [[HERO], ["companion.aerin"], ["foreign"], [SECOND, SECOND]]) denied(recruited(), { type: "set-coop-allowed", memberIds, revokeGuests: false });
  const state = admitted();
  expect(joinSessionCore(state, { playerId: "another", displayName: "Another" }, context).errorCode).toBe("SESSION_FULL");
  expect(hashSessionGameplayState(state)).toBe(hashSessionGameplayState(recruited()));
  expect(createCampaignSave(state)).toEqual(createCampaignSave(recruited()));
});

it("G-COOP connected unselected guests block departure; HTTP-only admissions are cancelled on departure", () => {
  const state = admitted();
  denied(state, { type: "start-encounter" });
  const departed = act(state, { type: "start-encounter" }, "host", ["host"]);
  expect(departed.seats).toHaveLength(1); expect(departed.combat).not.toBeNull();
  const solo = act(shared(), { type: "start-encounter" });
  expect(hashSessionGameplayState(solo)).toBe(hashSessionGameplayState(departed));
});

it("G-COOP claims grant only current companion preparation authority, and disconnect restores Host control", () => {
  const state = claimed(); const loadout = state.adventure!.party.members[SECOND]!.loadout;
  denied(state, { type: "select-character", memberId: HERO }, "guest");
  denied(state, { type: "set-loadout", memberId: SECOND, loadout });
  expect(dispatch(state, { type: "set-loadout", memberId: SECOND, loadout }, "guest").accepted).toBe(true);
  expect(dispatch(state, { type: "set-loadout", memberId: SECOND, loadout }, "host", ["host"]).accepted).toBe(true);
  for (const intent of [{ type: "start-encounter" }, { type: "proceed-solo" }, { type: "set-coop-allowed", memberIds: [], revokeGuests: true }, { type: "choose-reward", rewardId: "reward.recruit-aerin", choiceIndex: 0 }] as const) denied(state, intent, "guest");
  denied(state, { type: "set-loadout", memberId: HERO, loadout }, "guest");
});

it("G-COOP combat preserves valid claims while locking new admissions, selection and revocation", () => {
  const state = act(claimed(), { type: "start-encounter" });
  expect(state.guestClaims.byMemberId[SECOND]).toBe("guest");
  expect(joinSessionCore(state, { playerId: "g2", displayName: "G2" }, context).accepted).toBe(false);
  denied(state, { type: "release-character" }, "guest");
  denied(state, { type: "set-coop-allowed", memberIds: [], revokeGuests: true });
  denied(state, { type: "proceed-solo" });
});

it("G-COOP revocation requires confirmation and leaves the party, kit and gameplay unchanged", () => {
  const state = claimed(); denied(state, { type: "set-coop-allowed", memberIds: [], revokeGuests: false });
  const revoked = act(state, { type: "set-coop-allowed", memberIds: [], revokeGuests: true });
  expect(revoked.seats).toHaveLength(1); expect(revoked.guestClaims.byMemberId).toEqual({});
  expect(createCampaignSave(revoked)).toEqual(createCampaignSave(state));
  expect(act(state, { type: "leave-preparation" }, "guest").seats).toHaveLength(1);
});

it("G-COOP solo departure clears live state only on success and cannot bypass growth or Loadout validation", () => {
  const state = claimed(); const solo = act(state, { type: "proceed-solo" });
  expect(solo.seats).toHaveLength(1); expect(solo.coopAllowedMemberIds).toEqual([]); expect(solo.guestClaims.byMemberId).toEqual({});
  const adventure = structuredClone(state.adventure!);
  const hero = adventure.party.members[HERO]!;
  const growth = { ...state, adventure: { ...adventure, party: { members: { ...adventure.party.members,
    [HERO]: { ...hero, progression: { ...hero.progression, level: 3, experience: 0, advancements: [] } } } } } };
  denied(growth, { type: "proceed-solo" });
  const badKit = { ...state, adventure: { ...adventure, party: { members: { ...adventure.party.members,
    [HERO]: { ...hero, loadout: { equipment: { weapon: "missing" }, preparedCards: [] } } } } } };
  denied(badKit, { type: "proceed-solo" });
});

it("G-COOP restore resets all live delegation; saved Combat may be shared and resumed without rebuilding", () => {
  const combat = act(claimed(), { type: "start-encounter" });
  const restored = createResumedSessionCoreState({ sessionId: "fresh", playerId: "host", displayName: "Host" }, createCampaignSave(combat), context);
  expect(restored.coopAllowedMemberIds).toEqual([]); expect(restored.guestClaims.byMemberId).toEqual({});
  const sharedRestore = act(restored, { type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  const joined = admitted(sharedRestore); denied(joined, { type: "resume-adventure" });
  const resumed = act(act(joined, { type: "select-character", memberId: SECOND }, "guest"), { type: "resume-adventure" });
  expect(resumed.combat).toEqual(combat.combat); expect(hashSessionGameplayState(resumed)).toBe(hashSessionGameplayState(combat));
});

it.each(["reward", "complete", "failed"] as const)("G-COOP active %s locks admission/designation/selection even with an existing allowlist", phase => {
  const initial = claimed();
  const state = { ...initial, adventure: { ...initial.adventure!, phase } };
  expect(joinSessionCore(state, { playerId: "g2", displayName: "G2" }, context).accepted).toBe(false);
  denied(state, { type: "set-coop-allowed", memberIds: [], revokeGuests: true });
  denied(state, { type: "select-character", memberId: SECOND }, "guest");
  denied(state, { type: "proceed-solo" });
});

it.each(["reward", "complete", "failed"] as const)("G-COOP restored %s rejects delegation/admission/selection but permits unchanged Host Resume", phase => {
  const { state, context: authority, saved } = restoredCoopCheckpoint(phase);
  const control = { connectedPlayerIds: ["host"], effectiveControllerByMemberId: { [HERO]: "host", [SECOND]: "host" } };
  const send = (intent: SessionIntent) => dispatchSessionIntent(state, "host", intent, authority, control);
  const shared = send({ type: "set-coop-allowed", memberIds: [SECOND], revokeGuests: false });
  expect(shared.accepted).toBe(false); expect(shared.state).toBe(state);
  expect(joinSessionCore(state, { playerId: "guest", displayName: "Guest" }, authority).accepted).toBe(false);
  expect(joinSessionCore({ ...state, coopAllowedMemberIds: [SECOND] },
    { playerId: "guest", displayName: "Guest" }, authority).errorCode).toBe("ROSTER_LOCKED");
  // Also reject stale live delegation produced by the previous overly broad Resume rule.
  const stale = { ...state, coopAllowedMemberIds: [SECOND], seats: [...state.seats, { seat: 2 as const, playerId: "guest", displayName: "Guest" }] };
  assertSessionInvariants(stale);
  const selected = dispatchSessionIntent(stale, "guest", { type: "select-character", memberId: SECOND }, authority, control);
  expect(selected.accepted).toBe(false); expect(selected.state).toBe(stale);
  const resumed = send({ type: "resume-adventure" });
  expect(resumed.accepted).toBe(true);
  expect(createCampaignSave(resumed.state)).toEqual(saved);
});

it("G-COOP unfinished saved Combat alone is a Resume delegation boundary", () => {
  const combat = act(recruited(), { type: "start-encounter" });
  const restored = createResumedSessionCoreState({ sessionId: "resume-combat", playerId: "host", displayName: "Host" }, createCampaignSave(combat), context);
  expect(isCoopPreparation(restored)).toBe(true);
  expect(isCoopPreparation({ ...restored, combat: null })).toBe(false);
  expect(isCoopPreparation({ ...restored, combat: { ...restored.combat!, outcome: "victory" } })).toBe(false);
});

it("G-COOP a protagonist without companions retains normal and explicit solo departure", () => {
  const state = recruitmentStart();
  const normal = act(state, { type: "start-encounter" });
  const solo = act(state, { type: "proceed-solo" });
  expect(solo.combat).not.toBeNull();
  expect(hashSessionGameplayState(solo)).toBe(hashSessionGameplayState(normal));
});
