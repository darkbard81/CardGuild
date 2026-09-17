import { expect, it } from "vitest";
import { attachedHost, deferred, envelope } from "../../support/host";
import { act, adventure, HERO } from "../../support/session";
import type { SessionCoreState } from "../../../src/session";

it("B-COMMIT delayed user save exposes neither future gameplay nor success, then publishes the committed result", async () => {
  const entered = deferred();
  const release = deferred();
  const client = await attachedHost(undefined, { async commitGameplayTransition() { entered.resolve(); await release.promise; } });
  const before = structuredClone(client.host.state);
  const pending = client.send({ type: "begin-adventure" });
  try {
    await entered.promise;
    expect(client.host.state.adventure).toBeNull();
    expect(client.messages.some(message => message.type === "ack" && message.accepted)).toBe(false);
    expect(client.messages.filter(message => message.type === "snapshot").every(message => message.state.revision === before.revision && !message.state.adventure)).toBe(true);
  } finally { release.resolve(); await pending; }
  expect(client.messages).toContainEqual(expect.objectContaining({ type: "ack", accepted: true, committedRevision: before.revision + 1 }));
  expect(client.messages).toContainEqual(expect.objectContaining({ type: "snapshot", state: expect.objectContaining({ adventure: expect.objectContaining({ phase: "between-encounters" }) }) }));
});

it("B-COMMIT failed user save keeps the checkpoint; retrying the same request can commit", async () => {
  let unavailable = true;
  const client = await attachedHost(undefined, { async commitGameplayTransition() { if (unavailable) throw new Error("injected storage unavailable"); } });
  const request = envelope(client.host.state, { type: "begin-adventure" }, "retry-after-storage-error");
  await client.host.handleIntent("host", client.connection.id, request);
  expect(client.messages).toContainEqual(expect.objectContaining({ type: "error", code: "PERSISTENCE_FAILED" }));
  expect(client.messages.some(message => message.type === "ack" && message.accepted)).toBe(false);
  expect(client.host.state.adventure).toBeNull();
  unavailable = false;
  await client.host.handleIntent("host", client.connection.id, request);
  expect(client.host.state.adventure?.phase).toBe("between-encounters");
  expect(client.messages).toContainEqual(expect.objectContaining({ type: "ack", requestId: request.requestId, accepted: true }));
});

it("B-COMMIT AI save delay and failure never expose its candidate and retire the unsaved session", async () => {
  const active = act(adventure(), { type: "start-encounter" });
  const combat = active.combat!;
  const enemy = Object.values(combat.actors).find(actor => actor.team === "enemies")!;
  const state: SessionCoreState = { ...active, lifecycle: "resume-lobby", combat: { ...combat,
    turn: { ...combat.turn, activeIndex: combat.turn.initiativeOrder.indexOf(enemy.id), activeActorId: enemy.id },
  } };
  const entered = deferred(); const release = deferred();
  const client = await attachedHost(state, { async commitGameplayTransition(previous, candidate) {
    if (previous.combat?.sequence === candidate.combat?.sequence) return;
    entered.resolve(); await release.promise; throw new Error("injected AI save failure");
  } });
  expect(client.host.state.lifecycle).toBe("resume-lobby");
  expect(client.host.state.combat!.sequence).toBe(combat.sequence);
  expect(client.messages.filter(m => m.type === "snapshot").every(m => m.state.combat!.sequence === combat.sequence)).toBe(true);
  const pending = client.send({ type: "resume-adventure" });
  try {
    await entered.promise;
    expect(client.host.state.combat!.sequence).toBe(combat.sequence);
    expect(client.messages.filter(m => m.type === "snapshot").every(m => m.state.combat!.sequence === combat.sequence)).toBe(true);
  } finally { release.resolve(); await pending; }
  expect(client.host.retired).toBe(true);
  expect(client.closed).toContainEqual(expect.objectContaining({ code: 4005 }));
  expect(client.host.state.combat!.actors[HERO]!.hp).toBe(combat.actors[HERO]!.hp);
  expect(client.messages.filter(m => m.type === "snapshot").every(m => m.state.combat!.sequence === combat.sequence)).toBe(true);
});

it("B-WIRE duplicate and stale envelopes cannot apply a second action or reuse a request ID for another action", async () => {
  const client = await attachedHost();
  const request = envelope(client.host.state, { type: "begin-adventure" }, "one-request");
  await client.host.handleIntent("host", client.connection.id, request);
  const committed = client.host.state.revision;
  await client.host.handleIntent("host", client.connection.id, request);
  expect(client.host.state.revision).toBe(committed);
  await client.host.handleIntent("host", client.connection.id, { ...request, intent: { type: "start-encounter" } });
  expect(client.messages).toContainEqual(expect.objectContaining({ type: "error", code: "REQUEST_ID_REUSE" }));
  await client.host.handleIntent("host", client.connection.id, { ...request, requestId: "stale", intent: { type: "start-encounter" } });
  expect(client.messages).toContainEqual(expect.objectContaining({ type: "error", code: "STALE_REVISION" }));
  expect(client.host.state.revision).toBe(committed);
  expect(client.host.state.combat).toBeNull();
  // Handshake failures are session access failures, not domain rule validation.
  expect(await client.host.attach("host", "invalid-token", client.host.state.contentIdentity, client.connection)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  expect(await client.host.attach("host", client.credential.token, { ...client.host.state.contentIdentity, fingerprint: "wrong" }, client.connection)).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
});
