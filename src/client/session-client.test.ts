import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProtocolErrorCode, ServerError, ServerSnapshot } from "../protocol";
import { isTerminalHandshakeFailure, SessionClient, type SessionCredential } from "./session-client";

type Listener = (event: { readonly data?: string; readonly code?: number; readonly reason?: string }) => void;

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static readonly instances: FakeWebSocket[] = [];

  public readyState = FakeWebSocket.CONNECTING;
  public readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  public constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  public addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public send(value: string): void {
    this.sent.push(value);
  }

  public close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  public open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  public serverClose(code: number, reason = ""): void {
    this.close(code, reason);
  }

  public message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  private emit(type: string, event: Parameters<Listener>[0]): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const credential: SessionCredential = {
  sessionId: "session-test",
  playerId: "player-test",
  reconnectToken: "token-test",
  seat: 1,
};

function snapshot(revision: number, controlRevision = 0, cause: "resync" | "control" = "resync"): ServerSnapshot {
  return {
    v: 2,
    type: "snapshot",
    revision,
    controlRevision,
    gameplayHash: `hash-${revision}`,
    cause: { kind: cause },
    state: {},
    control: { connectedPlayerIds: [], effectiveControllerByMemberId: {} },
    events: [],
  } as unknown as ServerSnapshot;
}

describe("SessionClient reconnect handshake", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances.length = 0;
    storage.clear();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("window", {
      location: { href: "http://cardguild.test/" },
      setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    });
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null,
      get length() { return storage.size; },
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("classifies every terminal handshake protocol error", () => {
    const terminal: ProtocolErrorCode[] = [
      "SESSION_NOT_FOUND",
      "UNAUTHENTICATED",
      "CONTENT_MISMATCH",
      "PROTOCOL_MISMATCH",
    ];
    expect(terminal.every(isTerminalHandshakeFailure)).toBe(true);
    expect(isTerminalHandshakeFailure("STALE_REVISION")).toBe(false);
  });

  it("preserves exponential backoff across TCP opens and resets only after an authoritative snapshot", async () => {
    const statuses: string[] = [];
    const client = new SessionClient(credential, {
      onSnapshot: () => undefined,
      onError: () => undefined,
      onStatus: (status) => statuses.push(status),
    });

    client.connect();
    const first = FakeWebSocket.instances[0] as FakeWebSocket;
    first.open();
    expect(statuses).not.toContain("connected");
    first.serverClose(1006);
    await vi.advanceTimersByTimeAsync(250);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.instances[1] as FakeWebSocket;
    second.open();
    second.serverClose(1006);
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    const third = FakeWebSocket.instances[2] as FakeWebSocket;
    third.open();
    third.message(snapshot(7));
    expect(statuses.at(-1)).toBe("connected");
    third.serverClose(1006);
    await vi.advanceTimersByTimeAsync(249);
    expect(FakeWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it("clears a rejected credential and never schedules another connection", async () => {
    storage.set("cardguild.session.v2", JSON.stringify(credential));
    const statuses: string[] = [];
    const errors: ServerError[] = [];
    const client = new SessionClient(credential, {
      onSnapshot: () => undefined,
      onError: (error) => errors.push(error),
      onStatus: (status) => statuses.push(status),
    });
    client.connect();
    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    socket.open();
    socket.message({
      v: 2,
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: "Session was not found.",
    } satisfies ServerError);

    expect(storage.has("cardguild.session.v2")).toBe(false);
    expect(statuses.at(-1)).toBe("closed");
    expect(errors.map((error) => error.code)).toEqual(["SESSION_NOT_FOUND"]);
    await vi.advanceTimersByTimeAsync(10_000);
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("applies a newer control revision even when gameplay revision is unchanged", () => {
    const applied: ServerSnapshot[] = [];
    const client = new SessionClient(credential, {
      onSnapshot: (value) => applied.push(value),
      onError: () => undefined,
      onStatus: () => undefined,
    });
    client.connect();
    const socket = FakeWebSocket.instances[0] as FakeWebSocket;
    socket.open();
    socket.message(snapshot(4, 2));
    socket.message(snapshot(4, 3, "control"));
    socket.message(snapshot(4, 2, "control"));
    expect(applied.map((value) => [value.revision, value.controlRevision])).toEqual([
      [4, 2],
      [4, 3],
    ]);
  });
});
