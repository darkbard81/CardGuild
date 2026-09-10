export const AUTH_COOKIE = "cardguild_auth";

export interface CookieConfig {
  readonly secure: boolean;
  readonly ttlMs: number;
}

export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (name) cookies.set(name, decodeURIComponent(part.slice(separator + 1).trim()));
  }
  return cookies;
}

/**
 * `SameSite=Lax` is what stops a cross-site page from POSTing to /api/campaigns with the
 * player's ambient cookie: there is no CSRF token anywhere in this server. Loosening this
 * to `SameSite=None` therefore requires adding one first.
 *
 * No `Domain` attribute: the vite dev proxy forwards Set-Cookie verbatim, and a Domain
 * naming the backend host would be rejected by the browser at the dev origin. Cookies
 * ignore the port, so a host-only cookie works through the proxy and in production alike.
 */
function serialize(value: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${AUTH_COOKIE}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function authCookie(token: string, config: CookieConfig): string {
  return serialize(encodeURIComponent(token), Math.floor(config.ttlMs / 1000), config.secure);
}

export function clearedAuthCookie(config: CookieConfig): string {
  return serialize("", 0, config.secure);
}

/**
 * Production terminates TLS at a reverse proxy and talks plain HTTP to this process, so
 * the request itself cannot say whether the browser used HTTPS. `X-Forwarded-Proto` is
 * attacker-controlled unless the proxy strips it, and nothing here strips headers — so
 * `Secure` comes from configuration, defaulting to whatever the allowed origins imply.
 */
export function deriveCookieSecure(allowedOrigins: Iterable<string>, override?: string): boolean {
  if (override === "true") return true;
  if (override === "false") return false;
  const origins = [...allowedOrigins];
  return origins.length > 0 && origins.every((origin) => origin.startsWith("https://"));
}
