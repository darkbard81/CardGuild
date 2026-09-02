import { randomInt } from "node:crypto";

import type { SessionAuthorityContext, SessionPlayerIdentity, SessionTransitionResult } from "../session";
import { createSessionCoreState } from "../session";
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

export class SessionStore {
  private readonly hosts = new Map<string, SessionHost>();

  public constructor(
    private readonly context: SessionAuthorityContext,
    private readonly sources: SessionStoreSources = productionSources,
  ) {}

  public create(displayName?: string): SessionCredentialResponse {
    let sessionId = this.sources.sessionId();
    while (this.hosts.has(sessionId)) sessionId = this.sources.sessionId();
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
    this.hosts.set(sessionId, new SessionHost(state, this.context, credential.digest));
    return { sessionId, playerId, reconnectToken: credential.token, seat: 1 };
  }

  public async join(sessionId: string, displayName?: string): Promise<
    | { readonly accepted: true; readonly credential: SessionCredentialResponse }
    | { readonly accepted: false; readonly result?: SessionTransitionResult }
  > {
    const host = this.hosts.get(sessionId);
    if (!host) return { accepted: false };
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

  public get(sessionId: string): SessionHost | undefined {
    return this.hosts.get(sessionId);
  }
}
