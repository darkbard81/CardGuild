import { readFile, stat } from "node:fs/promises";
import { createServer, type Server as HttpServer, type ServerResponse } from "node:http";
import path from "node:path";

import type { SessionAuthorityContext } from "../session";
import { createHttpApi } from "./http-api";
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
}

export interface RunningCardGuildServer {
  readonly httpServer: HttpServer;
  readonly store: SessionStore;
  readonly origin: string;
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
  const api = createHttpApi(store);
  const httpServer = createServer((request, response) => {
    void (async () => {
      if (await api(request, response)) return;
      const pathname = new URL(request.url ?? "/", "http://cardguild.local").pathname;
      if (options.staticRoot && await serveStatic(options.staticRoot, pathname, response)) return;
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "NOT_FOUND", message: "Route was not found." }));
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "SERVER_ERROR", message: "Internal server error." }));
    });
  });
  const gateway = attachWebSocketGateway(httpServer, store, {
    allowedOrigins: options.allowedOrigins,
    heartbeatMs: options.heartbeatMs,
    helloDeadlineMs: options.helloDeadlineMs,
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
  return {
    httpServer,
    store,
    origin: `http://${host}:${address.port}`,
    close: async () => {
      await gateway.close();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}
