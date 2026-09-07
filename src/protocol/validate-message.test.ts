import { describe, expect, it } from "vitest";

import { PRODUCTION_CONTENT } from "../content";
import { validateClientMessage } from "./validate-message";

describe("protocol v4 structural validation", () => {
  /**
   * v3 carried a facing-less `end-turn` and a facing-bearing tile target, so a v3 peer and
   * a v4 peer reject each other's payloads. The envelope version is what keeps that from
   * being discovered one rejected intent at a time.
   */
  it("rejects the v3 envelope outright, whatever its payload", () => {
    const hello = {
      type: "hello",
      sessionId: "session-a",
      playerId: "player-a",
      reconnectToken: "secret",
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    };
    expect(validateClientMessage({ v: 4, ...hello }).ok).toBe(true);
    for (const v of [1, 2, 3, 5, "4", null]) {
      expect(validateClientMessage({ v, ...hello }).ok).toBe(false);
      expect(validateClientMessage({
        v, type: "intent", requestId: "legacy", expectedRevision: 3, intent: { type: "end-turn", facing: "east" },
      }).ok).toBe(false);
    }
    // The two shapes v3 and v4 disagree on, each rejected under the other's version.
    expect(validateClientMessage({
      v: 4, type: "intent", requestId: "v3-end-turn", expectedRevision: 3, intent: { type: "end-turn" },
    }).ok).toBe(false);
    expect(validateClientMessage({
      v: 3, type: "intent", requestId: "v4-move", expectedRevision: 3,
      intent: { type: "use-action", action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 1, y: 1 } } },
    }).ok).toBe(false);
  });

  it("requires one valid final direction on end-turn, but not on movement targets", () => {
    const message = (intent: unknown) => ({ v: 4, type: "intent", requestId: "facing", expectedRevision: 1, intent });
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
      v: 4,
      type: "hello",
      sessionId: "session-a",
      playerId: "player-a",
      reconnectToken: "secret",
      contentIdentity: PRODUCTION_CONTENT.contentIdentity,
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 4,
      type: "intent",
      requestId: "request-a",
      expectedRevision: 3,
      intent: { type: "end-turn", facing: "west" },
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 4,
      type: "intent",
      requestId: "request-party",
      expectedRevision: 3,
      intent: {
        type: "set-party-composition",
        actorDefinitionIds: ["hero.aerin", "hero.lyra", "hero.brom"],
      },
    }).ok).toBe(true);
    expect(validateClientMessage({
      v: 4,
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
      v: 4,
      type: "intent",
      requestId: "remove-orphan",
      expectedRevision: 5,
      intent: { type: "remove-offline-guest", playerId: "player-orphan" },
    }).ok).toBe(true);
  });

  it("rejects client authority fields, invalid party shapes, unknown properties, and protocol v1", () => {
    for (const value of [
      {
        v: 4,
        type: "intent",
        requestId: "actor-injection",
        expectedRevision: 3,
        intent: { type: "end-turn", facing: "east", actorId: "enemy.goblin" },
      },
      {
        v: 4,
        type: "intent",
        requestId: "state-injection",
        expectedRevision: 3,
        intent: { type: "begin-adventure", adventureState: {} },
      },
      {
        v: 4,
        type: "intent",
        requestId: "outcome-injection",
        expectedRevision: 3,
        intent: { type: "accept-combat-result", outcome: "victory" },
      },
      {
        v: 4,
        type: "intent",
        requestId: "seed-injection",
        expectedRevision: 3,
        intent: { type: "begin-adventure", seed: 1234 },
      },
      {
        v: 4,
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
        v: 4,
        type: "intent",
        requestId: "duplicate-party",
        expectedRevision: 3,
        intent: { type: "set-party-composition", actorDefinitionIds: ["hero.aerin", "hero.aerin"] },
      },
      {
        v: 4,
        type: "intent",
        requestId: "implicit-loadout-owner",
        expectedRevision: 3,
        intent: { type: "set-loadout", loadout: { equipment: {}, preparedCards: [] } },
      },
      {
        v: 4,
        type: "intent",
        requestId: "implicit-orphan",
        expectedRevision: 3,
        intent: { type: "remove-offline-guest" },
      },
    ]) expect(validateClientMessage(value).ok).toBe(false);
  });
});
