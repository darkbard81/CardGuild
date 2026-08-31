import { describe, expect, it } from "vitest";

import { M4_CONTENT_IDENTITY } from "../content";
import { validateClientMessage } from "./validate-message";

describe("protocol v1 structural validation", () => {
  it("accepts hello and identity-free gameplay intents", () => {
    expect(validateClientMessage({
      v: 1,
      type: "hello",
      sessionId: "session-a",
      playerId: "player-a",
      reconnectToken: "secret",
      contentIdentity: M4_CONTENT_IDENTITY,
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 1,
      type: "intent",
      requestId: "request-a",
      expectedRevision: 3,
      intent: { type: "end-turn" },
    }).ok).toBe(true);
  });

  it("rejects client authority fields, outcome injection, unknown properties, and protocol v2", () => {
    for (const value of [
      {
        v: 1,
        type: "intent",
        requestId: "actor-injection",
        expectedRevision: 3,
        intent: { type: "end-turn", actorId: "enemy.goblin" },
      },
      {
        v: 1,
        type: "intent",
        requestId: "state-injection",
        expectedRevision: 3,
        intent: { type: "begin-adventure", adventureState: {} },
      },
      {
        v: 1,
        type: "intent",
        requestId: "outcome-injection",
        expectedRevision: 3,
        intent: { type: "accept-combat-result", outcome: "victory" },
      },
      {
        v: 1,
        type: "intent",
        requestId: "seed-injection",
        expectedRevision: 3,
        intent: { type: "begin-adventure", seed: 1234 },
      },
      {
        v: 1,
        type: "intent",
        requestId: "command-order-injection",
        expectedRevision: 3,
        intent: { type: "end-turn", id: "client-command", sequence: 99 },
      },
      {
        v: 2,
        type: "hello",
        sessionId: "session-a",
        playerId: "player-a",
        reconnectToken: "secret",
        contentIdentity: M4_CONTENT_IDENTITY,
      },
    ]) expect(validateClientMessage(value).ok).toBe(false);
  });
});
