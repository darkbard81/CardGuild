import { expect, type Page, type WebSocketRoute } from "@playwright/test";
import { PROTOCOL_VERSION, type ClientIntentEnvelope, type ServerMessage, type ServerSnapshot } from "../../src/protocol";
import { hashSessionGameplayState, type SessionCoreState } from "../../src/session";
import { adventure, act } from "./session";

/** Only the backend is controlled: the page loads the real bootstrap, controller, UI and SessionClient. */
export async function controlledSession(page: Page, initial = adventure()) {
  let state = initial;
  let socket: WebSocketRoute | undefined;
  const requests: ClientIntentEnvelope[] = [];
  let controlRevision = 0;
  let controllers = Object.fromEntries(state.partySlots.map(slot => [slot.memberId, "host"]));
  const snapshot = (cause: ServerSnapshot["cause"] = { kind: "resync" }): ServerSnapshot => ({
    v: PROTOCOL_VERSION, type: "snapshot", revision: state.revision, controlRevision,
    gameplayHash: hashSessionGameplayState(state), state,
    control: { connectedPlayerIds: ["host"], effectiveControllerByMemberId: controllers }, events: [], cause,
  });
  const send = (message: ServerMessage) => {
    if (!socket) throw new Error("Browser WebSocket has not connected");
    socket.send(JSON.stringify(message));
  };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { account: null } }));
  await page.route("**/api/sessions/*/join", route => route.fulfill({ json: { sessionId: state.sessionId, playerId: "host", reconnectToken: "browser-backend-token", seat: 1 } }));
  await page.routeWebSocket("**/ws", route => {
    socket = route;
    route.onMessage(raw => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "hello") send(snapshot());
      if (message.type === "intent") requests.push(message as ClientIntentEnvelope);
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
  await page.getByLabel("초대 코드", { exact: true }).fill("controlled-session");
  await page.getByRole("button", { name: "참가하기", exact: true }).click();
  await expect.poll(() => Boolean(socket)).toBe(true);
  return {
    requests,
    get state() { return state; },
    send,
    publish(next: SessionCoreState = state) { state = next; send(snapshot()); },
    control(next: Record<string, string>) { controllers = next; controlRevision++; send(snapshot({ kind: "control" })); },
    candidate(request = requests.at(-1)!) { return act(state, request.intent); },
    ack(accepted: boolean, revision = state.revision + 1, request = requests.at(-1)!) {
      send({ v: PROTOCOL_VERSION, type: "ack", requestId: request.requestId, accepted, committedRevision: revision });
    },
    reject(request = requests.at(-1)!) {
      send({ v: PROTOCOL_VERSION, type: "error", requestId: request.requestId, code: "PERSISTENCE_FAILED", message: "Saving failed. Retry." });
    },
    disconnect() { socket!.close({ code: 1012, reason: "restart" }); },
    terminal() { send({ v: PROTOCOL_VERSION, type: "error", code: "SESSION_RETIRED", message: "Continue the saved campaign." }); },
  };
}
