import { fingerprintValue } from "../game/determinism";
import { chooseAiCommand, type CombatCommand } from "../game";
import {
  PROTOCOL_VERSION,
  type ClientIntentEnvelope,
  type ProtocolErrorCode,
  type ServerAck,
  type ServerControlView,
  type ServerError,
  type ServerMessage,
  type ServerSnapshot,
} from "../protocol";
import {
  assertSessionInvariants,
  dispatchServerCombatCommand,
  dispatchSessionIntent,
  hashSessionGameplayState,
  joinSessionCore,
  sameContentIdentity,
  type SessionAuthorityContext,
  type SessionControlContext,
  type SessionCoreState,
  type SessionEvent,
  type SessionPlayerIdentity,
} from "../session";
import { CampaignWriterRetiredError, type SessionDurability } from "./campaign-durability";
import { reconnectTokenMatches } from "./credentials";

export interface SessionConnection {
  readonly id: string;
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

interface RequestRecord {
  readonly payloadHash: string;
  readonly ack: ServerAck;
  readonly error?: ServerError;
}

export type AttachResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: Extract<ProtocolErrorCode, "UNAUTHENTICATED" | "CONTENT_MISMATCH" | "SESSION_RETIRED">;
      readonly message: string;
    };

/** Close code for a session that will never accept this credential again. */
export const SESSION_RETIRED_CLOSE_CODE = 4005;

export interface SessionHostOptions {
  /** Absent only in tests that deliberately exercise a session with no durable campaign. */
  readonly durability?: SessionDurability;
  readonly onRetired?: (sessionId: string, reason: string) => void;
}

export class SessionHost {
  private stateValue: SessionCoreState;
  private controlRevisionValue = 0;
  private readonly reconnectDigests = new Map<string, string>();
  private readonly connections = new Map<string, SessionConnection>();
  private readonly journal = new Map<string, Map<string, RequestRecord>>();
  private combatEventHistory: SessionEvent[] = [];
  private queue: Promise<void> = Promise.resolve();
  private retiredValue = false;
  private readonly durability: SessionDurability | undefined;
  private readonly onRetired: ((sessionId: string, reason: string) => void) | undefined;

  public constructor(
    state: SessionCoreState,
    private readonly context: SessionAuthorityContext,
    hostReconnectDigest: string,
    options: SessionHostOptions = {},
  ) {
    // attach() publishes this state as a snapshot before any commit runs, so the
    // constructor is the only place left to reject a restored state.
    assertSessionInvariants(state);
    this.stateValue = state;
    this.reconnectDigests.set(state.hostPlayerId, hostReconnectDigest);
    this.durability = options.durability;
    this.onRetired = options.onRetired;
  }

  public get state(): SessionCoreState {
    return this.stateValue;
  }

  public get retired(): boolean {
    return this.retiredValue;
  }

  public get controlRevision(): number {
    return this.controlRevisionValue;
  }

  public get control(): ServerControlView {
    return this.deriveControlView();
  }

  public addPlayer(player: SessionPlayerIdentity, reconnectDigest: string): Promise<ReturnType<typeof joinSessionCore>> {
    return this.enqueue(() => {
      if (this.retiredValue) {
        return {
          accepted: false,
          state: this.stateValue,
          events: [],
          errorCode: "ROSTER_LOCKED" as const,
          error: "This live session was retired. Continue the campaign to open a new one.",
        };
      }
      const result = joinSessionCore(this.stateValue, player, this.context);
      if (!result.accepted) return result;
      this.stateValue = result.state;
      this.reconnectDigests.set(player.playerId, reconnectDigest);
      this.broadcastSnapshot(result.events, { kind: "join" });
      return result;
    });
  }

  public attach(
    playerId: string,
    reconnectToken: string,
    contentIdentity: SessionCoreState["contentIdentity"],
    connection: SessionConnection,
  ): Promise<AttachResult> {
    return this.enqueue(() => {
      if (this.retiredValue) {
        return { ok: false, code: "SESSION_RETIRED", message: "This live session was retired." };
      }
      if (!sameContentIdentity(contentIdentity, this.stateValue.contentIdentity)) {
        return { ok: false, code: "CONTENT_MISMATCH", message: "Client content does not match the session content." };
      }
      const digest = this.reconnectDigests.get(playerId);
      if (!digest || !reconnectTokenMatches(reconnectToken, digest)) {
        return { ok: false, code: "UNAUTHENTICATED", message: "Reconnect credential is invalid." };
      }
      const previous = this.connections.get(playerId);
      const presenceChanged = !previous;
      if (previous && previous.id !== connection.id) previous.close(4001, "A newer connection replaced this client.");
      this.connections.set(playerId, connection);
      if (presenceChanged) this.controlRevisionValue += 1;
      connection.send(this.snapshot(this.combatEventHistory, { kind: "resync" }));
      if (presenceChanged) this.broadcastControlSnapshot(connection.id);
      return { ok: true };
    });
  }

  public detach(playerId: string, connectionId: string): Promise<void> {
    return this.enqueue(() => {
      if (this.connections.get(playerId)?.id !== connectionId) return;
      this.connections.delete(playerId);
      this.controlRevisionValue += 1;
      this.broadcastControlSnapshot();
    });
  }

  public handleIntent(
    playerId: string,
    connectionId: string,
    envelope: ClientIntentEnvelope,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (this.retiredValue) {
        this.sendError(playerId, "SESSION_RETIRED", "This live session was retired.", envelope.requestId);
        return;
      }
      if (this.connections.get(playerId)?.id !== connectionId) return;
      const payloadHash = fingerprintValue(envelope);
      const playerJournal = this.journal.get(playerId) ?? new Map<string, RequestRecord>();
      this.journal.set(playerId, playerJournal);
      const original = playerJournal.get(envelope.requestId);
      if (original) {
        if (original.payloadHash !== payloadHash) {
          this.sendError(playerId, "REQUEST_ID_REUSE", "requestId was already used with a different payload.", envelope.requestId);
          return;
        }
        this.send(playerId, original.ack);
        if (original.error) this.send(playerId, original.error);
        this.send(playerId, this.snapshot(this.combatEventHistory, { kind: "resync", requestId: envelope.requestId }));
        return;
      }

      if (envelope.expectedRevision !== this.stateValue.revision) {
        const error = this.errorMessage(
          "STALE_REVISION",
          "Expected revision " + String(this.stateValue.revision) + ", received " + String(envelope.expectedRevision) + ".",
          envelope.requestId,
        );
        const ack = this.ack(envelope.requestId, false, this.stateValue.revision);
        playerJournal.set(envelope.requestId, { payloadHash, ack, error });
        this.send(playerId, ack);
        this.send(playerId, error);
        return;
      }

      const beforeCombat = this.stateValue.combat;
      const result = dispatchSessionIntent(
        this.stateValue,
        playerId,
        envelope.intent,
        this.context,
        this.controlContext(),
      );
      if (!result.accepted) {
        const code = result.errorCode ?? "DOMAIN_REJECTED";
        const error = this.errorMessage(code, result.error ?? "Session rejected intent.", envelope.requestId);
        const ack = this.ack(envelope.requestId, false, this.stateValue.revision);
        playerJournal.set(envelope.requestId, { payloadHash, ack, error });
        this.send(playerId, ack);
        this.send(playerId, error);
        return;
      }

      // COMMIT before publish. Until the durable write lands, the candidate exists nowhere
      // the client can observe: not in the memory authority, not in an ACK, not in a
      // snapshot. A crash between the two therefore loses nothing a player already saw.
      const committed = await this.commitTransition(this.stateValue, result.state);
      if (!committed.ok) {
        if (committed.terminal) {
          this.sendError(playerId, "SESSION_RETIRED", committed.message, envelope.requestId);
          this.retireInQueue(committed.message);
          return;
        }
        // The request is deliberately not journalled: the same requestId may be retried,
        // and a persistence failure must not be remembered as a settled answer.
        const ack = this.ack(envelope.requestId, false, this.stateValue.revision);
        this.send(playerId, ack);
        this.sendError(playerId, "PERSISTENCE_FAILED", committed.message, envelope.requestId);
        return;
      }

      this.stateValue = result.state;
      if (envelope.intent.type === "remove-offline-guest") {
        this.reconnectDigests.delete(envelope.intent.playerId);
        this.journal.delete(envelope.intent.playerId);
      }
      this.updateCombatHistory(beforeCombat, result.events);
      const ack = this.ack(envelope.requestId, true, result.state.revision);
      playerJournal.set(envelope.requestId, { payloadHash, ack });
      this.send(playerId, ack);
      this.broadcastSnapshot(result.events, { kind: "intent", requestId: envelope.requestId });
      await this.pumpServerAuthority();
    });
  }

  /**
   * Retire this live session from outside. The work is enqueued, so it runs only after
   * every transition already in flight has finished — that queue barrier is what lets
   * Continue read the campaign's last committed save rather than a stale one.
   */
  public retire(reason: string): Promise<void> {
    return this.enqueue(() => this.retireInQueue(reason));
  }

  public whenIdle(): Promise<void> {
    return this.enqueue(() => undefined);
  }

  private deriveControlView(): ServerControlView {
    const connectedPlayerIds = [...this.connections.keys()].sort((left, right) => left.localeCompare(right));
    const connected = new Set(connectedPlayerIds);
    const effectiveControllerByMemberId = Object.fromEntries(
      this.stateValue.partySlots.map((slot) => {
        const guestPlayerId = this.stateValue.guestClaims.byMemberId[slot.memberId];
        return [slot.memberId, guestPlayerId && connected.has(guestPlayerId)
          ? guestPlayerId
          : this.stateValue.hostPlayerId];
      }),
    );
    return { connectedPlayerIds, effectiveControllerByMemberId };
  }

  private controlContext(): SessionControlContext {
    const control = this.deriveControlView();
    return {
      connectedPlayerIds: control.connectedPlayerIds,
      effectiveControllerByMemberId: control.effectiveControllerByMemberId,
    };
  }

  private async pumpServerAuthority(): Promise<void> {
    // A restored campaign holds saved combat that may be stopped on an enemy turn. Nothing
    // may act on it until the host resumes, so a guest claim in the resume lobby must not
    // wake the server AI.
    if (this.stateValue.lifecycle !== "active") return;
    for (let count = 0; count < 512; count += 1) {
      const combat = this.stateValue.combat;
      if (!combat) return;
      let command: CombatCommand | null;
      const pending = combat.pendingReaction;
      if (pending) {
        const head = combat.actors[pending.candidates[0]?.actorId ?? ""];
        if (!head || head.team === "heroes") return;
        const candidate = pending.candidates[0];
        command = candidate
          ? {
              type: "use-reaction",
              id: "server-normalizes-this-id",
              sequence: -1,
              actorId: candidate.actorId,
              triggerId: pending.triggerId,
              cardInstanceId: candidate.cardInstanceId,
            }
          : null;
      } else {
        const active = combat.actors[combat.turn.activeActorId];
        if (!active || active.team === "heroes") return;
        command = chooseAiCommand(combat, this.context.pack.combatContent);
      }
      if (!command) throw new Error("Server AI reached a non-human boundary without a command.");
      const beforeCombat = this.stateValue.combat;
      const result = dispatchServerCombatCommand(this.stateValue, command, this.context);
      if (!result.accepted) throw new Error("Server AI command was rejected: " + (result.error ?? "unknown error"));
      // Every AI step commits on its own. Batching several into one write would let a crash
      // lose AI turns the clients had already been shown.
      const committed = await this.commitTransition(this.stateValue, result.state);
      if (!committed.ok) {
        // The candidate is never published. There is no automatic retry by design: the host
        // continues the campaign from My Campaigns and guests rejoin the new session.
        this.broadcastError(
          committed.terminal ? "SESSION_RETIRED" : "PERSISTENCE_FAILED",
          committed.message,
        );
        this.retireInQueue(committed.message);
        return;
      }
      this.stateValue = result.state;
      this.updateCombatHistory(beforeCombat, result.events);
      this.broadcastSnapshot(result.events, { kind: "server" });
      await Promise.resolve();
    }
    throw new Error("Server AI exceeded the deterministic 512-command guard.");
  }

  private async commitTransition(
    previous: SessionCoreState,
    candidate: SessionCoreState,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly terminal: boolean; readonly message: string }> {
    if (!this.durability) return { ok: true };
    try {
      await this.durability.commitGameplayTransition(previous, candidate);
      return { ok: true };
    } catch (error) {
      if (error instanceof CampaignWriterRetiredError) {
        return { ok: false, terminal: true, message: error.message };
      }
      return {
        ok: false,
        terminal: false,
        message: error instanceof Error
          ? "Saving campaign progress failed: " + error.message
          : "Saving campaign progress failed.",
      };
    }
  }

  /**
   * Retire from inside the queue. The AI failure path must use this rather than `retire()`:
   * enqueuing from within the running queue slot would wait on itself forever.
   */
  private retireInQueue(reason: string): void {
    if (this.retiredValue) return;
    this.retiredValue = true;
    const sessionId = this.stateValue.sessionId;
    for (const connection of this.connections.values()) {
      connection.close(SESSION_RETIRED_CLOSE_CODE, reason);
    }
    this.connections.clear();
    this.onRetired?.(sessionId, reason);
  }

  private broadcastError(code: ProtocolErrorCode, message: string): void {
    const error = this.errorMessage(code, message);
    for (const connection of this.connections.values()) connection.send(error);
  }

  private updateCombatHistory(previousCombat: SessionCoreState["combat"], events: readonly SessionEvent[]): void {
    if (!this.stateValue.combat) {
      this.combatEventHistory = [];
    } else if (!previousCombat) {
      this.combatEventHistory = [...events];
    } else {
      this.combatEventHistory.push(...events);
    }
  }

  private snapshot(events: readonly SessionEvent[], cause: NonNullable<ServerSnapshot["cause"]>): ServerSnapshot {
    return {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      revision: this.stateValue.revision,
      controlRevision: this.controlRevisionValue,
      gameplayHash: hashSessionGameplayState(this.stateValue),
      state: this.stateValue,
      control: this.deriveControlView(),
      cause,
      events,
    };
  }

  private broadcastControlSnapshot(excludedConnectionId?: string): void {
    this.broadcastSnapshot([], { kind: "control" }, excludedConnectionId);
  }

  private broadcastSnapshot(
    events: readonly SessionEvent[],
    cause: NonNullable<ServerSnapshot["cause"]>,
    excludedConnectionId?: string,
  ): void {
    const snapshot = this.snapshot(events, cause);
    for (const connection of this.connections.values()) {
      if (connection.id !== excludedConnectionId) connection.send(snapshot);
    }
  }

  private ack(requestId: string, accepted: boolean, committedRevision: number): ServerAck {
    return { v: PROTOCOL_VERSION, type: "ack", requestId, accepted, committedRevision };
  }

  private errorMessage(code: ProtocolErrorCode, message: string, requestId?: string): ServerError {
    return { v: PROTOCOL_VERSION, type: "error", code, message, requestId, revision: this.stateValue.revision };
  }

  private sendError(playerId: string, code: ProtocolErrorCode, message: string, requestId?: string): void {
    this.send(playerId, this.errorMessage(code, message, requestId));
  }

  private send(playerId: string, message: ServerMessage): void {
    this.connections.get(playerId)?.send(message);
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
