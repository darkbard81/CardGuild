import { describe, expect, it } from "vitest";

import { AUTH_COOKIE, authCookie, clearedAuthCookie, deriveCookieSecure, parseCookies } from "./cookies";

describe("cookie parsing", () => {
  it("reads one cookie out of a header that carries several", () => {
    const cookies = parseCookies(`theme=dark; ${AUTH_COOKIE}=abc123; other=1`);
    expect(cookies.get(AUTH_COOKIE)).toBe("abc123");
    expect(cookies.get("theme")).toBe("dark");
  });

  it("treats a missing or malformed header as no cookies at all", () => {
    for (const header of [undefined, "", "   ", "novalue", "=orphan", ";;;"]) {
      expect(parseCookies(header).get(AUTH_COOKIE)).toBeUndefined();
    }
  });

  it("round-trips a token whose characters need escaping", () => {
    const token = "a b+c/d=e";
    const header = authCookie(token, { secure: false, ttlMs: 1_000 });
    const value = header.slice(header.indexOf("=") + 1, header.indexOf(";"));
    expect(parseCookies(`${AUTH_COOKIE}=${value}`).get(AUTH_COOKIE)).toBe(token);
  });
});

describe("cookie attributes", () => {
  it("keeps the session out of JavaScript and off cross-site requests", () => {
    const header = authCookie("token", { secure: false, ttlMs: 60_000 });
    expect(header).toContain("HttpOnly");
    // SameSite=Lax is the only CSRF defence this server has.
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=60");
    // A Domain attribute would be rejected through the dev proxy's origin.
    expect(header).not.toContain("Domain");
    expect(header).not.toContain("Secure");
  });

  it("marks the cookie Secure only when configured to", () => {
    expect(authCookie("token", { secure: true, ttlMs: 1_000 })).toContain("Secure");
    expect(clearedAuthCookie({ secure: true, ttlMs: 1_000 })).toContain("Secure");
  });

  it("expires the cookie immediately when clearing it", () => {
    const header = clearedAuthCookie({ secure: false, ttlMs: 60_000 });
    expect(header).toContain(`${AUTH_COOKIE}=;`);
    expect(header).toContain("Max-Age=0");
  });
});

describe("Secure derivation", () => {
  it("follows the explicit setting over anything the origins imply", () => {
    expect(deriveCookieSecure(["http://localhost:4173"], "true")).toBe(true);
    expect(deriveCookieSecure(["https://card.example"], "false")).toBe(false);
  });

  it("defaults to secure only when every allowed origin is HTTPS", () => {
    expect(deriveCookieSecure(["https://card.example"])).toBe(true);
    expect(deriveCookieSecure(["https://card.example", "http://127.0.0.1:4173"])).toBe(false);
    expect(deriveCookieSecure(["http://127.0.0.1:4173"])).toBe(false);
    // No origins configured is not a reason to claim HTTPS.
    expect(deriveCookieSecure([])).toBe(false);
  });
});
