import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import { gridDistance, listLegalActions, listLegalTargets } from "../../src/game";
import type { ActionSource, ActionTarget, CombatState, LegalTarget } from "../../src/game";
import type { AdventureState } from "../../src/adventure";
import type { RewardGrant } from "../../src/content";
import { deriveLoadoutSnapshot } from "../../src/loadout";
import type { ClientIntentEnvelope, ServerAck, ServerMessage } from "../../src/protocol";
import { digestReconnectToken } from "../../src/server/credentials";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import type { SessionIntent } from "../../src/session";

const TEST_ORIGIN = "http://cardguild.test";
const PARTY = ["hero.aerin", "hero.lyra", "hero.brom"] as const;
const CONTENT = PRODUCTION_CONTENT.pack.combatContent;
const ADVENTURE = PRODUCTION_CONTENT.adventure;

type Host = NonNullable<ReturnType<RunningCardGuildServer["store"]["get"]>>;

function actorTargets(targets: readonly LegalTarget[]): readonly Extract<LegalTarget, { kind: "actor" }>[] {
  return targets.filter((target): target is Extract<LegalTarget, { kind: "actor" }> => target.kind === "actor");
}

/** Whether an Action heals, read off its authored effects rather than an id list. */
function restoresHp(actionId: string): boolean {
  const resolution = CONTENT.actions[actionId]?.resolution;
  if (!resolution || resolution.kind === "move") return false;
  const effects = resolution.kind === "direct" ? resolution.effects : Object.values(resolution.outcomes).flat();
  return effects.some((effect) => effect.kind === "restore-hp");
}

/**
 * A deterministic hero policy built only from the shared legality queries, so it can only
 * ask for what a player could ask for.
 */
function heroIntent(combat: CombatState, actorId: string): SessionIntent {
  const actor = combat.actors[actorId];
  if (!actor) return { type: "end-turn" };
  const actions = listLegalActions(combat, actorId, CONTENT).filter((entry) => entry.enabled);
  const use = (source: ActionSource, target: ActionTarget): SessionIntent =>
    ({ type: "use-action", action: source, target });

  for (const actionId of ["stand", "escape-grab"]) {
    const entry = actions.find((candidate) => candidate.source.kind === "context" && candidate.actionId === actionId);
    if (entry) return use(entry.source, { kind: "none" });
  }
  const interact = actions.find((candidate) => candidate.actionId === "interact-lever");
  if (interact) {
    const target = listLegalTargets(combat, actorId, interact.source, CONTENT)
      .find((candidate): candidate is Extract<LegalTarget, { kind: "object" }> => candidate.kind === "object");
    if (target) return use(interact.source, { kind: "object", objectId: target.objectId });
  }
  // Patch up a badly hurt ally before swinging, or the healers on the far side of the
  // adventure simply out-attrit a party that only attacks.
  const hurt = Object.values(combat.actors)
    .filter((candidate) => candidate.team === actor.team && !candidate.defeated && candidate.hp * 2 <= candidate.maxHp);
  if (hurt.length > 0) {
    for (const candidate of actions.filter((entry) => restoresHp(entry.actionId))) {
      const target = actorTargets(listLegalTargets(combat, actorId, candidate.source, CONTENT))
        .filter((entry) => hurt.some((ally) => ally.id === entry.actorId))
        .sort((left, right) => (combat.actors[left.actorId]?.hp ?? 0) - (combat.actors[right.actorId]?.hp ?? 0))[0];
      if (target) return use(candidate.source, { kind: "actor", actorId: target.actorId });
    }
  }
  // Cheapest offence first, so a turn buys the most attacks it can, aimed at whoever is
  // closest to dropping. Spreading damage loses to anything that heals.
  const offensive = actions
    .filter((candidate) => CONTENT.actions[candidate.actionId]?.targeting === "enemy" && candidate.timing.kind === "turn")
    .map((candidate) => ({
      entry: candidate,
      target: actorTargets(listLegalTargets(combat, actorId, candidate.source, CONTENT))
        .sort((left, right) =>
          (combat.actors[left.actorId]?.hp ?? 0) - (combat.actors[right.actorId]?.hp ?? 0) ||
          left.actorId.localeCompare(right.actorId))[0],
      cost: candidate.timing.kind === "turn" ? candidate.timing.actions : 9,
    }))
    .filter((candidate) => candidate.target)
    .sort((left, right) => left.cost - right.cost || left.entry.actionId.localeCompare(right.entry.actionId));
  const best = offensive[0];
  if (best?.target) return use(best.entry.source, { kind: "actor", actorId: best.target.actorId });

  const shield = actions.find((candidate) => candidate.actionId === "raise-shield");
  if (shield && !actor.shieldRaised) return use(shield.source, { kind: "none" });

  const stride = actions.find((candidate) => candidate.source.kind === "basic" && candidate.actionId === "stride");
  const enemy = Object.values(combat.actors)
    .filter((candidate) => candidate.team === "enemies" && !candidate.defeated)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (stride && enemy) {
    const destination = listLegalTargets(combat, actorId, stride.source, CONTENT)
      .filter((candidate): candidate is Extract<LegalTarget, { kind: "tile" }> => candidate.kind === "tile")
      .sort((left, right) =>
        gridDistance(left.position, enemy.position) - gridDistance(right.position, enemy.position) ||
        left.costFeet - right.costFeet ||
        left.position.y - right.position.y ||
        left.position.x - right.position.x)[0];
    if (destination && gridDistance(destination.position, enemy.position) < gridDistance(actor.position, enemy.position)) {
      return { type: "use-action", action: stride.source, target: { kind: "tile", position: destination.position, facing: actor.facing } };
    }
  }
  return { type: "end-turn" };
}

/**
 * Wears a just-granted item, as the Loadout screen would: on whoever has the slot free,
 * otherwise on whoever it does not make worse. "Worse" is read off the production resolver,
 * so this driver never invents its own arithmetic. Card rewards are left alone — preparing
 * one is a capacity decision this driver has no policy for.
 */
function equipIntent(adventure: AdventureState | null, grant: RewardGrant): SessionIntent | null {
  if (!adventure || grant.kind !== "equipment") return null;
  const equipment = CONTENT.equipment[grant.definitionId];
  if (!equipment) return null;
  const members = Object.values(adventure.party.members).sort((left, right) => left.id.localeCompare(right.id));
  const wear = (member: (typeof members)[number]): SessionIntent => ({
    type: "set-loadout",
    memberId: member.id,
    loadout: { ...member.loadout, equipment: { ...member.loadout.equipment, [equipment.slot]: equipment.id } },
  });
  const empty = members.find((member) => !member.loadout.equipment[equipment.slot]);
  if (empty) return wear(empty);
  for (const member of members) {
    const definition = PRODUCTION_CONTENT.pack.actorDefinitions[member.actorDefinitionId];
    if (!definition) continue;
    const intent = wear(member) as Extract<SessionIntent, { type: "set-loadout" }>;
    const before = deriveLoadoutSnapshot(definition, member.loadout, CONTENT, member.id);
    const after = deriveLoadoutSnapshot(definition, intent.loadout, CONTENT, member.id);
    const damage = (snapshot: typeof before): number =>
      snapshot.strike.damage.count * (snapshot.strike.damage.sides + 1) / 2 + snapshot.strike.damage.flatModifier;
    if (after.statistics.ac >= before.statistics.ac && damage(after) >= damage(before)) return intent;
  }
  return null;
}

/** A hero reaction is a human boundary: the server waits, so the client must answer it. */
function reactionIntent(combat: CombatState): SessionIntent | null {
  const pending = combat.pendingReaction;
  if (!pending) return null;
  const candidate = pending.candidates[0];
  if (!candidate) return { type: "pass-reaction", triggerId: pending.triggerId };
  if (combat.actors[candidate.actorId]?.team !== "heroes") return null;
  return { type: "use-reaction", triggerId: pending.triggerId, cardInstanceId: candidate.cardInstanceId };
}

class SocketClient {
  public readonly messages: ServerMessage[] = [];
  public readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
    });
  }

  public static async connect(origin: string, credential: SessionCredentialResponse): Promise<SocketClient> {
    const socket = new WebSocket(origin.replace(/^http/, "ws") + "/ws", { origin: TEST_ORIGIN });
    const client = new SocketClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(JSON.stringify({
      v: 3,
      type: "hello",
      sessionId: credential.sessionId,
      playerId: credential.playerId,
      reconnectToken: credential.reconnectToken,
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    }));
    return client;
  }

  public mark(): number {
    return this.messages.length;
  }

  public send(envelope: ClientIntentEnvelope): void {
    this.socket.send(JSON.stringify(envelope));
  }

  public waitForAck(requestId: string, from: number, timeoutMs = 10_000): Promise<ServerAck> {
    const matches = (message: ServerMessage): message is ServerAck =>
      message.type === "ack" && message.requestId === requestId;
    const existing = this.messages.slice(from).find(matches);
    if (existing) return Promise.resolve(existing);
    return new Promise<ServerAck>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off("message", listener);
        reject(new Error(`Timed out waiting for ack "${requestId}".`));
      }, timeoutMs);
      const listener = (): void => {
        const found = this.messages.slice(from).find(matches);
        if (!found) return;
        clearTimeout(timeout);
        this.socket.off("message", listener);
        resolve(found);
      };
      this.socket.on("message", listener);
    });
  }

  public close(): Promise<number> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(1000);
    return new Promise((resolve) => {
      this.socket.once("close", (code) => resolve(code));
      this.socket.close(1000, "test close");
    });
  }
}

async function post<T>(origin: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return await response.json() as T;
}

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
      sources: {
        sessionId: () => "session-" + String(++sessionSequence),
        playerId: () => "player-" + String(++playerSequence),
        reconnectCredential: () => {
          const token = "reconnect-" + String(++tokenSequence);
          return { token, digest: digestReconnectToken(token) };
        },
        // Chosen so the run both opens a hero reaction window and is winnable by the
        // policy below. Balance across every starter and party size is #21's, not this
        // test's: a scripted party only has to prove the path connects end to end.
        adventureSeed: () => 1,
      },
    });
    running = server;
    const credential = await post<SessionCredentialResponse>(server.origin, "/api/sessions", { displayName: "Host" });
    const client = await SocketClient.connect(server.origin, credential);
    sockets.push(client);
    const host = server.store.get(credential.sessionId) as Host;
    await host.whenIdle();

    let requestSequence = 0;
    const send = async (intent: SessionIntent): Promise<void> => {
      const requestId = `run-${String(++requestSequence)}`;
      const mark = client.mark();
      client.send({ v: 3, type: "intent", requestId, expectedRevision: host.state.revision, intent });
      const ack = await client.waitForAck(requestId, mark);
      expect(`${intent.type}:${String(ack.accepted)}`).toBe(`${intent.type}:true`);
      // The host pumps enemy turns and stops at every human boundary before going idle.
      await host.whenIdle();
    };

    await send({ type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    await send({ type: "begin-adventure" });

    const played: string[] = [];
    const rewards: string[] = [];
    const equipments: string[] = [];
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
