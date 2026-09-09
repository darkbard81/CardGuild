import { Buffer } from "node:buffer";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface ReconnectCredential {
  readonly token: string;
  readonly digest: string;
}

/** Opaque bearer tokens are stored as digests only, never in the clear. */
export function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenMatchesDigest(token: string, expectedDigest: string): boolean {
  const received = Buffer.from(digestToken(token));
  const expected = Buffer.from(expectedDigest);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function digestReconnectToken(token: string): string {
  return digestToken(token);
}

export function createReconnectCredential(): ReconnectCredential {
  const token = createOpaqueToken();
  return { token, digest: digestReconnectToken(token) };
}

export function createOpaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

export function reconnectTokenMatches(token: string, expectedDigest: string): boolean {
  return tokenMatchesDigest(token, expectedDigest);
}
