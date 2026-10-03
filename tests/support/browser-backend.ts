import { test, type Page, type WebSocketRoute } from "@playwright/test";
import { PROTOCOL_VERSION, type ClientIntentEnvelope, type ServerMessage, type ServerSnapshot } from "../../src/protocol";
import { dispatchSessionIntent, hashSessionGameplayState, type SessionCoreState } from "../../src/session";
import { adventure, context } from "./session";

/** Real bootstrap/controller/client. Resume seeds credentials only, never gameplay or UI state.
 * Entry tests opt into join/create; unrelated interactions need not repeat the join form.
 */
export async function controlledSession(page: Page, initial = adventure(), entry: "resume" | "join" | "create" = "resume", viewer = "host", welcome: "skip" | "show" = "skip", authority = context) {
  const testInfo = test.info();
  testInfo.annotations.push({ type: "session", description: `seed=${initial.adventure?.adventureSeed ?? 60}; revision=${initial.revision}` });
  let state = initial;
  let socket: WebSocketRoute | undefined;
  const requests: ClientIntentEnvelope[] = [];
  const campaigns: unknown[] = [];
  let controlRevision = 0;
  let handshakes = 0;
  let receivedHello!: () => void;
  const firstHello = new Promise<void>(resolve => { receivedHello = resolve; });
  let connectedPlayerIds = state.seats.map(seat => seat.playerId);
  let controllers = Object.fromEntries(state.partySlots.map(slot => [slot.memberId, state.guestClaims.byMemberId[slot.memberId] ?? "host"]));
  const snapshot = (cause: ServerSnapshot["cause"] = { kind: "resync" }): ServerSnapshot => ({
    v: PROTOCOL_VERSION, type: "snapshot", revision: state.revision, controlRevision,
    gameplayHash: hashSessionGameplayState(state), state,
    control: { connectedPlayerIds, effectiveControllerByMemberId: controllers }, events: [], cause,
  });
  const send = (message: ServerMessage) => {
    if (!socket) throw new Error("Browser WebSocket has not connected");
    socket.send(JSON.stringify(message));
  };
  await page.route("**/api/auth/me", route => route.fulfill({ json: { account: entry === "create" ? { accountId: "account", username: "Player" } : null } }));
  await page.route("**/api/campaigns", route => {
    campaigns.push(route.request().postDataJSON());
    return route.fulfill({ json: { sessionId: state.sessionId, playerId: viewer, reconnectToken: "browser-backend-token", seat: state.seats.find(seat => seat.playerId === viewer)?.seat ?? 1 } });
  });
  await page.route("**/api/sessions/*/join", route => route.fulfill({ json: { sessionId: state.sessionId, playerId: viewer, reconnectToken: "browser-backend-token", seat: state.seats.find(seat => seat.playerId === viewer)?.seat ?? 1 } }));
  await page.routeWebSocket("**/ws", route => {
    socket = route;
    route.onMessage(raw => {
      const message = JSON.parse(String(raw)) as { type: string };
      if (message.type === "hello") { handshakes++; send(snapshot()); receivedHello(); }
      if (message.type === "intent") {
        const request = message as ClientIntentEnvelope;
        requests.push(request);
        testInfo.annotations.push({ type: "request", description: `${request.requestId}; expectedRevision=${request.expectedRevision}; intent=${request.intent.type}` });
      }
    });
  });
  await test.step(`Prepare controlled session: ${entry}`, async () => {
    if (entry === "resume") {
      await page.addInitScript(credential => {
        // Init scripts run again on reload. Do not resurrect a credential the product
        // cleared on exit/retirement; each case has its own fresh browser context.
        if (sessionStorage.getItem("cardguild.test-session-seeded")) return;
        sessionStorage.setItem("cardguild.test-session-seeded", "true");
        sessionStorage.setItem("cardguild.session.v2", JSON.stringify(credential));
      }, { sessionId: state.sessionId, playerId: viewer, reconnectToken: "browser-backend-token",
        seat: state.seats.find(seat => seat.playerId === viewer)?.seat ?? 1 });
    }
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (entry === "create") {
      await page.getByRole("button", { name: "새 모험 시작", exact: true }).click();
      if (welcome === "skip") await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
    } else {
      if (entry === "join") {
        await page.getByRole("button", { name: "초대 코드로 참가", exact: true }).click();
        await page.getByLabel("초대 코드", { exact: true }).fill("controlled-session");
        await page.getByRole("button", { name: "참가하기", exact: true }).click();
      }
      // Wait for the actual event, without poll backoff after bootstrap finishes.
      await test.step("Receive initial session snapshot", () => firstHello, { timeout: 5_000 });
    }
  });
  return {
    get handshakes() { return handshakes; },
    requests,
    campaigns,
    get state() { return state; },
    send,
    publish(next: SessionCoreState = state, events: ServerSnapshot["events"] = []) { state = next; send({ ...snapshot(), events }); },
    control(next: Record<string, string>, connected = connectedPlayerIds) { controllers = next; connectedPlayerIds = connected; controlRevision++; send(snapshot({ kind: "control" })); },
    candidate(request = requests.at(-1)!) {
      const result = dispatchSessionIntent(state, viewer, request.intent, { ...authority, adventureId: state.adventure?.adventureId ?? authority.adventureId },
        { connectedPlayerIds, effectiveControllerByMemberId: controllers });
      if (!result.accepted) throw new Error(result.error);
      return result.state;
    },
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
