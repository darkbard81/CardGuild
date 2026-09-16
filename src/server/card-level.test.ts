import { describe, expect, it } from "vitest";
import { FIXTURE_CONTEXT, fixtureBegun, fixtureMidCombat, withProgression } from "../../tests/fixtures/campaign-save";
import { hashSessionGameplayState, type SessionCoreState } from "../session";
import { createCampaignSave, restoreCampaignSave } from "./campaign-save";
import type { CampaignSaveRecord } from "./persistence";
import { SessionHost } from "./session-host";
import { createReconnectCredential } from "./credentials";

function stored(state: SessionCoreState): CampaignSaveRecord {
  const save = createCampaignSave(state);
  return { campaignId: "level-campaign", ownerAccountId: "level-owner", campaignRevision: 1,
    saveSchemaVersion: save.saveSchemaVersion, contentIdentity: save.contentIdentity,
    snapshotJson: JSON.stringify(save), snapshotHash: hashSessionGameplayState(state), updatedAt: 1 };
}

function withPrepared(state: SessionCoreState): SessionCoreState {
  const adventure = state.adventure!;
  const member = adventure.party.members["party.hero-1"]!;
  return { ...state, adventure: { ...adventure,
    collection: { ...adventure.collection, cards: { ...adventure.collection.cards, "card.combat-grab": 1 } },
    party: { members: { ...adventure.party.members, [member.id]: { ...member,
      loadout: { ...member.loadout, preparedCards: [...member.loadout.preparedCards, "card.combat-grab"] } } } } } };
}

describe("Card eligibility at live and durable ingress", () => {
  it("refuses a locked prepared card before a Host can publish or a save can restore", () => {
    const state = withPrepared(fixtureBegun());
    expect(() => new SessionHost(state, FIXTURE_CONTEXT, createReconnectCredential().digest)).toThrow("요구 레벨 2");
    expect(() => restoreCampaignSave(stored(state), FIXTURE_CONTEXT)).toThrow("요구 레벨 2");
  });

  it("restores an unlocked card against runtime level instead of the authored level", () => {
    const state = withPrepared(withProgression(fixtureBegun(), { "party.hero-1": { level: 2, experience: 100, advancements: [] } }));
    const result = restoreCampaignSave(stored(state), FIXTURE_CONTEXT);
    expect(result.projection.adventure?.party.members["party.hero-1"]?.progression.level).toBe(2);
    expect(result.projection.adventure?.party.members["party.hero-1"]?.loadout.preparedCards).toContain("card.combat-grab");
    expect(() => new SessionHost(state, FIXTURE_CONTEXT, createReconnectCredential().digest)).not.toThrow();
  });

  it.each(["hand", "drawPile", "discardPile"] as const)("refuses an ineligible Card smuggled into %s", zone => {
    const state = fixtureMidCombat();
    const combat = state.combat!;
    const zones = combat.cardZones["party.hero-1"]!;
    const invalid = { ...state, combat: { ...combat, cardZones: { ...combat.cardZones, "party.hero-1": { ...zones,
      [zone]: [...zones[zone], { id: "smuggled", definitionId: "card.knockdown", source: { kind: "prepared" as const, memberId: "party.hero-1" } }] } } } };
    expect(() => new SessionHost(invalid, FIXTURE_CONTEXT, createReconnectCredential().digest)).toThrow("요구 레벨 4");
    expect(() => restoreCampaignSave(stored(invalid), FIXTURE_CONTEXT)).toThrow("요구 레벨 4");
  });

  it("does not trust an inflated combat level", () => {
    const state = fixtureMidCombat();
    const combat = state.combat!;
    const actor = combat.actors["party.hero-1"]!;
    if (actor.statProfile.kind !== "character") throw new Error("Character required");
    const invalid = { ...state, combat: { ...combat, actors: { ...combat.actors, [actor.id]: { ...actor,
      statProfile: { kind: "character" as const, stats: { ...actor.statProfile.stats, level: 6 } } } } } };
    expect(() => new SessionHost(invalid, FIXTURE_CONTEXT, createReconnectCredential().digest)).toThrow("level or Class");
    expect(() => restoreCampaignSave(stored(invalid), FIXTURE_CONTEXT)).toThrow("level or Class");
  });

  it("preserves and refuses the previous content identity without migrating its deck", () => {
    const record = stored(fixtureBegun());
    const save = createCampaignSave(fixtureBegun());
    const contentIdentity = { packId: "cardguild.m7", packVersion: "0.7.0", fingerprint: "fnv1a64:8bc04f907be49acd" };
    const old = { ...record, contentIdentity, snapshotJson: JSON.stringify({ ...save, contentIdentity }) };
    const before = structuredClone(old);
    expect(() => restoreCampaignSave(old, FIXTURE_CONTEXT)).toThrow("0.7.0");
    expect(old).toEqual(before);
  });
});
