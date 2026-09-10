import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ServerSnapshot } from "../../src/protocol";
import { createAuthService } from "../../src/server/auth-service";
import { LEGACY_CONTENT_IDENTITY, legacyStoredSave } from "../../src/server/campaign-save.fixture";
import { digestReconnectToken } from "../../src/server/credentials";
import { createSqlitePersistence, type CampaignSaveRecord } from "../../src/server/persistence";
import { startCardGuildServer, type RunningCardGuildServer } from "../../src/server/server";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import type { AdventureState } from "../../src/adventure";
import { drive, settle } from "./campaign-drive";
import { startFaultServer, type FaultChild, type FaultTarget } from "./fault-child";
import { SocketClient, TEST_ORIGIN, play } from "./socket-client";

const ACCOUNT = { username: "restart-host", password: "restart host password" };
const PARTY = ["hero.aerin", "hero.brom", "hero.nera"] as const;
const CONTEXT = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };
const ADVENTURE = PRODUCTION_CONTENT.adventure;

interface CampaignSummary {
  readonly campaignId: string;
  readonly name: string;
  readonly hasSave: boolean;
}

/** The gameplay facts every recovery case compares, in one object. */
interface Progress {
  readonly completed: readonly string[];
  readonly levels: readonly number[];
  readonly experience: readonly number[];
  readonly owned: number;
  readonly phase: AdventureState["phase"];
}

function progressOf(adventure: AdventureState | null | undefined): Progress {
  if (!adventure) throw new Error("A restored session has no AdventureState.");
  const members = Object.values(adventure.party.members).sort((left, right) => left.seat - right.seat);
  const sum = (counts: Readonly<Record<string, number>>): number =>
    Object.values(counts).reduce((total, count) => total + count, 0);
  return {
    completed: [...adventure.completedEncounterIds],
    levels: members.map((member) => member.progression.level),
    experience: members.map((member) => member.progression.experience),
    owned: sum(adventure.collection.equipment) + sum(adventure.collection.cards),
    phase: adventure.phase,
  };
}

describe("M9-5 crash recovery across every durable transition", () => {
  const directories: string[] = [];
  const servers: RunningCardGuildServer[] = [];
  const children: FaultChild[] = [];
  const sockets: SocketClient[] = [];

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    for (const child of children.splice(0)) await child.stop(["SIGKILL"]);
    for (const server of servers.splice(0)) await server.close().catch(() => undefined);
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function workspace(): { readonly file: string; readonly marker: string } {
    const directory = mkdtempSync(path.join(tmpdir(), "cardguild-m9-5-restart-"));
    directories.push(directory);
    return { file: path.join(directory, "campaigns.sqlite"), marker: path.join(directory, "fault.json") };
  }

  async function seedAccount(file: string): Promise<void> {
    const persistence = createSqlitePersistence(file);
    await createAuthService(persistence).createAccount(ACCOUNT.username, ACCOUNT.password);
    persistence.close();
  }

  async function signIn(origin: string): Promise<string> {
    const response = await fetch(new URL("/api/auth/login", origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ACCOUNT),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Sign in returned no auth cookie.");
    return cookie;
  }

  async function api<T>(origin: string, cookie: string, method: string, route: string, body?: unknown): Promise<{
    readonly status: number;
    readonly body: T;
  }> {
    const response = await fetch(new URL(route, origin), {
      method,
      headers: body === undefined ? { cookie } : { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as T };
  }

  async function openCampaign(origin: string, cookie: string): Promise<{
    readonly campaignId: string;
    readonly credential: SessionCredentialResponse;
  }> {
    const created = await api<SessionCredentialResponse & { readonly campaign: CampaignSummary }>(
      origin, cookie, "POST", "/api/campaigns", { name: "Restart Trouble", displayName: "Host" });
    expect(created.status).toBe(201);
    return { campaignId: created.body.campaign.campaignId, credential: created.body };
  }

  async function startChild(file: string, marker: string): Promise<FaultChild> {
    const child = await startFaultServer({ databasePath: file, markerPath: marker, origin: TEST_ORIGIN });
    children.push(child);
    return child;
  }

  /** A clean, fault-free server on the same file — what an operator restarts with. */
  async function restart(file: string): Promise<RunningCardGuildServer> {
    const persistence = createSqlitePersistence(file);
    const server = await startCardGuildServer({
      context: CONTEXT,
      allowedOrigins: new Set([TEST_ORIGIN]),
      heartbeatMs: 60_000,
      persistence,
      sources: {
        sessionId: () => "session-" + Math.random().toString(36).slice(2, 10),
        playerId: () => "player-" + Math.random().toString(36).slice(2, 10),
        reconnectCredential: () => {
          const token = "reconnect-" + Math.random().toString(36).slice(2, 12);
          return { token, digest: digestReconnectToken(token) };
        },
        adventureSeed: () => 1,
      },
    });
    servers.push(server);
    return server;
  }

  /** Continue the campaign on a fresh server and read back what survived. */
  async function recover(file: string, campaignId: string): Promise<{
    readonly snapshot: ServerSnapshot;
    readonly client: SocketClient;
    readonly server: RunningCardGuildServer;
    readonly cookie: string;
    readonly campaignRevision: number;
  }> {
    const server = await restart(file);
    const cookie = await signIn(server.origin);
    const continued = await api<SessionCredentialResponse>(
      server.origin, cookie, "POST", `/api/campaigns/${campaignId}/continue`, {});
    expect(continued.status, JSON.stringify(continued.body)).toBe(200);
    const client = await SocketClient.connect(server.origin, continued.body);
    sockets.push(client);
    const snapshot = await client.snapshot();
    expect(snapshot.state.lifecycle).toBe("resume-lobby");
    // A restored session is brand new: no inherited identity, no inherited claims.
    expect(snapshot.state.revision).toBe(0);
    expect(snapshot.state.guestClaims).toEqual({ byMemberId: {} });
    return { snapshot, client, server, cookie, campaignRevision: storedRevision(file, campaignId) };
  }

  function storedRecord(file: string, campaignId: string): CampaignSaveRecord {
    const persistence = createSqlitePersistence(file);
    try {
      const accountId = persistence.accounts.findByUsername(ACCOUNT.username)?.accountId ?? "";
      const lookup = persistence.campaigns.loadOwnedSave(campaignId, accountId);
      if (lookup.status !== "loaded") throw new Error(`Stored save is ${lookup.status}.`);
      return lookup.record;
    } finally {
      persistence.close();
    }
  }

  function storedRevision(file: string, campaignId: string): number {
    return storedRecord(file, campaignId).campaignRevision;
  }

  /**
   * Play a fresh campaign on a crash-testable server until `until`, then arm the fault and
   * keep playing until the process dies at the named transition.
   *
   * Nothing here manufactures a winning position: the party fights with the shared driver
   * against the production content at seed 1, so the transition the fault lands on is one
   * the real game produced.
   */
  async function crashAt(target: FaultTarget, when: "before" | "after", options: {
    readonly until?: (snapshot: ServerSnapshot) => boolean;
  } = {}): Promise<{
    readonly file: string;
    readonly campaignId: string;
    /** The last snapshot the client actually saw, which is what a "before" crash restores. */
    readonly lastSeen: ServerSnapshot;
    readonly seen: Progress;
    /** The campaign revision the child recorded at the fault boundary. */
    readonly faultRevision: number;
  }> {
    const { file, marker } = workspace();
    await seedAccount(file);
    const child = await startChild(file, marker);
    const cookie = await signIn(child.origin);
    const opened = await openCampaign(child.origin, cookie);
    const client = await SocketClient.connect(child.origin, opened.credential);
    sockets.push(client);

    let snapshot = await client.snapshot();
    snapshot = await play(client, snapshot, "party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
    snapshot = await play(client, snapshot, "begin", { type: "begin-adventure" });
    if (options.until) {
      const staged = await drive(client, { until: options.until, prefix: "stage", from: snapshot.revision });
      if (staged.died || !staged.snapshot) throw new Error("The staging run died before the fault was armed.");
      snapshot = staged.snapshot;
    }

    await child.arm({ when, target });
    const result = await drive(client, { prefix: "doomed", from: snapshot.revision });
    expect(result.died, "The armed fault never fired: " + child.output()).toBe(true);
    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
    const faulted = child.marker();
    expect(faulted).toMatchObject({ when, target });
    children.splice(0);
    sockets.splice(0);
    // The last snapshot the client saw is the last state the server published, which is
    // exactly what a crash before the write has to give back.
    const lastSeen = result.snapshot;
    if (!lastSeen || !faulted) throw new Error("The doomed run published nothing to compare against.");
    return {
      file,
      campaignId: opened.campaignId,
      lastSeen,
      seen: progressOf(lastSeen.state.adventure),
      faultRevision: faulted.campaignRevision,
    };
  }

  it("loses nothing and gains nothing when the first victory is killed before its write", async () => {
    const crashed = await crashAt("encounter-complete", "before");
    expect(crashed.seen.completed).toEqual([]);

    const recovered = await recover(crashed.file, crashed.campaignId);
    const progress = progressOf(recovered.snapshot.state.adventure);
    // The victory did not happen, so neither did its EXP.
    expect(progress.completed).toEqual([]);
    expect(progress.levels).toEqual([1, 1, 1]);
    expect(progress.experience).toEqual([0, 0, 0]);
    // Exactly the state the client last saw, compared as whole objects rather than a hash.
    expect(recovered.snapshot.gameplayHash).toBe(crashed.lastSeen.gameplayHash);
    expect(recovered.snapshot.state.adventure).toEqual(crashed.lastSeen.state.adventure);
    expect(recovered.snapshot.state.combat).toEqual(crashed.lastSeen.state.combat);
    expect(recovered.snapshot.state.partySlots).toEqual(crashed.lastSeen.state.partySlots);
    expect(recovered.campaignRevision).toBe(crashed.faultRevision);

    // Recovery is not a dead end: the party resumes and can act.
    const active = await play(recovered.client, recovered.snapshot, "resume", { type: "resume-adventure" });
    expect(active.state.lifecycle).toBe("active");
    expect(active.gameplayHash).toBe(recovered.snapshot.gameplayHash);
    const next = await settle(recovered.client, active.revision);
    expect(next).not.toBeNull();
  }, 120_000);

  it("applies the first victory and its EXP exactly once when the write lands but the ACK never does", async () => {
    const crashed = await crashAt("encounter-complete", "after");

    const recovered = await recover(crashed.file, crashed.campaignId);
    const progress = progressOf(recovered.snapshot.state.adventure);
    // Completion and the authored award are one transition: both, or neither.
    expect(progress.completed).toEqual([ADVENTURE.encounterIds[0]]);
    expect(progress.experience).toEqual([200, 200, 200]);
    expect(progress.levels).toEqual([1, 1, 1]);
    // The client never saw this, but the database already held it.
    expect(crashed.seen.completed).toEqual([]);
    expect(crashed.seen.experience).toEqual([0, 0, 0]);
    expect(recovered.snapshot.gameplayHash).not.toBe(crashed.lastSeen.gameplayHash);
    expect(recovered.campaignRevision).toBe(crashed.faultRevision);

    const active = await play(recovered.client, recovered.snapshot, "resume", { type: "resume-adventure" });
    // Resume republishes what it restored: it is not a gameplay transition.
    expect(active.gameplayHash).toBe(recovered.snapshot.gameplayHash);
    expect(storedRevision(crashed.file, crashed.campaignId)).toBe(recovered.campaignRevision);
    // Playing on never re-applies the victory the crash already made durable.
    const played = await drive(recovered.client, {
      until: (snapshot) => (snapshot.state.adventure?.completedEncounterIds.length ?? 0) > 1,
      prefix: "after-recovery",
      from: active.revision,
    });
    expect(played.died).toBe(false);
    expect(played.snapshot?.state.adventure?.completedEncounterIds.slice(0, 1))
      .toEqual([ADVENTURE.encounterIds[0]]);
  }, 180_000);

  it("keeps Lv.1 / EXP 700 when the fourth victory dies before its write, and Lv.2 / EXP 100 when it dies after", async () => {
    const beforeCrash = await crashAt("level-up", "before");
    const beforeRecovered = await recover(beforeCrash.file, beforeCrash.campaignId);
    const beforeProgress = progressOf(beforeRecovered.snapshot.state.adventure);
    expect(beforeProgress.completed).toHaveLength(3);
    expect(beforeProgress.levels).toEqual([1, 1, 1]);
    expect(beforeProgress.experience).toEqual([700, 700, 700]);
    expect(beforeRecovered.snapshot.gameplayHash).toBe(beforeCrash.lastSeen.gameplayHash);
    expect(beforeRecovered.campaignRevision).toBe(beforeCrash.faultRevision);

    const afterCrash = await crashAt("level-up", "after");
    const afterRecovered = await recover(afterCrash.file, afterCrash.campaignId);
    const afterProgress = progressOf(afterRecovered.snapshot.state.adventure);
    // The fourth victory, the carried EXP and the new Level all land together.
    expect(afterProgress.completed).toHaveLength(4);
    expect(afterProgress.levels).toEqual([2, 2, 2]);
    expect(afterProgress.experience).toEqual([100, 100, 100]);
    // The client stopped at Lv.1 / EXP 700; the database moved past it in one step.
    expect(afterCrash.seen.levels).toEqual([1, 1, 1]);
    expect(afterCrash.seen.experience).toEqual([700, 700, 700]);
    expect(afterRecovered.campaignRevision).toBe(afterCrash.faultRevision);

    // The next battle is built from the Level the recovery restored.
    const active = await play(afterRecovered.client, afterRecovered.snapshot, "resume", { type: "resume-adventure" });
    const fighting = await drive(afterRecovered.client, {
      until: (snapshot) => snapshot.state.adventure?.phase === "combat",
      prefix: "next-fight",
      from: active.revision,
    });
    expect(fighting.died).toBe(false);
    const hero = fighting.snapshot?.state.combat?.actors["party.hero-1"];
    expect(hero?.statProfile).toMatchObject({ stats: { level: 2 } });
    expect(active.state.lifecycle).toBe("active");
  }, 300_000);

  it("grants a chosen reward exactly once across a crash on either side of its write", async () => {
    const firstReward = ADVENTURE.rewards.find((reward) => reward.afterEncounterId === ADVENTURE.encounterIds[0]);
    if (!firstReward) throw new Error("The first production encounter is expected to offer a reward.");
    const chosen = firstReward.choices[0];
    if (!chosen) throw new Error("The first reward offers nothing.");
    const copiesOf = (snapshot: ServerSnapshot): number => {
      const collection = snapshot.state.adventure?.collection;
      return (chosen.kind === "card" ? collection?.cards : collection?.equipment)?.[chosen.definitionId] ?? 0;
    };

    const beforeCrash = await crashAt("reward", "before");
    // The client is left on the offer it had already chosen from, still unresolved.
    expect(beforeCrash.seen.phase).toBe("reward");
    const beforeRecovered = await recover(beforeCrash.file, beforeCrash.campaignId);
    // The offer is still open and nothing was granted, so the choice can simply be remade.
    expect(beforeRecovered.snapshot.state.adventure?.pendingReward?.rewardId).toBe(firstReward.id);
    expect(progressOf(beforeRecovered.snapshot.state.adventure).owned).toBe(beforeCrash.seen.owned);
    expect(beforeRecovered.snapshot.gameplayHash).toBe(beforeCrash.lastSeen.gameplayHash);
    expect(beforeRecovered.campaignRevision).toBe(beforeCrash.faultRevision);

    const beforeCopies = copiesOf(beforeRecovered.snapshot);
    const active = await play(beforeRecovered.client, beforeRecovered.snapshot, "resume", { type: "resume-adventure" });
    const remade = await play(beforeRecovered.client, active, "retake", {
      type: "choose-reward", rewardId: firstReward.id, choiceIndex: 0,
    });
    // Retaking it grants exactly one copy, so the crash cost nothing and duplicated nothing.
    expect(copiesOf(remade)).toBe(beforeCopies + 1);

    const afterCrash = await crashAt("reward", "after");
    const afterRecovered = await recover(afterCrash.file, afterCrash.campaignId);
    const progress = progressOf(afterRecovered.snapshot.state.adventure);
    // The grant and the pending offer resolve together, and the copy count moves by one.
    expect(progress.owned).toBe(afterCrash.seen.owned + 1);
    expect(afterRecovered.snapshot.state.adventure?.pendingReward).toBeNull();
    expect(afterRecovered.campaignRevision).toBe(afterCrash.faultRevision);
    expect(copiesOf(afterRecovered.snapshot)).toBeGreaterThanOrEqual(1);
  }, 300_000);

  it("keeps an enemy turn where it was when an AI step dies before its write", async () => {
    const crashed = await crashAt("ai-command", "before");

    const recovered = await recover(crashed.file, crashed.campaignId);
    // Every AI step commits on its own, so a crash before one loses that step and nothing
    // else — the battle comes back exactly as the clients last saw it.
    expect(recovered.snapshot.gameplayHash).toBe(crashed.lastSeen.gameplayHash);
    expect(recovered.snapshot.state.combat).toEqual(crashed.lastSeen.state.combat);
    expect(recovered.campaignRevision).toBe(crashed.faultRevision);

    // Resume wakes the AI again and it takes the step the crash swallowed.
    const stalled = recovered.snapshot.state.combat?.sequence ?? 0;
    const active = await play(recovered.client, recovered.snapshot, "resume", { type: "resume-adventure" });
    expect(active.gameplayHash).toBe(recovered.snapshot.gameplayHash);
    const settled = await settle(recovered.client, active.revision);
    expect(settled).not.toBeNull();
    expect(settled?.state.combat?.sequence ?? 0).toBeGreaterThan(stalled);
  }, 180_000);

  it("resumes an enemy turn from the last committed AI step rather than replaying it", async () => {
    const crashed = await crashAt("ai-command", "after");

    const recovered = await recover(crashed.file, crashed.campaignId);
    const restoredCombat = recovered.snapshot.state.combat;
    expect(restoredCombat).not.toBeNull();
    // Every AI step commits on its own, so recovery lands mid-enemy-turn with a gap-free log.
    const sequences = restoredCombat?.commandLog.map((command) => command.sequence) ?? [];
    expect(sequences).toEqual(sequences.map((_, index) => index + 1));
    expect(restoredCombat?.sequence).toBe(sequences.length);

    // The saved enemy turn does not run until the host resumes, and then it continues from
    // exactly where the crash left it.
    const beforeResume = restoredCombat?.sequence ?? 0;
    const active = await play(recovered.client, recovered.snapshot, "resume", { type: "resume-adventure" });
    expect(active.gameplayHash).toBe(recovered.snapshot.gameplayHash);
    const settled = await settle(recovered.client, active.revision);
    expect(settled).not.toBeNull();
    expect(settled?.state.combat?.sequence ?? 0).toBeGreaterThanOrEqual(beforeResume);
  }, 180_000);

  it("finishes the Adventure exactly once when the last victory is killed on either side of its write", async () => {
    const last = ADVENTURE.encounterIds.at(-1);
    const totalExperience = ADVENTURE.experienceAwards.reduce((sum, award) => sum + award.amount, 0);

    const beforeCrash = await crashAt("adventure-complete", "before");
    // The run is one victory short: still fighting, still Lv.3 from the seventh win.
    expect(beforeCrash.seen.completed).toHaveLength(ADVENTURE.encounterIds.length - 1);
    const beforeRecovered = await recover(beforeCrash.file, beforeCrash.campaignId);
    const beforeProgress = progressOf(beforeRecovered.snapshot.state.adventure);
    expect(beforeProgress.phase).toBe("combat");
    expect(beforeProgress.completed).toHaveLength(ADVENTURE.encounterIds.length - 1);
    expect(beforeProgress.experience).toEqual([0, 0, 0]);
    expect(beforeRecovered.snapshot.gameplayHash).toBe(beforeCrash.lastSeen.gameplayHash);
    expect(beforeRecovered.campaignRevision).toBe(beforeCrash.faultRevision);

    // Recovery is not a dead end even at the finale: the party resumes and finishes it.
    const active = await play(beforeRecovered.client, beforeRecovered.snapshot, "resume", { type: "resume-adventure" });
    const finished = await drive(beforeRecovered.client, {
      until: (snapshot) => snapshot.state.adventure?.phase === "complete",
      prefix: "finish",
      from: active.revision,
    });
    expect(finished.died).toBe(false);
    expect(progressOf(finished.snapshot?.state.adventure).completed).toHaveLength(ADVENTURE.encounterIds.length);

    const afterCrash = await crashAt("adventure-complete", "after");
    const afterRecovered = await recover(afterCrash.file, afterCrash.campaignId);
    const afterProgress = progressOf(afterRecovered.snapshot.state.adventure);
    // Completion, the final Encounter and its EXP land together, and only once.
    expect(afterProgress.phase).toBe("complete");
    expect(afterProgress.completed).toEqual([...ADVENTURE.encounterIds]);
    expect(afterProgress.completed.at(-1)).toBe(last);
    expect(afterProgress.levels).toEqual([3, 3, 3]);
    expect(afterProgress.experience).toEqual([totalExperience % 1_000, totalExperience % 1_000, totalExperience % 1_000]);
    expect(afterRecovered.campaignRevision).toBe(afterCrash.faultRevision);
    // A finished Adventure has nothing left to do, so Resume publishes it unchanged.
    const resumed = await play(afterRecovered.client, afterRecovered.snapshot, "resume", { type: "resume-adventure" });
    expect(resumed.gameplayHash).toBe(afterRecovered.snapshot.gameplayHash);
    expect(storedRevision(afterCrash.file, afterCrash.campaignId)).toBe(afterRecovered.campaignRevision);
  }, 600_000);

  it("has no enemy reaction boundary to crash on, and says so if that ever changes", () => {
    // The plan asks for an enemy-reaction fault case. The shipped pack cannot produce one:
    // `reactive-strike` is the only Reaction, and no Creature is granted it, so a Reaction
    // window never opens on an enemy and the server AI never commits one. Rather than
    // write a case that can only ever pass vacuously, this states the reason — and fails
    // the moment a later pack makes the case real and therefore missing.
    const content = PRODUCTION_CONTENT.pack.combatContent;
    const reactionActionIds = new Set(Object.values(content.actions)
      .filter((action) => action.timing.kind === "reaction")
      .map((action) => action.id));
    const reactionCardIds = new Set(Object.values(content.cards)
      .filter((card) => reactionActionIds.has(card.actionId))
      .map((card) => card.id));
    const reactingCreatures = Object.values(PRODUCTION_CONTENT.pack.actorDefinitions)
      .filter((actor) => actor.statProfile.kind === "creature")
      .filter((actor) => {
        const granted = [
          ...actor.baseCardGrants.map((grant) => grant.cardDefinitionId),
          ...actor.traits.flatMap((trait) => (content.traits[trait.id]?.cardGrants ?? [])
            .map((grant) => grant.cardDefinitionId)),
        ];
        return granted.some((id) => reactionCardIds.has(id)) ||
          actor.innateActionIds.some((id) => reactionActionIds.has(id));
      })
      .map((actor) => actor.id);
    expect(reactingCreatures).toEqual([]);
  });

  it("leaves a content migration either untouched or done, and never done twice", async () => {
    for (const when of ["before", "after"] as const) {
      const { file, marker } = workspace();
      await seedAccount(file);

      // Reach a real mid-combat save, then rewrite the row as the previous build wrote it.
      const staging = await restart(file);
      const cookie = await signIn(staging.origin);
      const opened = await openCampaign(staging.origin, cookie);
      const client = await SocketClient.connect(staging.origin, opened.credential);
      sockets.push(client);
      let snapshot = await client.snapshot();
      snapshot = await play(client, snapshot, "party", { type: "set-party-composition", actorDefinitionIds: [...PARTY] });
      snapshot = await play(client, snapshot, "begin", { type: "begin-adventure" });
      snapshot = await play(client, snapshot, "encounter", { type: "start-encounter" });
      const beforeMigration = progressOf(snapshot.state.adventure);
      await client.close();
      sockets.splice(sockets.indexOf(client), 1);
      await staging.close();
      servers.splice(servers.indexOf(staging), 1);

      const legacy = legacyStoredSave(snapshot.state);
      const persistence = createSqlitePersistence(file);
      const accountId = persistence.accounts.findByUsername(ACCOUNT.username)?.accountId ?? "";
      const lookup = persistence.campaigns.loadOwnedSave(opened.campaignId, accountId);
      if (lookup.status !== "loaded") throw new Error("Expected a stored save to roll back.");
      const legacyRevision = lookup.record.campaignRevision;
      persistence.close();
      rewriteAsLegacy(file, opened.campaignId, legacy.save, legacy.snapshotHash);

      // Continue is where the migration COMMIT happens, so that is where the crash lands.
      const child = await startChild(file, marker);
      const childCookie = await signIn(child.origin);
      await child.arm({ when, target: "migration" });
      const continued = fetch(new URL(`/api/campaigns/${opened.campaignId}/continue`, child.origin), {
        method: "POST",
        headers: { cookie: childCookie, "content-type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
      expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
      expect(child.marker()).toMatchObject({ when, target: "migration" });
      await continued;
      children.splice(0);

      const stored = storedRecord(file, opened.campaignId);
      if (when === "before") {
        // Nothing was published and nothing was written: the legacy row is still legacy.
        expect(stored.contentIdentity.fingerprint).toBe(LEGACY_CONTENT_IDENTITY.fingerprint);
        expect(stored.campaignRevision).toBe(legacyRevision);
      } else {
        expect(stored.contentIdentity).toEqual(PRODUCTION_CONTENT.contentIdentity);
        expect(stored.campaignRevision).toBe(legacyRevision + 1);
      }

      // Either way the next Continue succeeds, and it migrates at most once more.
      const recovered = await recover(file, opened.campaignId);
      expect(progressOf(recovered.snapshot.state.adventure)).toEqual(beforeMigration);
      expect(recovered.campaignRevision).toBe(legacyRevision + 1);
      const again = await api<SessionCredentialResponse>(
        recovered.server.origin, recovered.cookie, "POST", `/api/campaigns/${opened.campaignId}/continue`, {});
      expect(again.status).toBe(200);
      expect(storedRevision(file, opened.campaignId)).toBe(legacyRevision + 1);

      await Promise.all(sockets.splice(0).map((socket) => socket.close()));
      for (const server of servers.splice(0)) await server.close();
    }
  }, 300_000);
});

/** Put the row back the way the previous build would have written it. */
function rewriteAsLegacy(
  file: string,
  campaignId: string,
  save: { readonly saveSchemaVersion: number; readonly contentIdentity: { readonly packId: string; readonly packVersion: string; readonly fingerprint: string } },
  snapshotHash: string,
): void {
  // node:sqlite is opened directly here because this is deliberately not something the
  // repository interface can do: no production path ever rewrites a stored identity.
  const database = new DatabaseSync(file);
  database
    .prepare(
      "UPDATE campaigns SET snapshot_json = ?, snapshot_hash = ?, content_pack_version = ?, content_fingerprint = ? " +
      "WHERE campaign_id = ?",
    )
    .run(JSON.stringify(save), snapshotHash, save.contentIdentity.packVersion, save.contentIdentity.fingerprint, campaignId);
  database.close();
}
