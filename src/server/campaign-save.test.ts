import { describe, expect, it } from "vitest";

import { hashCombatState, listLegalActions, resolveActionSource } from "../game";
import { hashSessionGameplayState, type SessionCoreState } from "../session";
import { CampaignSaveError, createCampaignSave, restoreCampaignSave } from "./campaign-save";
import {
  FIXTURE_CONTEXT,
  fixtureBegun,
  fixtureAfterFlourish,
  fixtureDispatch,
  fixtureMidCombat,
  legacyStoredSave,
  withProgression,
} from "../../tests/fixtures/campaign-save";
import type { CampaignSaveRecord } from "./persistence";

type MutableSave = {
  saveSchemaVersion: number;
  contentIdentity: { packId: string; packVersion: string; fingerprint: string };
  partySlots: { slot: number; memberId: string; actorDefinitionId: string }[];
  adventure: Record<string, unknown>;
  combat: Record<string, unknown> | null;
};

function storedRecord(
  state: SessionCoreState,
  overrides: Partial<CampaignSaveRecord> = {},
): CampaignSaveRecord {
  const save = createCampaignSave(state);
  return {
    campaignId: "camp_1",
    ownerAccountId: "acc_owner",
    campaignRevision: 3,
    saveSchemaVersion: save.saveSchemaVersion,
    contentIdentity: save.contentIdentity,
    snapshotJson: JSON.stringify(save),
    snapshotHash: hashSessionGameplayState(state),
    updatedAt: 9_000,
    ...overrides,
  };
}

/** Corrupt a stored payload while leaving the metadata consistent with it. */
function tamperedRecord(
  state: SessionCoreState,
  mutate: (save: MutableSave) => void,
): CampaignSaveRecord {
  const save = JSON.parse(JSON.stringify(createCampaignSave(state))) as MutableSave;
  mutate(save);
  return {
    ...storedRecord(state),
    saveSchemaVersion: save.saveSchemaVersion,
    contentIdentity: save.contentIdentity,
    snapshotJson: JSON.stringify(save),
  };
}

function refusal(record: CampaignSaveRecord): CampaignSaveError {
  try {
    restoreCampaignSave(record, FIXTURE_CONTEXT);
  } catch (error) {
    if (error instanceof CampaignSaveError) return error;
    throw error;
  }
  throw new Error("Restoring the save was expected to fail.");
}

describe("campaign save projection", () => {
  it("preserves spent Flourish and rechecks Card eligibility after durable restoration", () => {
    const state = fixtureAfterFlourish();
    const restored = restoreCampaignSave(storedRecord(state), FIXTURE_CONTEXT).projection;
    expect(restored.combat!.turn.usedTraitsByActor).toEqual({ "party.hero-1": ["flourish"] });
    expect(hashSessionGameplayState(restored)).toBe(hashSessionGameplayState(state));
    const combat = restored.combat!;
    const card = listLegalActions(combat, "party.hero-1", FIXTURE_CONTEXT.pack.combatContent).find(action => action.source.id === "flourish-second");
    expect(card).toMatchObject({ enabled: false, reason: "Only one Flourish capability can be used per turn." });
    const wizard = { ...combat.actors["party.hero-1"]!, traits: [{ id: "wizard" }] };
    expect(resolveActionSource(combat, wizard, { kind: "card", id: "flourish-second" }, FIXTURE_CONTEXT.pack.combatContent)).toBeNull();
  });

  it("rejects malformed turn Trait bookkeeping instead of resetting restrictions", () => {
    const state = fixtureAfterFlourish();
    for (const value of [{ ghost: ["flourish"] }, { "party.hero-1": ["unknown-trait"] }, { "party.hero-1": ["flourish", "flourish"] }]) {
      const record = tamperedRecord(state, save => {
        (save.combat!["turn"] as Record<string, unknown>)["usedTraitsByActor"] = value;
      });
      // The hash agrees: this must be refused by shape/reference invariants themselves.
      const decoded = JSON.parse(record.snapshotJson) as ReturnType<typeof createCampaignSave>;
      expect(refusal({ ...record, snapshotHash: hashSessionGameplayState(decoded) }).code).toBe("SAVE_CORRUPT");
    }
  });

  it("round-trips mid-combat gameplay, non-default progression and the collection at the same hash", () => {
    const begun = withProgression(fixtureBegun(), {
      "party.hero-1": { level: 3, experience: 750, advancements: [{ level: 3, skillIncrease: "athletics" }] },
      "party.hero-2": { level: 2, experience: 125, advancements: [] },
    });
    const state = fixtureDispatch(begun, begun.hostPlayerId, { type: "start-encounter" });
    const record = storedRecord(state);

    const { projection: restored, migration } = restoreCampaignSave(record, FIXTURE_CONTEXT);

    // A save already written against the current pack is restored, never rewritten.
    expect(migration).toBeNull();
    expect(restored.adventure).toEqual(state.adventure);
    expect(restored.combat).toEqual(state.combat);
    expect(restored.partySlots).toEqual(state.partySlots);
    expect(restored.adventure.party.members["party.hero-1"]?.progression).toEqual({ level: 3, experience: 750, advancements: [{ level: 3, skillIncrease: "athletics" }] });
    expect(restored.adventure.collection).toEqual(state.adventure?.collection);
    // The exit criterion: the restored projection hashes exactly like the saved session.
    expect(hashSessionGameplayState(restored)).toBe(record.snapshotHash);
    expect(hashCombatState(restored.combat!)).toBe(hashCombatState(state.combat!));
  });

  it("stores gameplay only, never live session identity, and never mutates its input", () => {
    const state = fixtureMidCombat("session-with-identity");
    const before = JSON.stringify(state);

    const save = createCampaignSave(state);
    const json = JSON.stringify(save);

    for (const ephemeral of [
      state.sessionId,
      state.hostPlayerId,
      "guestClaims",
      "revision",
      "lifecycle",
      "seats",
      "reconnect",
      "partyPrepared",
    ]) {
      expect(json).not.toContain(ephemeral);
    }
    expect(Object.keys(save).sort()).toEqual([
      "adventure",
      "combat",
      "contentIdentity",
      "partySlots",
      "saveSchemaVersion",
    ]);
    // The Adventure keeps its own seed, which is where a restore reads it from.
    expect(save.adventure.adventureSeed).toBe(state.adventureSeed);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("orders party slots canonically whatever order the live session held them in", () => {
    const state = fixtureMidCombat();
    const shuffled: SessionCoreState = { ...state, partySlots: [...state.partySlots].reverse() };

    expect(createCampaignSave(shuffled).partySlots.map((slot) => slot.slot)).toEqual([1, 2, 3]);
    // Slot order is gameplay input, so reordering the array must not change the hash.
    expect(hashSessionGameplayState(shuffled)).toBe(hashSessionGameplayState(state));
  });

  it("refuses to save a campaign that has not begun its adventure", () => {
    const lobby = fixtureBegun();
    expect(() => createCampaignSave({ ...lobby, adventure: null, combat: null }))
      .toThrow("requires an active AdventureState");
  });
});

describe("campaign save validation", () => {
  it("reports a malformed payload, a mismatched hash and inconsistent metadata as corruption", () => {
    const state = fixtureMidCombat();

    expect(refusal(storedRecord(state, { snapshotJson: "{not json" })).code).toBe("SAVE_CORRUPT");
    expect(refusal(storedRecord(state, { snapshotHash: "" })).code).toBe("SAVE_CORRUPT");
    expect(refusal(storedRecord(state, { snapshotHash: "0000deadbeef" })).code).toBe("SAVE_CORRUPT");
    expect(refusal(storedRecord(state, { saveSchemaVersion: 1.5 })).code).toBe("SAVE_CORRUPT");
    // Metadata that disagrees with its own payload is corruption, not a version problem.
    expect(refusal(storedRecord(state, {
      contentIdentity: { ...createCampaignSave(state).contentIdentity, fingerprint: "other-fingerprint" },
    })).code).toBe("SAVE_CORRUPT");
  });

  it("rejects a structurally invalid payload rather than filling in the gaps", () => {
    const state = fixtureMidCombat();

    for (const mutate of [
      (save: MutableSave) => { delete (save as Partial<MutableSave>).adventure; },
      (save: MutableSave) => { save.partySlots = []; },
      (save: MutableSave) => { (save as Record<string, unknown>)["sessionId"] = "session-smuggled"; },
      (save: MutableSave) => { save.adventure["phase"] = "napping"; },
      (save: MutableSave) => { (save.combat as Record<string, unknown>)["rng"] = 12; },
    ]) {
      expect(refusal(tamperedRecord(state, mutate)).code).toBe("SAVE_CORRUPT");
    }
  });

  it("refuses an unsupported save schema without guessing at its shape", () => {
    const state = fixtureMidCombat();
    for (const version of [0, 1, 2, 4, 99]) {
      const record = tamperedRecord(state, (save) => { save.saveSchemaVersion = version; });
      expect(refusal(record).code).toBe("SAVE_SCHEMA_UNSUPPORTED");
    }
  });

  it("refuses a save written for unregistered content and preserves it for a later migration", () => {
    const state = fixtureMidCombat();
    for (const identity of [
      { packId: "other-pack" },
      { packVersion: "0.0.1" },
      { fingerprint: "stale-fingerprint" },
      // Two releases back: M9-4's source identity is no longer registered, so it is refused
      // rather than chained through a migration this build does not carry.
      { packVersion: "0.3.0", fingerprint: "fnv1a64:887ee163d92faa57" },
    ]) {
      // A genuinely older save carries the same identity in its header and in its battle.
      const record = tamperedRecord(state, (save) => {
        save.contentIdentity = { ...save.contentIdentity, ...identity };
        if (save.combat) save.combat["contentIdentity"] = { ...save.contentIdentity };
      });
      const error = refusal(record);
      expect(error.code).toBe("SAVE_CONTENT_MISMATCH");
      expect(error.message).toContain("this build serves");
    }
  });

  it("refuses a save whose battle names a different pack than the save header", () => {
    const state = fixtureMidCombat();
    const record = tamperedRecord(state, (save) => {
      if (save.combat) {
        save.combat["contentIdentity"] = { ...save.contentIdentity, packVersion: "0.0.1" };
      }
    });
    const error = refusal(record);
    // Not a migration candidate: no registered step can say what such a row means.
    expect(error.code).toBe("SAVE_CORRUPT");
    expect(error.message).toContain("content identity does not match the save");
  });

  it("rejects a party that the current content pack cannot play", () => {
    const state = fixtureMidCombat();
    const swap = (actorDefinitionId: string) => (save: MutableSave): void => {
      const slot = save.partySlots[0];
      if (!slot) throw new Error("Fixture has no party slot 1.");
      slot.actorDefinitionId = actorDefinitionId;
      const members = save.adventure["party"] as { members: Record<string, { actorDefinitionId: string }> };
      const member = members.members[slot.memberId];
      if (member) member.actorDefinitionId = actorDefinitionId;
    };

    expect(refusal(tamperedRecord(state, swap("missing.hero"))).message).toContain("not in the current content pack");
    // A Creature has no Character stat profile, so it can never be a party member.
    expect(refusal(tamperedRecord(state, swap("enemy.goblin-skirmisher"))).message)
      .toMatch(/not a Character stat profile|not playable/);
    expect(refusal(tamperedRecord(state, (save) => {
      const slot = save.partySlots[1];
      if (slot) slot.memberId = "party.hero-9";
    })).message).toContain("deterministic member id");
  });

  it("rejects a save whose party slots and Adventure party describe different characters", () => {
    const state = fixtureMidCombat();
    const record = tamperedRecord(state, (save) => {
      const slot = save.partySlots[1];
      if (slot) slot.actorDefinitionId = "hero.aerin";
    });
    // hero.aerin is already slot 1, so this is both a duplicate and a mapping break.
    expect(refusal(record).code).toBe("SAVE_CORRUPT");
  });

  it("rejects invalid progression, unknown encounters and an impossible reward phase", () => {
    const state = fixtureMidCombat();
    const members = (save: MutableSave) =>
      (save.adventure["party"] as { members: Record<string, { progression: import("../character").CharacterProgressionState }> }).members;

    expect(refusal(tamperedRecord(state, (save) => {
      const member = members(save)["party.hero-1"];
      if (member) member.progression = { level: 1, experience: 1_000, advancements: [] };
    })).message).toContain("experience");
    expect(refusal(tamperedRecord(state, (save) => {
      save.adventure["completedEncounterIds"] = ["scenario.does-not-exist"];
    })).message).toContain("Saved completed encounter");
    expect(refusal(tamperedRecord(state, (save) => {
      save.adventure["currentEncounterId"] = "scenario.does-not-exist";
    })).message).toContain("Saved current encounter");
    expect(refusal(tamperedRecord(state, (save) => {
      save.adventure["pendingReward"] = { rewardId: "reward.unknown", encounterId: "scenario.does-not-exist", choices: [] };
    })).code).toBe("SAVE_CORRUPT");
  });

  it("rejects a party loadout the saved collection cannot pay for", () => {
    const state = fixtureMidCombat();
    const record = tamperedRecord(state, (save) => {
      save.adventure["collection"] = { equipment: {}, cards: {} };
    });
    expect(refusal(record).message).toContain("not legal");
  });

  it("rejects combat that disagrees with the Adventure phase in either direction", () => {
    const midCombat = fixtureMidCombat();

    expect(refusal(tamperedRecord(midCombat, (save) => { save.combat = null; })).message)
      .toContain("Saved combat phase has no CombatState");
    expect(refusal(tamperedRecord(midCombat, (save) => { save.adventure["phase"] = "ready"; })).message)
      .toContain("requires the combat Adventure phase");
    expect(refusal(tamperedRecord(midCombat, (save) => {
      if (save.combat) save.combat["version"] = 3;
    })).code).toBe("SAVE_CORRUPT");
    expect(refusal(tamperedRecord(midCombat, (save) => {
      if (save.combat) save.combat["scenarioId"] = "scenario.does-not-exist";
    })).code).toBe("SAVE_CORRUPT");
  });

  it("rejects broken actor, turn, card zone, map and reaction references inside combat", () => {
    const state = fixtureMidCombat();
    const combat = (save: MutableSave): Record<string, unknown> => {
      if (!save.combat) throw new Error("Fixture has no CombatState.");
      return save.combat;
    };
    const firstActorId = Object.keys(state.combat?.actors ?? {})[0];
    if (!firstActorId) throw new Error("Fixture combat has no actors.");

    for (const [reason, mutate] of [
      ["hp above maxHp", (save: MutableSave) => {
        const actors = combat(save)["actors"] as Record<string, { hp: number; maxHp: number }>;
        const actor = actors[firstActorId];
        if (actor) actor.hp = actor.maxHp + 5;
      }],
      ["defeat flag", (save: MutableSave) => {
        const actors = combat(save)["actors"] as Record<string, { defeated: boolean }>;
        const actor = actors[firstActorId];
        if (actor) actor.defeated = true;
      }],
      ["active actor", (save: MutableSave) => {
        const turn = combat(save)["turn"] as { activeIndex: number };
        turn.activeIndex = 99;
      }],
      ["initiative order", (save: MutableSave) => {
        const turn = combat(save)["turn"] as { initiativeOrder: string[] };
        turn.initiativeOrder = [...turn.initiativeOrder, "actor.ghost"];
      }],
      ["card zone owner", (save: MutableSave) => {
        const zones = combat(save)["cardZones"] as Record<string, unknown>;
        zones["actor.ghost"] = { drawPile: [], hand: [], discardPile: [] };
      }],
      ["map object target", (save: MutableSave) => {
        const map = combat(save)["map"] as { objects: Record<string, { interaction: { targetTileId: string } }> };
        const object = Object.values(map.objects)[0];
        if (object) object.interaction.targetTileId = "tile.nowhere";
        else map.objects["object.orphan"] = { interaction: { targetTileId: "tile.nowhere" } } as never;
      }],
      ["pending reaction actor", (save: MutableSave) => {
        combat(save)["pendingReaction"] = {
          triggerId: "trigger-1",
          type: "enemy-move",
          sourceActorId: "actor.ghost",
          candidates: [{ actorId: "actor.ghost", cardInstanceId: "card-1", actionId: "action.ghost" }],
          continuation: {
            kind: "move",
            actorId: "actor.ghost",
            actionId: "action.ghost",
            source: { kind: "basic", id: "stride" },
            path: [{ x: 0, y: 0 }],
            destination: { x: 0, y: 0 },
            movementMode: "land",
          },
        };
      }],
      ["command log sequence", (save: MutableSave) => {
        combat(save)["sequence"] = 42;
      }],
    ] as const) {
      const error = refusal(tamperedRecord(state, mutate));
      expect(error.code, reason).toBe("SAVE_CORRUPT");
    }
  });

  describe("content migration", () => {
    /** A stored row written by the previous build, with metadata consistent with it. */
    function legacyRecord(
      state: SessionCoreState,
      mutate: (save: Record<string, unknown>) => void = () => undefined,
    ): CampaignSaveRecord {
      const legacy = legacyStoredSave(state);
      const payload = JSON.parse(JSON.stringify(legacy.save)) as Record<string, unknown>;
      mutate(payload);
      return {
        campaignId: "camp_legacy",
        ownerAccountId: "acc_owner",
        campaignRevision: 7,
        saveSchemaVersion: legacy.save.saveSchemaVersion,
        contentIdentity: payload["contentIdentity"] as CampaignSaveRecord["contentIdentity"],
        snapshotJson: JSON.stringify(payload),
        snapshotHash: legacy.snapshotHash,
        updatedAt: 11_000,
      };
    }

    it.each([fixtureBegun, fixtureMidCombat])("refuses previous gameplay content without mutating its row", make => {
      const record = legacyRecord(make());
      const before = structuredClone(record);
      expect(refusal(record).code).toBe("SAVE_CONTENT_MISMATCH");
      expect(record).toEqual(before);
    });
    it("refuses Save v1 before attempting to reinterpret its Character stats", () => {
      const record = legacyRecord(fixtureMidCombat());
      const payload = JSON.parse(record.snapshotJson);
      payload.saveSchemaVersion = 1;
      payload.adventure.version = 3;
      for (const member of Object.values(payload.adventure.party.members) as { progression: Record<string, unknown> }[]) delete member.progression.advancements;
      const old = { ...record, saveSchemaVersion: 1, snapshotJson: JSON.stringify(payload) };
      const before = structuredClone(old);
      expect(refusal(old).code).toBe("SAVE_SCHEMA_UNSUPPORTED");
      expect(old).toEqual(before);
    });
  });
});

describe("Save v2 Character history", () => {
  it("round-trips pending choices and committed history with the same hash", () => {
    const state = withProgression(fixtureBegun(), {
      "party.hero-1": { level: 5, experience: 25, advancements: [{ level: 3, skillIncrease: "athletics" }] },
    });
    const record = storedRecord(state);
    expect(record.saveSchemaVersion).toBe(3);
    const restored = restoreCampaignSave(record, FIXTURE_CONTEXT).projection;
    expect(restored.adventure).toEqual(state.adventure);
    expect(hashSessionGameplayState(restored)).toBe(record.snapshotHash);
  });
  it("rejects fabricated, future, duplicate, off-schedule and rank-illegal history even when rehashed", () => {
    const state = fixtureBegun();
    for (const progression of [
      { level: 2, experience: 0, advancements: [{ level: 3, skillIncrease: "athletics" }] },
      { level: 3, experience: 0, advancements: [{ level: 3, skillIncrease: "athletics" }, { level: 3, skillIncrease: "medicine" }] },
      { level: 5, experience: 0, advancements: [{ level: 3, skillIncrease: "athletics" },
        { level: 5, skillIncrease: "athletics", attributeBoosts: ["str", "dex", "con", "wis"] }] },
      { level: 3, experience: 0, advancements: [{ level: 3, skillIncrease: "athletics", rank: "legendary" }] },
    ]) {
      const record = tamperedRecord(state, save => {
        const party = save.adventure["party"] as { members: Record<string, { progression: unknown }> };
        party.members["party.hero-1"]!.progression = progression;
      });
      const rehashed = { ...record, snapshotHash: hashSessionGameplayState(JSON.parse(record.snapshotJson)) };
      expect(refusal(rehashed).code).toBe("SAVE_CORRUPT");
    }
  });
});
