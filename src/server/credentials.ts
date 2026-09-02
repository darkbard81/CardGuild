import { Buffer } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface ReconnectCredential {
  readonly token: string;
  readonly digest: string;
}
export function digestReconnectToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function createReconnectCredential(): ReconnectCredential {
  const token = randomBytes(32).toString("base64url");
  return { token, digest: digestReconnectToken(token) };
}

export function createOpaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function reconnectTokenMatches(token: string, expectedDigest: string): boolean {
  const received = Buffer.from(digestReconnectToken(token));
  const expected = Buffer.from(expectedDigest);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
