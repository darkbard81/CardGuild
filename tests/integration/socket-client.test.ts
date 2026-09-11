import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_CONTENT } from "../../src/content";
import type { ServerError, ServerSnapshot } from "../../src/protocol";
import type { SessionCredentialResponse } from "../../src/server/session-store";
import { drive, latestSnapshot } from "../support/campaign/campaign-drive";
import {
  ackFrame,
  errorFrame,
  resumeLobbySnapshot,
  send,
  startFakeSocketServer,
  type FakeSocketServer,
} from "../support/network/fake-socket-server";
import { SocketClient, SocketClosedError } from "../support/network/socket-client";

/**
 * The shared wait contract, against a real socket whose event order the test dictates.
 *
 * Every Integration suite reaches the server through `SocketClient`, so what it does when a
 * connection dies decides how long a crash test takes and what it is allowed to conclude.
 * Before this, a wait only ever ended on a message or on its timeout: a killed server meant
 * twenty seconds of waiting for an answer that could not arrive, eight times in one
 * restart-matrix run. Ending the wait on the close is the whole optimisation, and getting it
 * wrong in the other direction — treating a refusal or a silence as a death — would let a
 * crash test pass without a crash.
 */
const CREDENTIAL: SessionCredentialResponse = {
  sessionId: "fake-session",
  playerId: "p1",
  reconnectToken: "token",
  seat: 1,
};

const IDENTITY = PRODUCTION_CONTENT.contentIdentity;

let servers: FakeSocketServer[] = [];

afterEach(async () => {
  for (const server of servers) await server.dispose();
  servers = [];
  vi.useRealTimers();
});

async function connected(): Promise<{ server: FakeSocketServer; client: SocketClient; peer: WebSocket }> {
  const server = await startFakeSocketServer();
  servers.push(server);
  const client = await SocketClient.connect(server.origin, CREDENTIAL);
  const peer = await server.accept();
  return { server, client, peer };
}

describe("SocketClient waits", () => {
  it("ends a pending ACK wait on the close instead of waiting out the timeout", async () => {
    const { client, peer } = await connected();

    const started = Date.now();
    const pending = client.ack("r1", client.mark(), 20_000);
    peer.close(1011, "server died");

    await expect(pending).rejects.toBeInstanceOf(SocketClosedError);
    // The point of the change: the answer arrives with the close, not 20 seconds later.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reports a connection that had already closed before the wait began", async () => {
    const { client, peer } = await connected();
    peer.close(1011, "server died");
    await client.waitForClose();

    const error = await client.ack("r1", 0, 20_000).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SocketClosedError);
    expect((error as SocketClosedError).code).toBe(1011);
    expect((error as SocketClosedError).reason).toBe("server died");
    expect((error as SocketClosedError).from).toBe(0);
  });

  it("returns an ACK that arrived before the close, closed connection or not", async () => {
    const { client, peer } = await connected();
    const mark = client.mark();
    send(peer, ackFrame("r1", true, 4));
    peer.close(1001, "going away");
    await client.waitForClose();

    // It did arrive. A connection that has since died does not un-receive it.
    await expect(client.ack("r1", mark)).resolves.toMatchObject({ accepted: true, committedRevision: 4 });
  });

  it("returns a protocol error that arrived before the close", async () => {
    const { client, peer } = await connected();
    const mark = client.mark();
    send(peer, errorFrame("CONTENT_MISMATCH", "wrong pack"));
    peer.close(4005, "session retired");
    await client.waitForClose();

    const found = await client.waitFor(
      (message): message is ServerError => message.type === "error", mark);
    expect(found.code).toBe("CONTENT_MISMATCH");
  });

  it("ends the snapshot wait the close made unreachable, after returning the ACK it did get", async () => {
    const { client, peer } = await connected();
    const mark = client.mark();
    send(peer, ackFrame("r1", true, 9));
    peer.close(1011, "died before publishing");

    const ack = await client.ack("r1", mark);
    expect(ack.committedRevision).toBe(9);
    // The commit was acknowledged and then never published. That is a death, not a timeout.
    await expect(client.snapshot(mark, (snapshot) => snapshot.revision >= ack.committedRevision))
      .rejects.toBeInstanceOf(SocketClosedError);
  });

  it("still fails by timeout while the connection is open and silent", async () => {
    const { client } = await connected();
    // Only the wait's own timer is faked; the socket keeps its real I/O.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const pending = client.ack("never", 0, 15_000);
    const settled = expect(pending).rejects.toThrow(/Timed out after index 0/);
    await vi.advanceTimersByTimeAsync(15_000);
    await settled;

    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    expect(client.closedWith).toBeNull();
  });

  it("completes every concurrent wait and leaves no listener or timer behind", async () => {
    const { client, peer } = await connected();
    const messageListeners = client.socket.listenerCount("message");
    const closeListeners = client.socket.listenerCount("close");

    const mark = client.mark();
    const first = client.ack("a", mark);
    const second = client.ack("b", mark);
    const third = client.waitFor(
      (message): message is ServerSnapshot => message.type === "snapshot", mark);
    expect(client.socket.listenerCount("message")).toBe(messageListeners + 3);

    send(peer, ackFrame("b", true, 1));
    await expect(second).resolves.toMatchObject({ requestId: "b" });
    send(peer, ackFrame("a", true, 2));
    send(peer, resumeLobbySnapshot(2, IDENTITY));
    await expect(first).resolves.toMatchObject({ requestId: "a" });
    await expect(third).resolves.toMatchObject({ revision: 2 });

    expect(client.socket.listenerCount("message")).toBe(messageListeners);
    expect(client.socket.listenerCount("close")).toBe(closeListeners);

    // Repeated calls for something already in the log stay resolved and add nothing.
    await expect(client.ack("a", mark)).resolves.toMatchObject({ requestId: "a" });
    await expect(client.ack("a", mark)).resolves.toMatchObject({ requestId: "a" });
    expect(client.socket.listenerCount("message")).toBe(messageListeners);
  });
});

describe("SocketClient close reporting", () => {
  it("reports the real code for a normal close, before and after it is observed", async () => {
    const { client } = await connected();
    await expect(client.close()).resolves.toBe(1000);
    // The recorded closure answers the second call rather than a hard-coded 1000.
    await expect(client.close()).resolves.toBe(1000);
    await expect(client.waitForClose()).resolves.toBe(1000);
    expect(client.closedWith).toEqual({ code: 1000, reason: "test close" });
  });

  it("reports the real code for an abnormal close rather than a flat 1000", async () => {
    const { client, peer } = await connected();
    peer.terminate();

    await expect(client.waitForClose()).resolves.toBe(1006);
    await expect(client.close()).resolves.toBe(1006);
    expect(client.closedWith?.code).toBe(1006);
  });

  it("reports a retired session's 4005 with its reason", async () => {
    const { client, peer } = await connected();
    peer.close(4005, "session retired");

    await expect(client.waitForClose()).resolves.toBe(4005);
    expect(client.closedWith).toEqual({ code: 4005, reason: "session retired" });
    // A wait started after the fact carries the same code, not a generic failure.
    const error = await client.snapshot(0).catch((reason: unknown) => reason);
    expect((error as SocketClosedError).code).toBe(4005);
  });
});

describe("campaign drive against a dying connection", () => {
  it("stops on the close, keeps the last snapshot it saw, and sends nothing more", async () => {
    const { server, client, peer } = await connected();
    send(peer, resumeLobbySnapshot(3, IDENTITY));
    await client.snapshot(0);

    const started = Date.now();
    const driving = drive(client, { prefix: "d" });
    // Let the loop send its intent, then take the connection away without answering.
    await vi.waitFor(() => expect(server.received.length).toBe(2));
    peer.close(1011, "killed mid-intent");

    const result = await driving;
    expect(result.died).toBe(true);
    expect(result.snapshot?.revision).toBe(3);
    expect(latestSnapshot(client)?.revision).toBe(3);
    // Two frames total: the hello and the one intent. Nothing was pushed at a dead socket.
    expect(server.received).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("keeps a refused intent a failure even when the connection dies right after", async () => {
    const { server, client, peer } = await connected();
    send(peer, resumeLobbySnapshot(3, IDENTITY));
    await client.snapshot(0);

    const driving = drive(client, { prefix: "d" });
    await vi.waitFor(() => expect(server.received.length).toBe(2));
    // The refusal is delivered first, and the close follows immediately behind it.
    send(peer, ackFrame("d-0", false, 3));
    peer.close(1011, "and then it died");

    // A rejected intent is a product answer. Losing the connection afterwards does not turn
    // it into "the server crashed", which is what a crash test would then pass on.
    await expect(driving).rejects.toThrow(/was refused/);
  });
});
