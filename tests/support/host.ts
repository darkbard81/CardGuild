import { PROTOCOL_VERSION, type ClientIntentEnvelope, type ServerMessage } from "../../src/protocol";
import { createReconnectCredential } from "../../src/server/credentials";
import { SessionHost, type SessionConnection } from "../../src/server/session-host";
import type { SessionDurability } from "../../src/server/campaign-durability";
import type { SessionCoreState, SessionIntent } from "../../src/session";
import { context, prepared } from "./session";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function mailbox(id = "connection-host") {
  const messages: ServerMessage[] = [];
  const closed: { code: number; reason: string }[] = [];
  const connection: SessionConnection = {
    id, send: message => { messages.push(structuredClone(message)); },
    close: (code, reason) => { closed.push({ code, reason }); },
  };
  return { messages, closed, connection };
}

export function envelope(state: SessionCoreState, intent: SessionIntent, requestId = `request-${state.revision}`): ClientIntentEnvelope {
  return { v: PROTOCOL_VERSION, type: "intent", requestId, expectedRevision: state.revision, intent };
}

export async function attachedHost(state = prepared(), durability?: SessionDurability) {
  const credential = createReconnectCredential();
  const host = new SessionHost(state, context, credential.digest, { durability });
  const output = mailbox();
  const result = await host.attach(state.hostPlayerId, credential.token, state.contentIdentity, output.connection);
  if (!result.ok) throw new Error(result.code);
  return { host, credential, ...output,
    send: (intent: SessionIntent, requestId?: string) => host.handleIntent(state.hostPlayerId, output.connection.id, envelope(host.state, intent, requestId)),
  };
}
