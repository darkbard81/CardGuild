import { randomInt } from "node:crypto";

import type {
  SessionAuthorityContext,
  SessionCoreState,
  SessionGameplayProjection,
  SessionPlayerIdentity,
  SessionTransitionResult,
} from "../session";
import { createResumedSessionCoreState, createSessionCoreState } from "../session";
import type { SessionDurability } from "./campaign-durability";
import { createOpaqueId, createReconnectCredential } from "./credentials";
import { SessionHost } from "./session-host";

export interface SessionCredentialResponse {
  readonly sessionId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
  readonly seat: 1 | 2 | 3;
}
export interface SessionStoreSources {
  readonly sessionId: () => string;
  readonly playerId: () => string;
  readonly reconnectCredential: () => { readonly token: string; readonly digest: string };
  readonly adventureSeed: () => number;
}

const productionSources: SessionStoreSources = {
  sessionId: () => createOpaqueId("session"),
  playerId: () => createOpaqueId("player"),
  reconnectCredential: createReconnectCredential,
  adventureSeed: () => randomInt(1, 0x7fff_ffff),
};

function normalizeDisplayName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().slice(0, 40);
  return normalized || fallback;
}

export interface OpenSessionOptions {
  readonly displayName?: string;
  /** Injected before the host is registered, so the very first transition is durable. */
  readonly durability?: SessionDurability;
}

export class SessionStore {
  private readonly hosts = new Map<string, SessionHost>();
  private readonly retireListeners: ((sessionId: string, reason: string) => void)[] = [];
  private closing = false;

  public constructor(
    private readonly context: SessionAuthorityContext,
    private readonly sources: SessionStoreSources = productionSources,
  ) {}

  /** Notified whenever a live session retires itself, including on a durable write failure. */
  public onRetired(listener: (sessionId: string, reason: string) => void): void {
    this.retireListeners.push(listener);
  }

  public create(displayName?: string, durability?: SessionDurability): SessionCredentialResponse {
    this.assertOpen();
    const sessionId = this.freshSessionId();
    const playerId = this.sources.playerId();
    const credential = this.sources.reconnectCredential();
    const identity: SessionPlayerIdentity = {
      playerId,
      displayName: normalizeDisplayName(displayName, "Host"),
    };
    const state = createSessionCoreState({
      ...identity,
      sessionId,
      adventureSeed: this.sources.adventureSeed(),
    }, this.context);
    this.register(sessionId, state, credential.digest, durability);
    return { sessionId, playerId, reconnectToken: credential.token, seat: 1 };
  }

  /**
   * Open a brand new live session around a durable gameplay projection. Nothing of the
   * session that saved it survives: new session id, new host player, new reconnect
   * credential, no guest claims, and the `resume-lobby` lifecycle.
   */
  public restore(
    projection: SessionGameplayProjection,
    options: OpenSessionOptions = {},
  ): SessionCredentialResponse {
    this.assertOpen();
    const sessionId = this.freshSessionId();
    const playerId = this.sources.playerId();
    const credential = this.sources.reconnectCredential();
    const state = createResumedSessionCoreState({
      sessionId,
      playerId,
      displayName: normalizeDisplayName(options.displayName, "Host"),
    }, projection, this.context);
    this.register(sessionId, state, credential.digest, options.durability);
    return { sessionId, playerId, reconnectToken: credential.token, seat: 1 };
  }

  public async join(sessionId: string, displayName?: string): Promise<
    | { readonly accepted: true; readonly credential: SessionCredentialResponse }
    | { readonly accepted: false; readonly result?: SessionTransitionResult }
  > {
    const host = this.hosts.get(sessionId);
    if (!host || host.retired) return { accepted: false };
    const playerId = this.sources.playerId();
    const credential = this.sources.reconnectCredential();
    const identity: SessionPlayerIdentity = {
      playerId,
      displayName: normalizeDisplayName(displayName, `Player ${host.state.seats.length + 1}`),
    };
    const result = await host.addPlayer(identity, credential.digest);
    if (!result.accepted) return { accepted: false, result };
    const seat = result.state.seats.find((candidate) => candidate.playerId === playerId)?.seat;
    if (!seat) throw new Error("Joined player did not receive a seat.");
    return {
      accepted: true,
      credential: { sessionId, playerId, reconnectToken: credential.token, seat },
    };
  }

  /** The pure authority context every session in this store runs against. */
  public get authorityContext(): SessionAuthorityContext {
    return this.context;
  }

  public get(sessionId: string): SessionHost | undefined {
    return this.hosts.get(sessionId);
  }

  /**
   * Retire a live session and drop it. Awaiting this is the barrier Continue relies on:
   * when it resolves, the retired host can no longer write to the campaign.
   */
  public async retire(sessionId: string, reason: string): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host) return;
    await host.retire(reason);
    if (this.hosts.get(sessionId) === host) this.hosts.delete(sessionId);
  }

  /** Stop opening sessions and wait for every host queue to finish, before the DB closes. */
  public async drain(): Promise<void> {
    this.closing = true;
    await Promise.all([...this.hosts.values()].map((host) => host.whenIdle()));
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("The session store is shutting down.");
  }

  private freshSessionId(): string {
    let sessionId = this.sources.sessionId();
    while (this.hosts.has(sessionId)) sessionId = this.sources.sessionId();
    return sessionId;
  }

  private register(
    sessionId: string,
    state: SessionCoreState,
    reconnectDigest: string,
    durability: SessionDurability | undefined,
  ): void {
    this.hosts.set(sessionId, new SessionHost(state, this.context, reconnectDigest, {
      durability,
      onRetired: (retiredSessionId, reason) => {
        if (this.hosts.get(retiredSessionId)?.retired) this.hosts.delete(retiredSessionId);
        for (const listener of this.retireListeners) listener(retiredSessionId, reason);
      },
    }));
  }
}
