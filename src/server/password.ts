import { Buffer } from "node:buffer";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Passwords are stored as a self-describing scrypt string, so the cost parameters
 * travel with the hash and can be raised later without invalidating older accounts.
 *
 *   scrypt$<N>$<r>$<p>$<salt base64url>$<key base64url>
 */
const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const DEFAULT_COST = { N: 32_768, r: 8, p: 1 } as const;

interface ScryptCost {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** node's default maxmem (32 MiB) is just under what N=32768,r=8 needs. */
function maxmemFor(cost: ScryptCost): number {
  return Math.max(32 * 1024 * 1024, 256 * cost.N * cost.r);
}

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: maxmemFor(cost) }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  if (!password) throw new Error("Password must not be empty.");
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, cost);
  return [SCHEME, cost.N, cost.r, cost.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

function parseCost(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Never throws on a malformed stored hash: a corrupt row must read as "wrong password",
 * not as a server error that tells the caller the row exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;
  const N = parseCost(parts[1]);
  const r = parseCost(parts[2]);
  const p = parseCost(parts[3]);
  if (N === null || r === null || p === null || !parts[4] || !parts[5]) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (!salt.length || expected.length !== KEY_BYTES) return false;
  try {
    const key = await derive(password, salt, { N, r, p });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
