import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import { digestReconnectToken } from "../../src/server/credentials";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionIntent } from "../../src/session";
import { equipIntent, heroIntent, reactionIntent } from "../support/campaign/adventure-driver";
import { hostSession, seededPersistence } from "../support/network/host-account";
import { SocketClient, TEST_ORIGIN } from "../support/network/socket-client";

// A frontline, a guardian and the healer. The policy below has a heal branch, and after
// #21's balance pass a party with nobody who can use it does not reach the finale.
const PARTY = ["hero.aerin", "hero.brom", "hero.nera"] as const;
const ADVENTURE = PRODUCTION_CONTENT.adventure;

type Host = NonNullable<ReturnType<RunningCardGuildServer["store"]["get"]>>;

describe("the production adventure completes over a real co-op session", () => {
  let running: RunningCardGuildServer | null = null;
  const sockets: SocketClient[] = [];

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    if (running) await running.close();
    running = null;
  });

  it("plays every encounter through transport, authority and finalizeCombat", async () => {
    let sessionSequence = 0;
    let playerSequence = 0;
    let tokenSequence = 0;
    const server = await startCardGuildServer({
      context: { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId },
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      persistence: await seededPersistence(),
      sources: {
        sessionId: () => "session-" + String(++sessionSequence),
        playerId: () => "player-" + String(++playerSequence),
        reconnectCredential: () => {
          const token = "reconnect-" + String(++tokenSequence);
          return { token, digest: digestReconnectToken(token) };
        },
        // Chosen so the run both opens a hero reaction window and is winnable by the
        // policy below. Balance across every starter and party size is #21's, not this
        // test's: a scripted party only has to prove the path connects end to end. #21
        // retuned the encounters, so this is simply a seed that still wins with the
        // deliberately plain policy here. Balance evidence is `npm run playtest` (#21).
        adventureSeed: () => 8,
      },
    });
    running = server;
    const credential = await hostSession(server.origin);
    const client = await SocketClient.connect(server.origin, credential);
    sockets.push(client);
    const host = server.store.get(credential.sessionId) as Host;
    await host.whenIdle();

    let requestSequence = 0;
    const send = async (intent: SessionIntent): Promise<void> => {
      const requestId = `run-${String(++requestSequence)}`;
      const mark = client.mark();
      client.send({ v: 7, type: "intent", requestId, expectedRevision: host.state.revision, intent });
      const ack = await client.ack(requestId, mark);
      expect(`${intent.type}:${String(ack.accepted)}`).toBe(`${intent.type}:true`);
      for (const message of client.messages.slice(mark)) {
        if (message.type !== "snapshot") continue;
        for (const event of message.events) {
          if (event.type === "EXPERIENCE_GAINED") {
            experienceOnWire.set(event.memberId, (experienceOnWire.get(event.memberId) ?? 0) + event.amount);
          }
          if (event.type === "LEVEL_UP" && event.memberId === "party.hero-1") {
            levelUpsOnWire.push(`${event.encounterId}:${String(event.previousLevel)}->${String(event.level)}`);
          }
        }
      }
      // The host pumps enemy turns and stops at every human boundary before going idle.
      await host.whenIdle();
    };

    await send({ type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    await send({ type: "begin-adventure" });

    const played: string[] = [];
    const rewards: string[] = [];
    const equipments: string[] = [];
    // Growth is read off the wire, not off the server's own state: a client only ever
    // learns what changed from the events published with the COMMIT.
    const experienceOnWire = new Map<string, number>();
    const levelUpsOnWire: string[] = [];
    let heroReactions = 0;
    for (let guard = 0; guard < 4_000 && host.state.adventure?.phase !== "complete"; guard += 1) {
      const adventure = host.state.adventure;
      if (!adventure) throw new Error("The session lost its adventure.");
      if (adventure.phase === "between-encounters") {
        await send({ type: "start-encounter" });
        if (host.state.adventure?.currentEncounterId) played.push(host.state.adventure.currentEncounterId);
        continue;
      }
      if (adventure.phase === "reward" && adventure.pendingReward) {
        const offer = adventure.pendingReward;
        rewards.push(offer.rewardId);
        await send({ type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 });
        // Taking a reward is only half the loop the adventure is built around; the party
        // has to be able to put it on before the next fight, over the same transport.
        const grant = offer.choices[0];
        const equipped = grant ? equipIntent(host.state.adventure, grant) : null;
        if (equipped) {
          await send(equipped);
          equipments.push(grant?.definitionId as string);
        }
        continue;
      }
      if (adventure.phase === "combat") {
        const combat = host.state.combat;
        if (!combat) throw new Error("The adventure is in combat with no combat state.");
        // A hero reaction is exactly the boundary the server refuses to resolve itself.
        const reaction = reactionIntent(combat);
        if (reaction) heroReactions += 1;
        await send(reaction ?? heroIntent(combat, combat.turn.activeActorId));
        continue;
      }
      throw new Error(`The adventure stalled in phase "${adventure.phase}".`);
    }

    expect(host.state.adventure?.phase).toBe("complete");
    expect(played).toEqual([...ADVENTURE.encounterIds]);
    const inPlayOrder = ADVENTURE.encounterIds.flatMap((encounterId) =>
      ADVENTURE.rewards.filter((reward) => reward.afterEncounterId === encounterId).map((reward) => reward.id));
    expect(rewards).toEqual(inPlayOrder);
    expect(host.state.combat).toBeNull();
    // Every equipment reward taken is worn at the end, so the loadout path carried it.
    const worn = new Set(Object.values(host.state.adventure?.party.members ?? {})
      .flatMap((member) => Object.values(member.loadout.equipment).filter((id): id is string => Boolean(id))));
    expect(equipments.length).toBeGreaterThan(0);
    expect(equipments.filter((id) => !worn.has(id))).toEqual([]);
    // This seed opens a hero reaction window, and the host must hand it back to the client
    // rather than resolving it. Seeing none would mean the server crossed that boundary.
    expect(heroReactions).toBeGreaterThan(0);
    // The whole authored table is paid, once each, to every seat, and the two authored
    // Level-Up moments land on the fourth and seventh victories.
    const totalExperience = ADVENTURE.experienceAwards.reduce((sum, award) => sum + award.amount, 0);
    expect([...experienceOnWire.keys()].sort()).toEqual(Object.keys(host.state.adventure?.party.members ?? {}).sort());
    for (const [, amount] of experienceOnWire) expect(amount).toBe(totalExperience);
    expect(levelUpsOnWire).toEqual([
      `${ADVENTURE.encounterIds[3] as string}:1->2`,
      `${ADVENTURE.encounterIds[6] as string}:2->3`,
    ]);
    for (const member of Object.values(host.state.adventure?.party.members ?? {})) {
      expect(member.progression).toEqual({ level: 3, experience: totalExperience % 1_000 });
    }
    // Each reward's first choice is owned afterwards, in its own half of the collection.
    const collection = host.state.adventure?.collection;
    for (const encounterId of ADVENTURE.encounterIds) {
      for (const reward of ADVENTURE.rewards.filter((entry) => entry.afterEncounterId === encounterId)) {
        const choice = reward.choices[0];
        if (!choice) throw new Error(`${reward.id} offers nothing.`);
        const owned = choice.kind === "card" ? collection?.cards : collection?.equipment;
        expect(`${reward.id}/${choice.definitionId}:${String((owned?.[choice.definitionId] ?? 0) > 0)}`)
          .toBe(`${reward.id}/${choice.definitionId}:true`);
      }
    }
  }, 60_000);
});
