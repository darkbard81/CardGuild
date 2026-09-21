import { expect, it } from "vitest";
import { assertAdventureCharacterInvariants, applyExperience, buildAdventureEncounter, dispatchAdventureCommand, deriveCombatSeed } from "../../src/adventure";
import { resolvePartyMemberDefinition } from "../../src/character/member";
import { compileContentPack } from "../../src/content/compile-content";
import { deriveLoadoutSnapshot, resolveLoadoutStatProfile } from "../../src/loadout";
import { createResumedSessionCoreState, hashSessionGameplayState, joinSessionCore, type SessionCoreState, type SessionIntent } from "../../src/session";
import { createCampaignSave, restoreCampaignSave } from "../../src/server/campaign-save";
import { SessionHost } from "../../src/server/session-host";
import { validateClientMessage } from "../../src/protocol/validate-message";
import { validateSnapshotState } from "../../src/protocol/validate-snapshot";
import { PROTOCOL_VERSION } from "../../src/protocol";
import { creationAct, creationContext as context, creationDispatch, creationIntent, creationLobby, creationSource } from "../support/creation";
import { HERO, SECOND, saveRecord } from "../support/session";

it("G-IDENTITY seed=63 creates one Human with one starter, keeps gender cosmetic and Campaigns independent", () => {
  const original = structuredClone(context.pack);
  const female = creationAct(creationLobby(), creationIntent);
  const male = creationAct(creationLobby("another-campaign"), { ...creationIntent, name: "다른 이름", gender: "male" });
  expect(female.adventure?.phase).toBe("between-encounters");
  expect(female.combat).toBeNull();
  expect(Object.keys(female.adventure!.party.members)).toEqual([HERO]);
  const member = female.adventure!.party.members[HERO]!;
  expect(member.identity).toEqual({ origin: "player-created", name: "하늘", gender: "female", creationPresetId: creationIntent.creationPresetId });
  expect(member.progression).toEqual({ level: 1, experience: 0, advancements: [] });
  expect(female.adventure!.collection).toEqual(male.adventure!.collection);
  for (const id of Object.values(member.loadout.equipment)) expect(female.adventure!.collection.equipment[id]).toBe(1);
  const left = creationAct(female, { type: "start-encounter" }).combat!.actors[HERO]!;
  const right = creationAct(male, { type: "start-encounter" }).combat!.actors[HERO]!;
  expect(left.name).toBe("하늘"); expect(right.name).toBe("다른 이름");
  expect(left.appearanceKey).toBe("hero.nera"); expect(right.appearanceKey).toBe("hero.aerin");
  expect(left.statProfile).toEqual(right.statProfile);
  expect(left.deckContributions).toEqual(right.deckContributions);
  expect(context.pack).toEqual(original);
  expect(female.contentIdentity).toEqual(male.contentIdentity);
  const duplicate = creationDispatch(female, creationIntent);
  expect(duplicate.accepted).toBe(false); expect(duplicate.state).toBe(female);
  expect(joinSessionCore(female, { playerId: "guest", displayName: "Guest" }, context).accepted).toBe(false);
  const guestLobby = joinSessionCore(creationLobby(), { playerId: "guest", displayName: "Guest" }, context).state;
  expect(creationDispatch(guestLobby, creationIntent, "guest").accepted).toBe(false);
  expect(creationDispatch(guestLobby, creationIntent).accepted).toBe(false);
});

it.each([
  { name: "" }, { name: " padded " }, { name: "a\nb" }, { name: "x".repeat(41) },
  { gender: "unknown" }, { creationPresetId: "unregistered" }, { memberId: "account-owned-id" },
  { traits: [{ id: "elf" }] }, { progression: { level: 20 } }, { loadout: { equipment: {} } },
])("G-IDENTITY seed=63 refuses client-authored or illegal creation input %j", change => {
  const state = creationLobby();
  const intent = { ...creationIntent, ...change } as SessionIntent;
  const result = creationDispatch(state, intent);
  expect(result.accepted).toBe(false); expect(result.state).toBe(state);
  if (!("name" in change)) expect(validateClientMessage({ v: PROTOCOL_VERSION, type: "intent", requestId: "invalid", expectedRevision: 0, intent }).ok).toBe("creationPresetId" in change);
});

it("G-IDENTITY presets validate Human, complete Build, appearance and starter eligibility", () => {
  const preset = creationSource.creationPresets[0]!;
  for (const actorDefinitionId of ["missing", "hero.lyra", "goblin.lackey"]) {
    expect(() => compileContentPack({ ...creationSource, creationPresets: [{ ...preset, actorDefinitionId }] })).toThrow();
  }
  expect(() => compileContentPack({ ...creationSource, creationPresets: [{ ...preset, appearance: { male: "", female: "hero.nera" } }] })).toThrow();
  expect(() => compileContentPack({ ...creationSource, creationPresets: [preset, preset] })).toThrow();
  const cleric = creationAct(creationLobby(), { ...creationIntent, creationPresetId: "test.human-cleric" });
  expect(resolvePartyMemberDefinition(cleric.adventure!.party.members[HERO]!, context.pack).traits).toContainEqual({ id: "cleric" });
});

function withCompanion(): SessionCoreState {
  const state = creationAct(creationLobby(), creationIntent);
  const runtime = { ...context.pack, definition: context.pack.adventures[context.adventureId]! };
  const encounterId = state.adventure!.currentEncounterId!;
  const victory = dispatchAdventureCommand({ ...state.adventure!, phase: "combat" }, { type: "accept-combat-result",
    result: { encounterId, outcome: "victory", combatSeed: deriveCombatSeed(state.adventureSeed, encounterId), finalCombatHash: "fixture" } }, runtime);
  const reward = { ...state, adventure: victory.state };
  return creationAct(reward, { type: "choose-reward", rewardId: victory.state.pendingReward!.rewardId, choiceIndex: 0 });
}

it("G-IDENTITY same-Class companion keeps its own name, growth, Loadout and HP through save and next combat", () => {
  const initial = withCompanion();
  const hero = initial.adventure!.party.members[HERO]!;
  const grown: SessionCoreState = { ...initial, adventure: { ...initial.adventure!, party: { members: {
    ...initial.adventure!.party.members, [HERO]: { ...hero, progression: applyExperience(hero.progression, 2100).progression },
  } } } };
  const advanced = creationAct(grown, { type: "advance-character", memberId: HERO, choice: { level: 3, skillIncrease: "athletics" } });
  const changed = creationAct(advanced, { type: "set-loadout", memberId: HERO, loadout: { equipment: {}, preparedCards: [] } });
  const restored = restoreCampaignSave(saveRecord(changed), context).projection;
  const fresh = createResumedSessionCoreState({ sessionId: "fresh", playerId: "host", displayName: "New account label" }, restored, context);
  expect(fresh.guestClaims.byMemberId).toEqual({});
  const next = creationAct(creationAct(fresh, { type: "resume-adventure" }), { type: "start-encounter" });
  const player = next.combat!.actors[HERO]!, companion = next.combat!.actors[SECOND]!;
  expect(player.name).toBe("하늘"); expect(companion.name).toBe("Aerin");
  expect(player.statProfile.stats.level).toBe(3); expect(companion.statProfile.stats.level).toBe(1);
  expect(player.equipmentIds).toEqual([]); expect(companion.equipmentIds.length).toBeGreaterThan(0);
  expect(player.maxHp).toBeGreaterThan(companion.maxHp);
  expect(restored.adventure.party.members[HERO]!.progression).toEqual({ level: 3, experience: 300, advancements: [{ level: 3, skillIncrease: "athletics" }] });
  const member = restored.adventure.party.members[HERO]!;
  const preview = deriveLoadoutSnapshot(resolvePartyMemberDefinition(member, context.pack), member.loadout, context.pack.combatContent, member.id, resolveLoadoutStatProfile(member, context.pack));
  expect(player.maxHp).toBe(preview.statistics.maxHp);
  const damaged = { ...next, combat: { ...next.combat!, actors: { ...next.combat!.actors, [HERO]: { ...player, hp: player.hp - 5 } } } };
  const roundtrip = restoreCampaignSave(saveRecord(damaged), context).projection;
  expect(roundtrip.combat!.actors[HERO]!.hp).toBe(player.hp - 5);
  expect(roundtrip.combat!.actors[SECOND]!.hp).toBe(companion.hp);
  expect(creationAct(creationLobby(), creationIntent).adventure!.party.members[HERO]!.progression.level).toBe(1);
});

it("G-IDENTITY-SAVE creation checkpoint round-trips before combat, hashes identity and excludes live credentials", () => {
  const state = creationAct(creationLobby(), creationIntent);
  const record = saveRecord(state);
  const restored = restoreCampaignSave(record, context).projection;
  expect(restored.adventure).toEqual(state.adventure);
  expect(restored.combat).toBeNull();
  expect(record.snapshotJson).not.toContain(state.sessionId);
  const save = createCampaignSave(state);
  for (const key of ["hostPlayerId", "seats", "guestClaims", "reconnectToken", "control"]) expect(save).not.toHaveProperty(key);
  const other = creationAct(creationLobby(), { ...creationIntent, name: "Someone else" });
  expect(hashSessionGameplayState(state)).not.toBe(hashSessionGameplayState(other));
  const combat = creationAct(state, { type: "start-encounter" });
  const otherCombat = creationAct(other, { type: "start-encounter" });
  expect(combat.combat!.setupFingerprint).not.toBe(otherCombat.combat!.setupFingerprint);
  expect(buildAdventureEncounter(context.pack, combat.adventure!).definition.scenario.actors[0]!.name).toBe("하늘");
});

it.each(["union", "zero", "two", "preset", "template", "history", "slot", "combat-name", "combat-appearance"] as const)(
  "G-IDENTITY-SAVE seed=63 rejects %s at disk and SessionHost ingress", kind => {
    const base = kind.startsWith("combat-") ? creationAct(withCompanion(), { type: "start-encounter" }) : withCompanion();
    const bad = structuredClone(base);
    const member = bad.adventure!.party.members[HERO]!;
    if (kind === "union") Object.assign(member.identity, { recruitmentSource: "injected" });
    if (kind === "zero") Object.assign(member, { identity: { origin: "companion", recruitmentSource: "test" } });
    if (kind === "two") Object.assign(bad.adventure!.party.members[SECOND]!, { identity: member.identity });
    if (kind === "preset") Object.assign(member.identity, { creationPresetId: "missing" });
    if (kind === "template") Object.assign(member, { actorDefinitionId: "hero.lyra" });
    if (kind === "history") Object.assign(member, { progression: { level: 3, experience: 0, advancements: [{ level: 3, skillIncrease: "not-a-skill" }] } });
    if (kind === "slot") Object.assign(bad.partySlots[0]!, { memberId: "renumbered" });
    if (kind === "combat-name") Object.assign(bad.combat!.actors[HERO]!, { name: "Aerin" });
    if (kind === "combat-appearance") Object.assign(bad.combat!.actors[HERO]!, { appearanceKey: "hero.aerin" });
    expect(() => restoreCampaignSave(saveRecord(bad), context)).toThrow(expect.objectContaining({ code: "SAVE_CORRUPT" }));
    expect(() => new SessionHost(bad, context, "unused-digest")).toThrow();
  },
);

it("G-IDENTITY-SAVE non-Human preset and illegal template Build cannot enter a live host", () => {
  const state = creationAct(creationLobby(), creationIntent);
  const actor = context.pack.actorDefinitions["hero.aerin"]!;
  const nonHuman = { ...context.pack, actorDefinitions: { ...context.pack.actorDefinitions, [actor.id]: {
    ...actor, traits: actor.traits.map(t => t.id === "human" ? { id: "elf" } : t),
  } } };
  expect(() => assertAdventureCharacterInvariants(state.adventure!, nonHuman)).toThrow();
  expect(() => new SessionHost(state, { ...context, pack: nonHuman }, "digest")).toThrow();
  const invalidBuild = structuredClone(context.pack);
  Object.assign(invalidBuild.actorDefinitions[actor.id]!.character!, { build: { freeBoosts: ["str", "str", "str", "str"], trainedSkills: [] } });
  expect(() => new SessionHost(state, { ...context, pack: invalidBuild }, "digest")).toThrow();
});

it("G-IDENTITY-WIRE malformed union is refused before a snapshot is displayed", () => {
  const state = creationAct(creationLobby(), creationIntent);
  const snapshot = { v: PROTOCOL_VERSION, type: "snapshot" as const, revision: state.revision, controlRevision: 0,
    state, gameplayHash: hashSessionGameplayState(state), events: [], control: { connectedPlayerIds: ["host"], effectiveControllerByMemberId: { [HERO]: "host" } } };
  expect(validateSnapshotState(snapshot)).toBe(true);
  Object.assign(state.adventure!.party.members[HERO]!.identity, { gender: "invalid" });
  expect(validateSnapshotState(snapshot)).toBe(false);
});


it("G-IDENTITY-SAVE Save v3 is unsupported and its original bytes are preserved", () => {
  const state = creationAct(creationLobby(), creationIntent);
  const current = saveRecord(state);
  const old = { ...current, saveSchemaVersion: 3, snapshotJson: JSON.stringify({ ...createCampaignSave(state), saveSchemaVersion: 3 }) };
  const original = structuredClone(old);
  expect(() => restoreCampaignSave(old, context)).toThrow(expect.objectContaining({ code: "SAVE_SCHEMA_UNSUPPORTED" }));
  expect(old).toEqual(original);
});

it.each(["bard", "champion", "cleric", "druid", "fighter", "ranger", "rogue", "witch", "wizard"])(
  "G-IDENTITY production Human %s starts solo with identical gameplay across gender variants", async classId => {
    const { context: production, lobby, act } = await import("../support/session");
    const make = (gender: "male" | "female") => act(lobby(), {
      type: "create-character", name: "하늘", gender, creationPresetId: `human.${classId}`,
    });
    const male = make("male"), female = make("female");
    const member = female.adventure!.party.members[HERO]!;
    const definition = resolvePartyMemberDefinition(member, production.pack);
    expect(definition.traits).toEqual(expect.arrayContaining([{ id: "human" }, { id: classId }]));
    expect(member.progression).toEqual({ level: 1, experience: 0, advancements: [] });
    expect(female.adventure!.collection).toEqual(male.adventure!.collection);
    const left = act(male, { type: "start-encounter" }).combat!.actors[HERO]!;
    const right = act(female, { type: "start-encounter" }).combat!.actors[HERO]!;
    expect(left.appearanceKey).toBe(`human.${classId}.male`);
    expect(right.appearanceKey).toBe(`human.${classId}.female`);
    expect(left.statProfile).toEqual(right.statProfile);
    expect(left.deckContributions).toEqual(right.deckContributions);
    expect(Object.keys(female.adventure!.party.members)).toEqual([HERO]);
    expect(act(female, { type: "start-encounter" }).combat!.actors[HERO]!.name).toBe("하늘");
  },
);
