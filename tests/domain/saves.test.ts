import { expect, it } from "vitest";
import { deriveCombatSeed, dispatchAdventureCommand } from "../../src/adventure";
import { createCampaignSave, restoreCampaignSave } from "../../src/server/campaign-save";
import { createResumedSessionCoreState, type SessionCoreState } from "../../src/session";
import { act, adventure, adventureContext, context, HERO, saveRecord, reactionCheckpoint } from "../support/session";

it("G-SAVE restore preserves spent battle resources and replaces ephemeral identity", () => {
  const active = act(adventure(), { type: "start-encounter" });
  const before = active.combat!;
  const state: SessionCoreState = { ...active, combat: { ...before,
    actors: { ...before.actors, [HERO]: { ...before.actors[HERO]!, hp: before.actors[HERO]!.hp - 3 } },
    turn: { ...before.turn, actionsRemaining: 1 },
  } };
  const record = saveRecord(state);
  const save = JSON.parse(record.snapshotJson) as Record<string, unknown>;
  for (const key of ["sessionId", "hostPlayerId", "seats", "guestClaims", "revision", "reconnectToken", "control"]) expect(save).not.toHaveProperty(key);
  const restored = restoreCampaignSave(record, context);
  expect(restored.migration).toBeNull();
  const fresh = createResumedSessionCoreState({ sessionId: "fresh-session", playerId: "fresh-host", displayName: "Returning player" }, restored.projection, context);
  expect(fresh.lifecycle).toBe("resume-lobby");
  expect(fresh.sessionId).toBe("fresh-session");
  expect(fresh.seats.map(seat => seat.playerId)).toEqual(["fresh-host"]);
  expect(fresh.guestClaims.byMemberId).toEqual({});
  expect(fresh.combat!.actors[HERO]!.hp).toBe(before.actors[HERO]!.hp - 3);
  expect(fresh.combat!.turn.actionsRemaining).toBe(1);
  expect(fresh.combat!.cardZones).toEqual(before.cardZones);
  expect(fresh.combat!.rng).toEqual(before.rng);
  expect(fresh.adventure!.party.members[HERO]!.progression).toEqual(state.adventure!.party.members[HERO]!.progression);
});

it("G-SAVE pending rewards and earned EXP survive repeated restores without retroactive awards", () => {
  const active = act(adventure(), { type: "start-encounter" });
  const result = dispatchAdventureCommand(active.adventure!, { type: "accept-combat-result", result: {
    encounterId: active.adventure!.currentEncounterId!, combatSeed: deriveCombatSeed(60, active.adventure!.currentEncounterId!), outcome: "victory", finalCombatHash: "settled",
  } }, adventureContext);
  expect(result.accepted).toBe(true);
  const state = { ...active, adventure: result.state, combat: null };
  const record = saveRecord(state);
  for (let iteration = 0; iteration < 2; iteration++) {
    const restored = restoreCampaignSave(record, context).projection;
    expect(restored.adventure.phase).toBe("reward");
    expect(restored.adventure.pendingReward).toEqual(result.state.pendingReward);
    expect(restored.adventure.party.members[HERO]!.progression.experience).toBe(200);
    expect(restored.adventure.collection).toEqual(result.state.collection);
  }
});

it.each(["json", "hash", "version", "content", "health"] as const)("G-SAVE refuses %s damage without rewriting the source", kind => {
  const state = kind === "health" ? act(adventure(), { type: "start-encounter" }) : adventure();
  const record = saveRecord(state);
  let candidate = record;
  const save = createCampaignSave(state);
  if (kind === "json") candidate = { ...record, snapshotJson: "{broken" };
  if (kind === "hash") candidate = { ...record, snapshotHash: "incorrect" };
  if (kind === "version") candidate = { ...record, saveSchemaVersion: 999, snapshotJson: JSON.stringify({ ...save, saveSchemaVersion: 999 }) };
  if (kind === "content") {
    const contentIdentity = { ...record.contentIdentity, fingerprint: "unregistered-previous-content" };
    candidate = { ...record, contentIdentity, snapshotJson: JSON.stringify({ ...save, contentIdentity }) };
  }
  if (kind === "health") {
    // Recompute the valid hash so semantic HP validation, not checksum mismatch, owns this refusal.
    candidate = saveRecord({ ...state, combat: { ...state.combat!, actors: {
      ...state.combat!.actors, [HERO]: { ...state.combat!.actors[HERO]!, hp: state.combat!.actors[HERO]!.maxHp + 1 },
    } } });
  }
  const before = structuredClone(candidate);
  expect(() => restoreCampaignSave(candidate, context)).toThrow(expect.objectContaining({ code:
    kind === "version" ? "SAVE_SCHEMA_UNSUPPORTED" : kind === "content" ? "SAVE_CONTENT_MISMATCH" : "SAVE_CORRUPT",
  }));
  expect(candidate).toEqual(before);
});

it("G-SAVE reaction continuation survives restore and remains answerable after Resume", () => {
  const state = reactionCheckpoint();
  const restored = restoreCampaignSave(saveRecord(state), context).projection;
  expect(restored.combat!.pendingReaction).toEqual(state.combat!.pendingReaction);
  const fresh = createResumedSessionCoreState({ sessionId: "new", playerId: "host", displayName: "Host" }, restored, context);
  const resumed = act(fresh, { type: "resume-adventure" });
  const answered = act(resumed, { type: "pass-reaction", triggerId: restored.combat!.pendingReaction!.triggerId });
  expect(answered.combat!.pendingReaction).toBeNull();
  expect(answered.combat!.actors["goblin-lackey"]!.position).toEqual({ x: 2, y: 2 });
});

it("G-SAVE unspent growth choices survive restore and continue to gate departure", () => {
  const ready = adventure();
  const member = ready.adventure!.party.members[HERO]!;
  const state = { ...ready, adventure: { ...ready.adventure!, party: { members: {
    [HERO]: { ...member, progression: { level: 3, experience: 100, advancements: [] } },
  } } } };
  const restored = restoreCampaignSave(saveRecord(state), context).projection;
  expect(restored.adventure.party.members[HERO]!.progression).toEqual({ level: 3, experience: 100, advancements: [] });
  expect(dispatchAdventureCommand(restored.adventure, { type: "start-encounter" }, adventureContext).accepted).toBe(false);
});
