import { fingerprintValue } from "../game/determinism";
import { chooseAiCommand, type CombatCommand } from "../game";
import type {
  ClientIntentEnvelope,
  ProtocolErrorCode,
  ServerAck,
  ServerControlView,
  ServerError,
  ServerMessage,
  ServerSnapshot,
} from "../protocol";
import {
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
  | { readonly ok: false; readonly code: Extract<ProtocolErrorCode, "UNAUTHENTICATED" | "CONTENT_MISMATCH">; readonly message: string };

export class SessionHost {
  private stateValue: SessionCoreState;
  private controlRevisionValue = 0;
  private readonly reconnectDigests = new Map<string, string>();
  private readonly connections = new Map<string, SessionConnection>();
  private readonly journal = new Map<string, Map<string, RequestRecord>>();
  private combatEventHistory: SessionEvent[] = [];
  private queue: Promise<void> = Promise.resolve();

  public constructor(
    state: SessionCoreState,
    private readonly context: SessionAuthorityContext,
    hostReconnectDigest: string,
  ) {
    this.stateValue = state;
    this.reconnectDigests.set(state.hostPlayerId, hostReconnectDigest);
  }

  public get state(): SessionCoreState {
    return this.stateValue;
  }

  public get controlRevision(): number {
    return this.controlRevisionValue;
  }

  public get control(): ServerControlView {
    return this.deriveControlView();
  }

  public addPlayer(player: SessionPlayerIdentity, reconnectDigest: string): Promise<ReturnType<typeof joinSessionCore>> {
    return this.enqueue(() => {
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
      this.stateValue = result.state;
      this.updateCombatHistory(beforeCombat, result.events);
      this.broadcastSnapshot(result.events, { kind: "server" });
      await Promise.resolve();
    }
    throw new Error("Server AI exceeded the deterministic 512-command guard.");
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
      v: 2,
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
    return { v: 2, type: "ack", requestId, accepted, committedRevision };
  }

  private errorMessage(code: ProtocolErrorCode, message: string, requestId?: string): ServerError {
    return { v: 2, type: "error", code, message, requestId, revision: this.stateValue.revision };
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
