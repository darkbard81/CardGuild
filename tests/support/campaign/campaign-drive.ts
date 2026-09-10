import { WebSocket } from "ws";

import type { ServerSnapshot } from "../../../src/protocol";
import type { SessionIntent } from "../../../src/session";
import { heroIntent, reactionIntent } from "../../support/campaign/adventure-driver";
import { SocketClient, envelope } from "../../support/network/socket-client";

/**
 * Play a campaign over a real socket until something the test cares about happens — or
 * until the server stops answering because a fault killed it.
 *
 * An in-process suite can ask `host.whenIdle()` whether the server has finished its enemy
 * turns. A child process cannot, so readiness is read off the published snapshots instead:
 * the server only ever waits for input at a hero's turn, a hero's reaction, or a screen
 * between battles. That is the same boundary a human player sees.
 */
export function latestSnapshot(client: SocketClient): ServerSnapshot | undefined {
  for (let index = client.messages.length - 1; index >= 0; index -= 1) {
    const message = client.messages[index];
    if (message?.type === "snapshot") return message;
  }
  return undefined;
}

export function awaitingPlayer(snapshot: ServerSnapshot): boolean {
  const state = snapshot.state;
  if (state.lifecycle !== "active") return true;
  const adventure = state.adventure;
  if (!adventure) return false;
  if (adventure.phase !== "combat") return true;
  const combat = state.combat;
  if (!combat) return false;
  const pending = combat.pendingReaction;
  if (pending) return combat.actors[pending.candidates[0]?.actorId ?? ""]?.team === "heroes";
  return combat.actors[combat.turn.activeActorId]?.team === "heroes";
}

/**
 * The next snapshot that is waiting for this player, or null if the server went away.
 *
 * `minRevision` is what keeps this honest. An ACK and the snapshot it commits are two
 * separate frames, so a caller that acts on "the newest snapshot" right after an ACK can
 * still be looking at the state *before* its own move — and would then send that move
 * again, against a server that has already made it.
 */
export async function settle(
  client: SocketClient,
  minRevision = 0,
  timeoutMs = 20_000,
): Promise<ServerSnapshot | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = latestSnapshot(client);
    if (snapshot && snapshot.revision >= minRevision && awaitingPlayer(snapshot)) return snapshot;
    if (client.socket.readyState === WebSocket.CLOSED || client.socket.readyState === WebSocket.CLOSING) return null;
    if (Date.now() > deadline) throw new Error("The server never came back to a player boundary.");
    const settled = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        client.socket.off("message", onMessage);
        client.socket.off("close", onClose);
        resolve(false);
      }, 250);
      const finish = (value: boolean) => (): void => {
        clearTimeout(timer);
        client.socket.off("message", onMessage);
        client.socket.off("close", onClose);
        resolve(value);
      };
      const onMessage = finish(true);
      const onClose = finish(false);
      client.socket.once("message", onMessage);
      client.socket.once("close", onClose);
    });
    void settled;
  }
}

/** What the drive loop should do next, decided only from the published snapshot. */
export function nextIntent(snapshot: ServerSnapshot): SessionIntent | null {
  const state = snapshot.state;
  if (state.lifecycle === "resume-lobby") return { type: "resume-adventure" };
  const adventure = state.adventure;
  if (!adventure) return null;
  if (adventure.phase === "complete" || adventure.phase === "failed") return null;
  if (adventure.phase === "between-encounters" || adventure.phase === "ready") return { type: "start-encounter" };
  if (adventure.phase === "reward") {
    const offer = adventure.pendingReward;
    return offer ? { type: "choose-reward", rewardId: offer.rewardId, choiceIndex: 0 } : null;
  }
  const combat = state.combat;
  if (!combat) return null;
  return reactionIntent(combat) ?? heroIntent(combat, combat.turn.activeActorId);
}

export interface DriveResult {
  /** The last snapshot this client saw, which is null only if it never saw one. */
  readonly snapshot: ServerSnapshot | null;
  /** True when the loop stopped because the server stopped answering. */
  readonly died: boolean;
}

/**
 * Drive the campaign forward until `until` is satisfied, the Adventure ends, or the server
 * dies. A fault test wants the last case: it arms the fault and then just plays.
 */
export async function drive(
  client: SocketClient,
  options: {
    readonly until?: (snapshot: ServerSnapshot) => boolean;
    readonly maxSteps?: number;
    readonly prefix?: string;
    /** The revision the caller already knows about, so the loop never acts on an older one. */
    readonly from?: number;
  } = {},
): Promise<DriveResult> {
  const prefix = options.prefix ?? "drive";
  const limit = options.maxSteps ?? 4_000;
  let minRevision = options.from ?? 0;
  for (let step = 0; step < limit; step += 1) {
    const snapshot = await settle(client, minRevision);
    if (!snapshot) return { snapshot: latestSnapshot(client) ?? null, died: true };
    if (options.until?.(snapshot)) return { snapshot, died: false };
    const intent = nextIntent(snapshot);
    if (!intent) return { snapshot, died: false };
    const requestId = `${prefix}-${String(step)}`;
    const mark = client.mark();
    client.send(envelope(requestId, snapshot.revision, intent));
    try {
      const ack = await client.ack(requestId, mark, 20_000);
      if (!ack.accepted) {
        throw new Error(`Drive intent ${intent.type} was refused: ` + JSON.stringify(client.messages.slice(mark)));
      }
      minRevision = Math.max(minRevision, ack.committedRevision);
    } catch (error) {
      // A killed server answers nothing. Anything else is a real failure.
      if (client.socket.readyState === WebSocket.OPEN) throw error;
      return { snapshot: latestSnapshot(client) ?? null, died: true };
    }
  }
  throw new Error(`Drive exceeded ${String(limit)} steps without reaching its goal.`);
}
