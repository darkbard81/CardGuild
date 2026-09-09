import { describe, expect, it } from "vitest";

import { M0_CONTENT } from "../content/load-m0-content";
import type { CombatEvent } from "../game";
import { buildCombatLog } from "./combat-log";

const NAMES: Record<string, string> = { hero: "Aerin", goblin: "Goblin Lackey" };
const names = (actorId: string): string => NAMES[actorId] ?? actorId;

function log(history: readonly CombatEvent[]): readonly { summary: string; details: readonly string[] }[] {
  return buildCombatLog(history, names, M0_CONTENT);
}

const strike: readonly CombatEvent[] = [
  { type: "ACTION_SPENT", actorId: "hero", actionId: "strike", amount: 1, remaining: 2 },
  {
    type: "CHECK_ROLLED",
    actionActorId: "hero",
    rollerActorId: "hero",
    targetActorId: "goblin",
    label: "Strike",
    roll: 14,
    modifier: 8,
    dc: 14,
    baseDegree: "success",
    degree: "success",
    modifierSources: [],
  },
  { type: "DAMAGE_DEALT", sourceActorId: "hero", targetActorId: "goblin", amount: 12, damageType: "slashing", remainingHp: 4 },
];

describe("combat log", () => {
  it("puts an action and its result on one line and the maths underneath", () => {
    const [entry] = log(strike);
    expect(entry?.summary).toBe("Aerin used Strike — Goblin Lackey took 12 slashing damage (4 HP)");
    expect(entry?.details).toEqual([
      "Cost 1 action · 2 left.",
      "Strike: d20 14 + 8 vs DC 14 → success.",
    ]);
  });

  it("collects every result of one action onto its line", () => {
    const [entry] = log([
      { type: "ACTION_SPENT", actorId: "hero", actionId: "step", amount: 1, remaining: 2 },
      { type: "ACTOR_MOVED", actorId: "hero", path: [{ x: 1, y: 1 }], movementMode: "land" },
      { type: "FACING_CHANGED", actorId: "hero", facing: "south" },
    ]);
    // The actor is already named in the headline, so its own results drop the subject.
    expect(entry?.summary).toBe("Aerin used Step — moved 1 square by land · now facing south");
    expect(entry?.details).toEqual(["Cost 1 action · 2 left."]);
  });

  it("names an action that produced nothing rather than dropping it", () => {
    const [entry] = log([
      { type: "ACTION_SPENT", actorId: "hero", actionId: "stride", amount: 1, remaining: 1 },
    ]);
    expect(entry?.summary).toBe("Aerin used Stride.");
  });

  it("keeps turn and encounter boundaries as their own lines", () => {
    const entries = log([
      { type: "COMBAT_STARTED", scenarioId: "s", seed: 7 },
      { type: "INITIATIVE_ROLLED", actorId: "hero", roll: 20, modifier: 6, total: 26 },
      { type: "TURN_STARTED", actorId: "hero", round: 1 },
      ...strike,
      { type: "TURN_ENDED", actorId: "hero" },
    ]);
    expect(entries.map((entry) => entry.summary)).toEqual([
      "Encounter started · seed 7",
      "Round 1 · Aerin turn",
      "Aerin used Strike — Goblin Lackey took 12 slashing damage (4 HP)",
      "Aerin ended the turn.",
    ]);
    // The initiative roll belongs to the turn it opened, not to the first action.
    expect(entries[1]?.details).toEqual(["Aerin initiative 20 + 6 = 26."]);
  });

  it("gives a result with no action behind it a line of its own", () => {
    const entries = log([
      { type: "TURN_STARTED", actorId: "goblin", round: 2 },
      { type: "CONDITION_REMOVED", actorId: "goblin", condition: "prone" },
    ]);
    expect(entries[1]?.summary).toBe("Goblin Lackey lost prone.");
  });

  it("reports a defeat by name even when the actor is the one acting", () => {
    const [entry] = log([
      { type: "ACTION_SPENT", actorId: "hero", actionId: "strike", amount: 1, remaining: 0 },
      { type: "DAMAGE_DEALT", sourceActorId: "hero", targetActorId: "goblin", amount: 9, damageType: "slashing", remainingHp: 0 },
      { type: "ACTOR_DEFEATED", actorId: "goblin" },
    ]);
    expect(entry?.summary).toBe(
      "Aerin used Strike — Goblin Lackey took 9 slashing damage (0 HP) · Goblin Lackey was defeated",
    );
  });
});
