import { readFile, stat } from "node:fs/promises";
import { createServer, type Server as HttpServer, type ServerResponse } from "node:http";
import path from "node:path";

import type { SessionAuthorityContext } from "../session";
import { createAuthService, DEFAULT_AUTH_TTL_MS } from "./auth-service";
import { createCampaignService } from "./campaign-service";
import type { CookieConfig } from "./cookies";
import { createHttpApi } from "./http-api";
import { createSqlitePersistence, MEMORY_DATABASE, type Persistence } from "./persistence";
import { SessionStore, type SessionStoreSources } from "./session-store";
import { attachWebSocketGateway } from "./ws-gateway";

export interface StartServerOptions {
  readonly context: SessionAuthorityContext;
  readonly host?: string;
  readonly port?: number;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly staticRoot?: string;
  readonly sources?: SessionStoreSources;
  readonly heartbeatMs?: number;
  readonly helloDeadlineMs?: number;
  readonly onInternalError?: (error: unknown) => void;
  /** Defaults to a private in-memory database, which is what every test wants. */
  readonly persistence?: Persistence;
  readonly authTtlMs?: number;
  readonly cookie?: CookieConfig;
}

export interface RunningCardGuildServer {
  readonly httpServer: HttpServer;
  readonly store: SessionStore;
  readonly origin: string;
  /**
   * Stop serving and close the database, exactly once.
   *
   * Idempotent by contract: concurrent callers and callers after the fact all await the
   * same shutdown and see the same outcome. `SIGINT` and `SIGTERM` can both arrive, and a
   * second attempt that re-ran this sequence would close an already closed database.
   * A failure is reported to every caller rather than swallowed — a shutdown that could
   * not finish writing must not look like a clean one.
   */
  close(): Promise<void>;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function serveStatic(root: string, pathname: string, serverResponse: ServerResponse): Promise<boolean> {
  const rootPath = path.resolve(root);
  const requested = pathname === "/" ? "/index.html" : pathname;
  let filePath = path.resolve(rootPath, `.${requested}`);
  if (!filePath.startsWith(`${rootPath}${path.sep}`)) return false;
  try {
    if (!(await stat(filePath)).isFile()) return false;
  } catch {
    if (path.extname(requested)) return false;
    filePath = path.join(rootPath, "index.html");
  }
  try {
    const body = await readFile(filePath);
    serverResponse.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
      "content-length": body.length,
    });
    serverResponse.end(body);
    return true;
  } catch {
    return false;
  }
}

export async function startCardGuildServer(options: StartServerOptions): Promise<RunningCardGuildServer> {
  const store = new SessionStore(options.context, options.sources);
  const persistence = options.persistence ?? createSqlitePersistence(MEMORY_DATABASE);
  const authTtlMs = options.authTtlMs ?? DEFAULT_AUTH_TTL_MS;
  const api = createHttpApi({
    store,
    auth: createAuthService(persistence, authTtlMs),
    campaigns: createCampaignService(persistence, store),
    cookie: options.cookie ?? { secure: false, ttlMs: authTtlMs },
  });
  // In-flight request handlers. `httpServer.close()` waits for sockets, not for the async
  // work a handler is still doing, and a Continue is a durable write — so the database
  // cannot close until these settle.
  const pendingRequests = new Set<Promise<void>>();
  let closing = false;
  const httpServer = createServer((request, response) => {
    if (closing) {
      response.writeHead(503, { "content-type": "application/json; charset=utf-8", connection: "close" });
      response.end(JSON.stringify({ code: "SERVER_CLOSING", message: "The server is shutting down." }));
      return;
    }
    const handled = (async () => {
      if (await api(request, response)) return;
      const pathname = new URL(request.url ?? "/", "http://cardguild.local").pathname;
      if (options.staticRoot && await serveStatic(options.staticRoot, pathname, response)) return;
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "NOT_FOUND", message: "Route was not found." }));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "SERVER_ERROR", message: "Internal server error." }));
    });
    pendingRequests.add(handled);
    void handled.finally(() => pendingRequests.delete(handled));
  });
  const gateway = attachWebSocketGateway(httpServer, store, {
    allowedOrigins: options.allowedOrigins,
    heartbeatMs: options.heartbeatMs,
    helloDeadlineMs: options.helloDeadlineMs,
    onInternalError: options.onInternalError ?? ((error: unknown) => {
      console.error("CardGuild session authority failed", error);
    }),
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind a TCP port.");
  let shutdown: Promise<void> | null = null;
  return {
    httpServer,
    store,
    origin: `http://${host}:${address.port}`,
    close: () => (shutdown ??= (async () => {
      // Refuse new work first, so nothing can join the set of things being waited on.
      closing = true;
      // Message handlers that were already read off a socket reach their SessionHost queue
      // here, which is what makes `drain()` below cover them.
      await gateway.close();
      const stopped = new Promise<void>((resolve, reject) => httpServer.close((error) => {
        // Already-stopped is the idempotent case, not a failure: the listener may have been
        // closed by an earlier attempt or by the runtime.
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (error && code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      }));
      // Keep-alive sockets with no request in flight would otherwise hold the listener open
      // for their whole idle timeout.
      httpServer.closeIdleConnections();
      await stopped;
      await Promise.allSettled([...pendingRequests]);
      // Every host queue is drained before the database closes, so a transition that already
      // told a client "committed" is never left half written.
      await store.drain();
      persistence.close();
    })()),
  };
}
