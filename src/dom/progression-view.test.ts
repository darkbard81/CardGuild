import { describe, expect, it } from "vitest";

import type { AdventureEvent } from "../adventure";
import { summarizeGrowth, trackGrowthSummary, type GrowthNotice } from "./progression-view";

function gained(memberId: string, amount: number, from: number, to: number, experience: number): AdventureEvent {
  return {
    type: "EXPERIENCE_GAINED",
    encounterId: "encounter.goblin-chief",
    memberId,
    amount,
    previous: { level: from, experience: 0 },
    next: { level: to, experience },
  };
}

function levelUp(memberId: string, previousLevel: number, level: number): AdventureEvent {
  return { type: "LEVEL_UP", encounterId: "encounter.goblin-chief", memberId, previousLevel, level };
}

const VICTORY: readonly AdventureEvent[] = [
  gained("party.hero-1", 400, 1, 3, 250),
  gained("party.hero-2", 400, 1, 1, 400),
  levelUp("party.hero-1", 1, 2),
  levelUp("party.hero-1", 2, 3),
];

const FACTS = {
  sessionId: "session-a",
  revision: 12,
  inCombat: false,
  lastCompletedEncounterId: "encounter.goblin-chief",
} as const;

describe("growth summary", () => {
  it("collapses several levels into one jump and reports the remainder each member kept", () => {
    const summary = summarizeGrowth(VICTORY);
    expect(summary).toEqual({
      encounterId: "encounter.goblin-chief",
      entries: [
        { memberId: "party.hero-1", amount: 400, fromLevel: 1, toLevel: 3, experience: 250 },
        { memberId: "party.hero-2", amount: 400, fromLevel: 1, toLevel: 1, experience: 400 },
      ],
    });
    expect(summarizeGrowth([])).toBeNull();
    // A Level-Up with no award behind it is out of contract, and is not invented into one.
    expect(summarizeGrowth([levelUp("party.hero-1", 1, 2)])).toBeNull();
  });
});

describe("growth notice lifecycle", () => {
  const notice = trackGrowthSummary(null, FACTS, VICTORY) as GrowthNotice;

  it("raises a notice from a committed victory batch", () => {
    expect(notice.sessionId).toBe("session-a");
    expect(notice.revision).toBe(12);
    expect(notice.summary.entries).toHaveLength(2);
  });

  it("survives the reward choice, a Loadout round trip and a re-rendered snapshot", () => {
    // Later revisions that carry no growth: choosing a reward, changing a loadout.
    const afterReward = trackGrowthSummary(notice, { ...FACTS, revision: 13 }, []);
    const afterLoadout = trackGrowthSummary(afterReward, { ...FACTS, revision: 14 }, []);
    expect(afterLoadout).toBe(notice);
    // A resync or control-only snapshot re-delivers the same revision, or an older one.
    expect(trackGrowthSummary(notice, FACTS, VICTORY)).toBe(notice);
    expect(trackGrowthSummary(notice, { ...FACTS, revision: 11 }, VICTORY)).toBe(notice);
  });

  it("clears when the party walks into the next battle or lands in another session", () => {
    expect(trackGrowthSummary(notice, { ...FACTS, revision: 15, inCombat: true }, [])).toBeNull();
    expect(trackGrowthSummary(notice, { ...FACTS, sessionId: "session-b", revision: 1 }, [])).toBeNull();
    // A fresh Continue replays no events, so the new session starts with nothing to report.
    expect(trackGrowthSummary(null, { ...FACTS, sessionId: "session-b", revision: 0 }, [])).toBeNull();
  });

  it("replaces the notice when a later victory publishes its own growth", () => {
    const later = trackGrowthSummary(notice, { ...FACTS, revision: 30 }, [gained("party.hero-1", 350, 3, 4, 0)]);
    expect(later?.revision).toBe(30);
    expect(later?.summary.entries).toEqual([
      { memberId: "party.hero-1", amount: 350, fromLevel: 3, toLevel: 4, experience: 0 },
    ]);
  });

  it("drops a notice about a battle the party has already moved past, even with no events to say so", () => {
    // A Guest that disconnects after one victory and reconnects two battles later gets a
    // resync: no events, and no combat because the party is between encounters. The only
    // thing in that snapshot saying the notice is stale is which Encounter finished last.
    const reconnect = trackGrowthSummary(notice, {
      ...FACTS,
      revision: 40,
      lastCompletedEncounterId: "encounter.bone-cellar",
    }, []);
    expect(reconnect).toBeNull();

    // The same resync during the next battle is cleared by `inCombat`, as before.
    expect(trackGrowthSummary(notice, {
      ...FACTS,
      revision: 40,
      inCombat: true,
      lastCompletedEncounterId: "encounter.bone-cellar",
    }, [])).toBeNull();

    // An out-of-order older view of the run is not evidence that the notice is stale.
    expect(trackGrowthSummary(notice, {
      ...FACTS,
      revision: 11,
      lastCompletedEncounterId: "encounter.road-ambush",
    }, [])).toBe(notice);

    // A reconnect that lands on the same battle the notice describes still keeps it, so a
    // Guest who blinked during the reward screen does not lose the only notice they get.
    expect(trackGrowthSummary(notice, { ...FACTS, revision: 40 }, [])).toBe(notice);
  });
});
