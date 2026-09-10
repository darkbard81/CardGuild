import { describe, expect, it } from "vitest";

import { gridDistance, listLegalActions, listLegalTargets, type CombatState } from "../game";
import type { ClientIntentEnvelope, ServerMessage } from "../protocol";
import { hashSessionGameplayState, type SessionCoreState, type SessionIntent } from "../session";
import { CampaignWriterRetiredError, type SessionDurability } from "./campaign-durability";
import { FIXTURE_CONTEXT, FIXTURE_PARTY, fixtureLobby } from "./campaign-save.fixture";
import { createReconnectCredential } from "./credentials";
import { SESSION_RETIRED_CLOSE_CODE, SessionHost, type SessionConnection } from "./session-host";

interface Closed {
  readonly code: number;
  readonly reason: string;
}

class FakeConnection implements SessionConnection {
  public readonly messages: ServerMessage[] = [];
  public readonly closes: Closed[] = [];

  public constructor(public readonly id: string, private readonly log: string[]) {}

  public send(message: ServerMessage): void {
    this.messages.push(message);
    this.log.push(message.type === "snapshot" ? `snapshot:${message.cause?.kind ?? ""}` : message.type);
  }

  public close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }
}

type FailureMode = "none" | "transient" | "conflict";

interface FakeDurability extends SessionDurability {
  readonly commits: SessionCoreState[];
  failure: FailureMode;
  /** When set, a commit blocks until `release()` is called. */
  hold: boolean;
  release(): void;
  failWhen: ((candidate: SessionCoreState) => boolean) | null;
}

function fakeDurability(log: string[]): FakeDurability {
  const commits: SessionCoreState[] = [];
  let releaseHold: (() => void) | null = null;
  const durability: FakeDurability = {
    commits,
    failure: "none",
    hold: false,
    failWhen: null,
    release() {
      releaseHold?.();
      releaseHold = null;
    },
    async commitGameplayTransition(previous, candidate) {
      if (hashSessionGameplayState(previous) === hashSessionGameplayState(candidate)) return;
      if (!candidate.adventure) return;
      if (durability.hold) {
        await new Promise<void>((resolve) => { releaseHold = resolve; });
      }
      const mode = durability.failWhen?.(candidate) ? "transient" : durability.failure;
      if (mode === "conflict") {
        throw new CampaignWriterRetiredError("revision-conflict", "Another live session already advanced this campaign.");
      }
      if (mode === "transient") throw new Error("database is locked");
      log.push("commit");
      commits.push(candidate);
    },
  };
  return durability;
}

interface Harness {
  readonly host: SessionHost;
  readonly durability: FakeDurability;
  readonly log: string[];
  readonly connection: FakeConnection;
  readonly hostPlayerId: string;
  attach(): Promise<void>;
  send(requestId: string, intent: SessionIntent): Promise<void>;
}

async function harness(): Promise<Harness> {
  const log: string[] = [];
  const durability = fakeDurability(log);
  const state = fixtureLobby("session-host-test", "player-host");
  const credential = createReconnectCredential();
  const host = new SessionHost(state, FIXTURE_CONTEXT, credential.digest, { durability });
  const connection = new FakeConnection("socket-1", log);
  const attach = async (): Promise<void> => {
    const result = await host.attach("player-host", credential.token, state.contentIdentity, connection);
    expect(result.ok).toBe(true);
  };
  await attach();
  return {
    host,
    durability,
    log,
    connection,
    hostPlayerId: "player-host",
    attach,
    send(requestId, intent) {
      const envelope: ClientIntentEnvelope = {
        v: 7,
        type: "intent",
        requestId,
        expectedRevision: host.state.revision,
        intent,
      };
      return host.handleIntent("player-host", "socket-1", envelope);
    },
  };
}

async function begin(harnessed: Harness): Promise<void> {
  await harnessed.send("party", { type: "set-party-composition", actorDefinitionIds: [...FIXTURE_PARTY] });
  await harnessed.send("begin", { type: "begin-adventure" });
}

describe("M9-3 commit before publish", () => {
  it("commits the durable save before any ACK or snapshot leaves the host", async () => {
    const harnessed = await harness();
    harnessed.log.length = 0;

    await begin(harnessed);

    // The lobby party change is not durable yet, so only Begin Adventure commits.
    expect(harnessed.log).toEqual([
      "ack",
      "snapshot:intent",
      "commit",
      "ack",
      "snapshot:intent",
    ]);
    expect(harnessed.durability.commits).toHaveLength(1);
  });

  it("publishes nothing at all while the durable write is still in flight", async () => {
    const harnessed = await harness();
    await harnessed.send("party", { type: "set-party-composition", actorDefinitionIds: [...FIXTURE_PARTY] });
    const before = harnessed.host.state;
    harnessed.log.length = 0;
    harnessed.durability.hold = true;

    const pending = harnessed.send("begin", { type: "begin-adventure" });
    await Promise.resolve();
    await Promise.resolve();

    // The candidate exists only inside the queued transition: no state, no ACK, no snapshot.
    expect(harnessed.host.state).toBe(before);
    expect(harnessed.log).toEqual([]);
    harnessed.durability.hold = false;
    harnessed.durability.release();
    await pending;
    expect(harnessed.host.state.lifecycle).toBe("active");
    expect(harnessed.log).toEqual(["commit", "ack", "snapshot:intent"]);
  });

  it("keeps the old authority on a failed write, and accepts the same request when retried", async () => {
    const harnessed = await harness();
    await harnessed.send("party", { type: "set-party-composition", actorDefinitionIds: [...FIXTURE_PARTY] });
    const before = harnessed.host.state;
    harnessed.log.length = 0;
    harnessed.durability.failure = "transient";

    await harnessed.send("begin", { type: "begin-adventure" });

    expect(harnessed.host.state).toBe(before);
    expect(harnessed.log).toEqual(["ack", "error"]);
    const ack = harnessed.connection.messages.at(-2);
    const error = harnessed.connection.messages.at(-1);
    expect(ack).toMatchObject({ type: "ack", requestId: "begin", accepted: false });
    expect(error).toMatchObject({ type: "error", code: "PERSISTENCE_FAILED", requestId: "begin" });
    expect(harnessed.host.retired).toBe(false);

    // The failure was not journalled, so the very same requestId is allowed to succeed.
    harnessed.durability.failure = "none";
    await harnessed.send("begin", { type: "begin-adventure" });
    expect(harnessed.host.state.lifecycle).toBe("active");
    expect(harnessed.durability.commits).toHaveLength(1);
  });

  it("retires the session when the durable authority refuses this writer", async () => {
    const harnessed = await harness();
    await harnessed.send("party", { type: "set-party-composition", actorDefinitionIds: [...FIXTURE_PARTY] });
    const before = harnessed.host.state;
    harnessed.durability.failure = "conflict";

    await harnessed.send("begin", { type: "begin-adventure" });

    expect(harnessed.host.state).toBe(before);
    expect(harnessed.host.retired).toBe(true);
    expect(harnessed.connection.messages.at(-1)).toMatchObject({ type: "error", code: "SESSION_RETIRED" });
    expect(harnessed.connection.closes).toEqual([
      { code: SESSION_RETIRED_CLOSE_CODE, reason: "Another live session already advanced this campaign." },
    ]);

    // A retired session accepts no further command, attach or join.
    await harnessed.send("begin-again", { type: "begin-adventure" });
    expect(harnessed.host.state).toBe(before);
    const reattached = await harnessed.host.attach(
      "player-host",
      "any-token",
      before.contentIdentity,
      new FakeConnection("socket-2", harnessed.log),
    );
    expect(reattached).toMatchObject({ ok: false, code: "SESSION_RETIRED" });
    const joined = await harnessed.host.addPlayer({ playerId: "player-guest", displayName: "Guest" }, "digest");
    expect(joined.accepted).toBe(false);
  });

  it("writes nothing for a guest join, a guest claim, presence changes or Resume", async () => {
    const harnessed = await harness();
    await harnessed.send("party", { type: "set-party-composition", actorDefinitionIds: [...FIXTURE_PARTY] });
    const guest = createReconnectCredential();
    const joined = await harnessed.host.addPlayer({ playerId: "player-guest", displayName: "Guest" }, guest.digest);
    expect(joined.accepted).toBe(true);
    const guestConnection = new FakeConnection("socket-guest", harnessed.log);
    const attached = await harnessed.host.attach(
      "player-guest",
      guest.token,
      harnessed.host.state.contentIdentity,
      guestConnection,
    );
    expect(attached.ok).toBe(true);
    harnessed.durability.commits.length = 0;

    // A guest claim, a detach and a re-attach are accepted transitions that change no gameplay.
    const claim: ClientIntentEnvelope = {
      v: 7,
      type: "intent",
      requestId: "claim",
      expectedRevision: harnessed.host.state.revision,
      intent: { type: "select-character", memberId: "party.hero-2" },
    };
    await harnessed.host.handleIntent("player-guest", "socket-guest", claim);
    expect(harnessed.host.state.guestClaims.byMemberId).toEqual({ "party.hero-2": "player-guest" });
    await harnessed.host.detach("player-host", "socket-1");
    await harnessed.attach();

    expect(harnessed.durability.commits).toEqual([]);
    expect(harnessed.host.controlRevision).toBeGreaterThan(0);
  });

  it("changes lifecycle only when a restored campaign resumes, so Resume writes nothing", async () => {
    const log: string[] = [];
    const durability = fakeDurability(log);
    const begun = await (async (): Promise<SessionCoreState> => {
      const harnessed = await harness();
      await begin(harnessed);
      return harnessed.host.state;
    })();
    const credential = createReconnectCredential();
    const resumed: SessionCoreState = {
      ...begun,
      sessionId: "session-resumed",
      revision: 0,
      lifecycle: "resume-lobby",
      guestClaims: { byMemberId: {} },
    };
    const host = new SessionHost(resumed, FIXTURE_CONTEXT, credential.digest, { durability });
    const connection = new FakeConnection("socket-resume", log);
    await host.attach(resumed.hostPlayerId, credential.token, resumed.contentIdentity, connection);
    durability.commits.length = 0;

    await host.handleIntent(resumed.hostPlayerId, "socket-resume", {
      v: 7,
      type: "intent",
      requestId: "resume",
      expectedRevision: 0,
      intent: { type: "resume-adventure" },
    });

    expect(host.state.lifecycle).toBe("active");
    // Resume is the one accepted transition that publishes the exact hash it restored.
    expect(hashSessionGameplayState(host.state)).toBe(hashSessionGameplayState(resumed));
    expect(durability.commits).toEqual([]);
  });

  it("keeps the server AI asleep in a resume lobby stopped on an enemy turn, then wakes it on Resume", async () => {
    const log: string[] = [];
    const durability = fakeDurability(log);
    const saved = await (async (): Promise<SessionCoreState> => {
      const harnessed = await harness();
      await begin(harnessed);
      await harnessed.send("encounter", { type: "start-encounter" });
      return harnessed.host.state;
    })();
    const combat = saved.combat;
    if (!combat) throw new Error("Fixture has no combat.");
    const enemyId = Object.values(combat.actors).find((actor) => actor.team === "enemies")?.id;
    const enemyIndex = combat.turn.initiativeOrder.findIndex((actorId) => actorId === enemyId);
    if (!enemyId || enemyIndex < 0) throw new Error("Fixture combat has no enemy in initiative.");
    // A durable save can sit on an enemy turn: the AI commits each step, so a crash between
    // two of them leaves exactly this state behind.
    const stalled: SessionCoreState = {
      ...saved,
      sessionId: "session-stalled",
      revision: 0,
      lifecycle: "resume-lobby",
      guestClaims: { byMemberId: {} },
      combat: { ...combat, turn: { ...combat.turn, activeActorId: enemyId, activeIndex: enemyIndex } },
    };
    const hostCredential = createReconnectCredential();
    const host = new SessionHost(stalled, FIXTURE_CONTEXT, hostCredential.digest, { durability });
    const hostConnection = new FakeConnection("socket-stalled-host", log);
    await host.attach(stalled.hostPlayerId, hostCredential.token, stalled.contentIdentity, hostConnection);
    const guestCredential = createReconnectCredential();
    await host.addPlayer({ playerId: "player-guest", displayName: "Guest" }, guestCredential.digest);
    const guestConnection = new FakeConnection("socket-stalled-guest", log);
    await host.attach("player-guest", guestCredential.token, stalled.contentIdentity, guestConnection);
    const serverSnapshots = (): number => hostConnection.messages
      .filter((message) => message.type === "snapshot" && message.cause?.kind === "server").length;

    await host.handleIntent("player-guest", "socket-stalled-guest", {
      v: 7,
      type: "intent",
      requestId: "claim",
      expectedRevision: host.state.revision,
      intent: { type: "select-character", memberId: "party.hero-2" },
    });

    // An accepted resume-lobby transition must not let the enemy take its turn.
    expect(host.state.lifecycle).toBe("resume-lobby");
    expect(serverSnapshots()).toBe(0);
    expect(durability.commits).toEqual([]);
    expect(host.state.combat?.turn.activeActorId).toBe(enemyId);

    await host.handleIntent(stalled.hostPlayerId, "socket-stalled-host", {
      v: 7,
      type: "intent",
      requestId: "resume",
      expectedRevision: host.state.revision,
      intent: { type: "resume-adventure" },
    });

    expect(host.state.lifecycle).toBe("active");
    // Resume publishes the restored hash first, and only then does the AI move.
    const resumeIndex = hostConnection.messages.findIndex((message) =>
      message.type === "snapshot" && message.cause?.kind === "intent" && message.cause.requestId === "resume");
    const firstServerIndex = hostConnection.messages.findIndex((message) =>
      message.type === "snapshot" && message.cause?.kind === "server");
    expect(resumeIndex).toBeGreaterThanOrEqual(0);
    expect(firstServerIndex).toBeGreaterThan(resumeIndex);
    expect(durability.commits.length).toBeGreaterThan(0);
  });

  it("commits every server AI step on its own and never publishes one it could not save", async () => {
    const harnessed = await harness();
    await begin(harnessed);
    await harnessed.send("encounter", { type: "start-encounter" });
    const committedAiSteps = (): number => harnessed.durability.commits.filter((state) => {
      const last = state.combat?.commandLog.at(-1);
      return Boolean(last && state.combat?.actors[last.actorId]?.team === "enemies");
    }).length;

    // Play hero turns until the server AI has taken at least one durable step of its own.
    for (let turn = 0; turn < 12 && committedAiSteps() === 0; turn += 1) {
      const activeActorId = harnessed.host.state.combat?.turn.activeActorId;
      if (!activeActorId) break;
      await harnessed.send("end-" + String(turn), { type: "end-turn", facing: "north" });
    }
    expect(committedAiSteps()).toBeGreaterThan(0);
    // Every published snapshot is backed by a committed save, so the counts line up.
    const serverSnapshots = harnessed.connection.messages
      .filter((message) => message.type === "snapshot" && message.cause?.kind === "server").length;
    expect(serverSnapshots).toBe(committedAiSteps());

    // Now refuse the next AI step only.
    harnessed.durability.failWhen = (candidate) => {
      const last = candidate.combat?.commandLog.at(-1);
      return Boolean(last && candidate.combat?.actors[last.actorId]?.team === "enemies");
    };
    const beforeFailure = harnessed.host.state;
    for (let turn = 20; turn < 32 && !harnessed.host.retired; turn += 1) {
      if (!harnessed.host.state.combat) break;
      await harnessed.send("fail-" + String(turn), { type: "end-turn", facing: "north" });
    }

    expect(harnessed.host.retired).toBe(true);
    const publishedLast = harnessed.host.state.combat?.commandLog.at(-1);
    // The unsaved AI candidate reached neither the memory authority nor any client.
    expect(publishedLast && harnessed.host.state.combat?.actors[publishedLast.actorId]?.team).toBe("heroes");
    expect(harnessed.host.state.revision).toBeGreaterThan(beforeFailure.revision);
    expect(harnessed.connection.messages.some((message) =>
      message.type === "error" && message.code === "PERSISTENCE_FAILED")).toBe(true);
    expect(harnessed.connection.closes.at(-1)?.code).toBe(SESSION_RETIRED_CLOSE_CODE);
  });
});

/** A hero turn built only from the shared legality queries, so it asks for nothing a player could not. */
function heroIntent(combat: CombatState): SessionIntent {
  const pending = combat.pendingReaction;
  if (pending) return { type: "pass-reaction", triggerId: pending.triggerId };
  const actorId = combat.turn.activeActorId;
  const actor = combat.actors[actorId];
  if (!actor) throw new Error("Combat has no active actor.");
  const content = FIXTURE_CONTEXT.pack.combatContent;
  const actions = listLegalActions(combat, actorId, content).filter((entry) => entry.enabled);
  const strike = actions.find((entry) => entry.source.kind === "basic" && entry.actionId === "strike");
  const target = strike && listLegalTargets(combat, actorId, strike.source, content)
    .find((entry) => entry.kind === "actor" && combat.actors[entry.actorId]?.team === "enemies");
  if (strike && target?.kind === "actor") {
    return { type: "use-action", action: strike.source, target: { kind: "actor", actorId: target.actorId } };
  }
  const stride = actions.find((entry) => entry.source.kind === "basic" && entry.actionId === "stride");
  const enemy = Object.values(combat.actors)
    .filter((candidate) => candidate.team === "enemies" && !candidate.defeated)
    .sort((left, right) => gridDistance(actor.position, left.position) - gridDistance(actor.position, right.position))[0];
  if (stride && enemy) {
    const tile = listLegalTargets(combat, actorId, stride.source, content)
      .filter((entry) => entry.kind === "tile")
      .sort((left, right) =>
        gridDistance(left.position, enemy.position) - gridDistance(right.position, enemy.position) ||
        left.costFeet - right.costFeet)[0];
    if (tile?.kind === "tile" && gridDistance(tile.position, enemy.position) < gridDistance(actor.position, enemy.position)) {
      return { type: "use-action", action: stride.source, target: { kind: "tile", position: tile.position } };
    }
  }
  return { type: "end-turn", facing: actor.facing };
}

describe("M9-4 growth is published only once the victory is durable", () => {
  function growthEvents(harnessed: Harness): readonly { readonly type: string }[] {
    return harnessed.connection.messages.flatMap((message) =>
      message.type === "snapshot"
        ? message.events.filter((event) => event.type === "EXPERIENCE_GAINED" || event.type === "LEVEL_UP")
        : []);
  }

  /** Fight the first encounter to its end and report what the party ended up with. */
  async function winFirstEncounter(harnessed: Harness): Promise<Readonly<Record<string, unknown>>> {
    await harnessed.send("encounter", { type: "start-encounter" });
    for (let step = 0; step < 400 && harnessed.host.state.combat; step += 1) {
      await harnessed.send(`play-${String(step)}`, heroIntent(harnessed.host.state.combat));
    }
    expect(harnessed.host.state.combat).toBeNull();
    expect(harnessed.host.state.adventure?.completedEncounterIds).toEqual(["encounter.road-ambush"]);
    return Object.fromEntries(Object.entries(harnessed.host.state.adventure?.party.members ?? {})
      .map(([memberId, member]) => [memberId, member.progression]));
  }

  it("pays the same award whoever is connected and whoever claimed which character", async () => {
    const alone = await harness();
    await begin(alone);
    const soloAward = await winFirstEncounter(alone);

    const shared = await harness();
    await shared.send("party", { type: "set-party-composition", actorDefinitionIds: [...FIXTURE_PARTY] });
    const guestCredential = createReconnectCredential();
    const joined = await shared.host.addPlayer({ playerId: "player-guest", displayName: "Guest" }, guestCredential.digest);
    expect(joined.accepted).toBe(true);
    const guestConnection = new FakeConnection("socket-guest", shared.log);
    const attached = await shared.host.attach(
      "player-guest", guestCredential.token, shared.host.state.contentIdentity, guestConnection,
    );
    expect(attached.ok).toBe(true);
    await shared.host.handleIntent("player-guest", "socket-guest", {
      v: 7,
      type: "intent",
      requestId: "claim",
      expectedRevision: shared.host.state.revision,
      intent: { type: "select-character", memberId: "party.hero-2" },
    });
    expect(shared.host.state.guestClaims.byMemberId["party.hero-2"]).toBe("player-guest");
    await shared.send("begin", { type: "begin-adventure" });
    // The guest drops out mid-campaign, which is the case that would tempt a per-player split.
    await shared.host.detach("player-guest", "socket-guest");

    expect(await winFirstEncounter(shared)).toEqual(soloAward);
  });

  it("keeps EXP unpaid and unpublished when the winning write fails, then pays it exactly once on retry", async () => {
    const harnessed = await harness();
    await begin(harnessed);
    await harnessed.send("encounter", { type: "start-encounter" });
    // The winning transition is the one that clears Combat, which is exactly where EXP lands.
    harnessed.durability.failWhen = (candidate) => candidate.combat === null;

    let steps = 0;
    let refused = false;
    while (!refused && steps < 400) {
      const combat = harnessed.host.state.combat;
      if (!combat) throw new Error("Combat ended without the failing write refusing it.");
      steps += 1;
      await harnessed.send(`play-${String(steps)}`, heroIntent(combat));
      refused = harnessed.connection.messages.at(-1)?.type === "error";
    }
    expect(refused).toBe(true);

    const stalled = harnessed.host.state;
    expect(stalled.combat).not.toBeNull();
    expect(stalled.adventure?.completedEncounterIds).toEqual([]);
    for (const member of Object.values(stalled.adventure?.party.members ?? {})) {
      expect(member.progression).toEqual({ level: 1, experience: 0 });
    }
    // Nothing about the growth reached a client, because the campaign does not hold it.
    expect(growthEvents(harnessed)).toEqual([]);
    expect(harnessed.connection.messages.at(-1)).toMatchObject({ type: "error", code: "PERSISTENCE_FAILED" });
    expect(harnessed.host.retired).toBe(false);

    // The refused write was not journalled, so the same winning move is allowed to land.
    harnessed.durability.failWhen = null;
    await harnessed.send(`play-${String(steps)}`, heroIntent(stalled.combat!));

    const settled = harnessed.host.state;
    expect(settled.combat).toBeNull();
    expect(settled.adventure?.completedEncounterIds).toEqual(["encounter.road-ambush"]);
    for (const member of Object.values(settled.adventure?.party.members ?? {})) {
      expect(member.progression).toEqual({ level: 1, experience: 200 });
    }
    // Exactly one award per seat, and none of them a Level-Up at this amount.
    expect(growthEvents(harnessed).map((event) => event.type))
      .toEqual(["EXPERIENCE_GAINED", "EXPERIENCE_GAINED", "EXPERIENCE_GAINED"]);
    expect(harnessed.durability.commits.at(-1)?.adventure?.party.members["party.hero-1"]?.progression)
      .toEqual({ level: 1, experience: 200 });
  });
});