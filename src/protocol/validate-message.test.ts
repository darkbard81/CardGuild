import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../content";
import { validateClientMessage } from "./validate-message";

describe("protocol v3 structural validation", () => {
  it("requires one valid final direction on end-turn, but not on movement targets", () => {
    const message = (intent: unknown) => ({ v: 3, type: "intent", requestId: "facing", expectedRevision: 1, intent });
    for (const facing of [undefined, null, "northeast", 1]) {
      expect(validateClientMessage(message({ type: "end-turn", facing })).ok).toBe(false);
    }
    for (const facing of ["north", "east", "south", "west"]) {
      expect(validateClientMessage(message({ type: "end-turn", facing })).ok).toBe(true);
    }
    expect(validateClientMessage(message({ type: "use-action", action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 1, y: 1 } } })).ok).toBe(true);
  });
  it("accepts hello, party/claim intents, and actor-id-free combat intents", () => {
    expect(validateClientMessage({
      v: 3,
      type: "hello",
      sessionId: "session-a",
      playerId: "player-a",
      reconnectToken: "secret",
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 3,
      type: "intent",
      requestId: "request-a",
      expectedRevision: 3,
      intent: { type: "end-turn", facing: "west" },
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 3,
      type: "intent",
      requestId: "request-party",
      expectedRevision: 3,
      intent: {
        type: "set-party-composition",
        actorDefinitionIds: ["hero.aerin", "hero.lyra", "hero.brom"],
      },
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 3,
      type: "intent",
      requestId: "request-loadout",
      expectedRevision: 4,
      intent: {
        type: "set-loadout",
        memberId: "party.hero-2",
        loadout: { equipment: { feet: "boots-of-fly" }, preparedCards: [] },
      },
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 3,
      type: "intent",
      requestId: "remove-orphan",
      expectedRevision: 5,
      intent: { type: "remove-offline-guest", playerId: "player-orphan" },
    }).ok).toBe(true);
  });

  it("rejects client authority fields, invalid party shapes, unknown properties, and protocol v1", () => {
    for (const value of [
      {
        v: 3,
        type: "intent",
        requestId: "actor-injection",
        expectedRevision: 3,
        intent: { type: "end-turn", facing: "east", actorId: "enemy.goblin" },
      },
      {
        v: 3,
        type: "intent",
        requestId: "state-injection",
        expectedRevision: 3,
        intent: { type: "begin-adventure", adventureState: {} },
      },
      {
        v: 3,
        type: "intent",
        requestId: "outcome-injection",
        expectedRevision: 3,
        intent: { type: "accept-combat-result", outcome: "victory" },
      },
      {
        v: 3,
        type: "intent",
        requestId: "seed-injection",
        expectedRevision: 3,
        intent: { type: "begin-adventure", seed: 1234 },
      },
      {
        v: 3,
        type: "intent",
        requestId: "command-order-injection",
        expectedRevision: 3,
        intent: { type: "end-turn", facing: "east", id: "client-command", sequence: 99 },
      },
      {
        v: 1,
        type: "hello",
        sessionId: "session-a",
        playerId: "player-a",
        reconnectToken: "secret",
        contentIdentity: PRODUCTION_CONTENT.contentIdentity,
      },
      {
        v: 3,
        type: "intent",
        requestId: "duplicate-party",
        expectedRevision: 3,
        intent: { type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.aerin"] },
      },
      {
        v: 3,
        type: "intent",
        requestId: "implicit-loadout-owner",
        expectedRevision: 3,
        intent: { type: "set-loadout", loadout: { equipment: {}, preparedCards: [] } },
      },
      {
        v: 3,
        type: "intent",
        requestId: "implicit-orphan",
        expectedRevision: 3,
        intent: { type: "remove-offline-guest" },
      },
    ]) expect(validateClientMessage(value).ok).toBe(false);
  });
});
