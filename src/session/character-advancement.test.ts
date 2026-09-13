import { describe, expect, it } from "vitest";
import { FIXTURE_CONTEXT, fixtureBegun, fixtureControl, withProgression } from "../../tests/fixtures/campaign-save";
import { buildAdventureEncounter, dispatchAdventureCommand, resolveEffectiveCharacterStatProfile } from "../adventure";
import { createCombat } from "../game";
import { deriveLoadoutSnapshot } from "../loadout";
import { dispatchSessionIntent, hashSessionGameplayState, type SessionCoreState, type SessionControlContext } from ".";

const pack = FIXTURE_CONTEXT.pack;
const intent = { type: "advance-character", memberId: "party.hero-1", choice: { level: 3, skillIncrease: "athletics" } } as const;
function pending(): SessionCoreState {
  return withProgression(fixtureBegun(), { "party.hero-1": { level: 5, experience: 200, advancements: [] } });
}
const runtime = { definition: pack.adventures[FIXTURE_CONTEXT.adventureId]!, actorDefinitions: pack.actorDefinitions,
  combatContent: pack.combatContent, characterRules: pack.characterRules };

describe("durable gameplay advancement boundary", () => {
  it("blocks the entire party, commits earliest growth once, and feeds the same full-HP combat and Loadout", () => {
    const state = pending();
    const before = structuredClone(state);
    const send = (current: SessionCoreState, value: Parameters<typeof dispatchSessionIntent>[2]) =>
      dispatchSessionIntent(current, current.hostPlayerId, value, FIXTURE_CONTEXT, fixtureControl(current));
    expect(send(state, { type: "start-encounter" }).accepted).toBe(false);
    const three = send(state, intent);
    expect(three.accepted, three.error).toBe(true);
    expect(three.state.revision).toBe(state.revision + 1);
    expect(three.events).toEqual([{ type: "CHARACTER_ADVANCED", memberId: intent.memberId, choice: intent.choice }]);
    expect(hashSessionGameplayState(three.state)).not.toBe(hashSessionGameplayState(state));
    expect(send(three.state, intent).accepted).toBe(false);
    expect(send(three.state, { type: "start-encounter" }).accepted).toBe(false);
    const five = send(three.state, { ...intent, choice: { level: 5, skillIncrease: "medicine", attributeBoosts: ["str", "dex", "con", "wis"] } });
    expect(five.accepted, five.error).toBe(true);
    const started = send(five.state, { type: "start-encounter" });
    expect(started.accepted, started.error).toBe(true);
    const member = started.state.adventure!.party.members[intent.memberId]!;
    const actor = pack.actorDefinitions[member.actorDefinitionId]!;
    const effective = resolveEffectiveCharacterStatProfile(actor, member.progression, pack.characterRules);
    const view = deriveLoadoutSnapshot(actor, member.loadout, pack.combatContent, member.id, effective);
    const built = buildAdventureEncounter(pack, started.state.adventure!);
    const combat = createCombat(built.definition, built.seed).state.actors[member.id]!;
    expect(combat.statProfile).toEqual(effective);
    expect(combat.hp).toBe(view.statistics.maxHp);
    expect(combat.hp).toBe(combat.maxHp);
    expect(state).toEqual(before);
    expect(send(started.state, intent).accepted).toBe(false);
  });

  it("permits only ready/between phases and never changes unrelated members or input on refusal", () => {
    const state = pending().adventure!;
    for (const phase of ["ready", "between-encounters", "combat", "reward", "complete", "failed"] as const) {
      const input = { ...state, phase };
      const result = dispatchAdventureCommand(input, intent, runtime);
      expect(result.accepted, phase).toBe(phase === "ready" || phase === "between-encounters");
      if (result.accepted) expect(result.state.party.members["party.hero-2"]).toBe(input.party.members["party.hero-2"]);
      else { expect(result.state).toBe(input); expect(result.events).toEqual([]); }
    }
    expect(dispatchAdventureCommand(state, { ...intent, memberId: "missing" }, runtime).accepted).toBe(false);
  });

  it.each([1, 2, 3])("uses effective controller authority with %i connected players and host offline fallback", players => {
    const base = withProgression(pending(), { "party.hero-2": { level: 3, experience: 0, advancements: [] } });
    const intent = { type: "advance-character", memberId: "party.hero-2", choice: { level: 3, skillIncrease: "acrobatics" } } as const;
    const guests = Array.from({ length: players - 1 }, (_, i) => ({ playerId: `guest-${i + 1}`, displayName: "Guest", seat: (i + 2) as 2 | 3 }));
    const state: SessionCoreState = { ...base, seats: [...base.seats, ...guests],
      guestClaims: { byMemberId: Object.fromEntries(guests.map((g, i) => [`party.hero-${i + 2}`, g.playerId])) } };
    const control = fixtureControl(state);
    const owner = control.effectiveControllerByMemberId[intent.memberId]!;
    const allowed = dispatchSessionIntent(state, owner, intent, FIXTURE_CONTEXT, control);
    expect(allowed.accepted, allowed.error).toBe(true);
    for (const seat of state.seats.filter(s => s.playerId !== owner)) {
      const denied = dispatchSessionIntent(state, seat.playerId, intent, FIXTURE_CONTEXT, control);
      expect(denied.accepted).toBe(false); expect(denied.state).toBe(state);
    }
    if (players > 1) {
      const offline: SessionControlContext = { connectedPlayerIds: [state.hostPlayerId],
        effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(s => [s.memberId, state.hostPlayerId])) };
      expect(dispatchSessionIntent(state, state.hostPlayerId, intent, FIXTURE_CONTEXT, offline).accepted).toBe(true);
    }
    expect(dispatchSessionIntent({ ...state, lifecycle: "resume-lobby" }, owner, intent, FIXTURE_CONTEXT, control).accepted).toBe(false);
  });
});
