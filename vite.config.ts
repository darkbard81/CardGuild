import path from "node:path";

import { defineConfig, type Plugin } from "vite";

/**
 * A content pack is compiled once at module scope, so a hot update to one of its JSON files
 * leaves the already-compiled pack — and its fingerprint — in place. The page then greets
 * the co-op server with a stale ContentIdentity and the handshake fails with
 * CONTENT_MISMATCH. Content is not hot-swappable, so ask for a real reload instead.
 */
function reloadOnContentChange(): Plugin {
  const watched = ["content", "presentation"].map((directory) => path.resolve(directory) + path.sep);
  return {
    name: "cardguild:reload-on-content-change",
    apply: "serve",
    handleHotUpdate({ file, server }) {
      if (!watched.some((directory) => file.startsWith(directory))) return undefined;
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    },
  };
}

export default defineConfig({
  plugins: [reloadOnContentChange()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
});
