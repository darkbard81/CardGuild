import { Application } from "pixi.js";

import { AdventureController } from "./app/adventure-controller";
import { createPresentationCatalog } from "./presentation";
import "./style.css";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element was not found: ${selector}`);
  return element;
}

async function bootstrap(): Promise<void> {
  const pixiRoot = required<HTMLDivElement>("#pixi-root");
  const pixiStatus = required<HTMLElement>("#pixi-status");
  const app = new Application();

  await app.init({
    resizeTo: pixiRoot,
    background: "#111820",
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    preference: "webgl",
    eventFeatures: {
      click: true,
      move: true,
      globalMove: false,
      wheel: false,
    },
  });

  app.canvas.id = "pixi-canvas";
  app.canvas.setAttribute("aria-label", "CardGuild M2 isometric tactical battle board");
  pixiRoot.append(app.canvas);
  app.resize();
  const catalog = createPresentationCatalog();
  const controller = new AdventureController(app, catalog, required<HTMLElement>("#app"));

  pixiRoot.dataset.ready = "true";
  pixiStatus.textContent = "Isometric presentation ready";

  window.addEventListener(
    "beforeunload",
    () => {
      controller.destroy();
      void catalog.unload();
      app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true },
      );
    },
    { once: true },
  );
}

void bootstrap().catch((error: unknown) => {
  const pixiStatus = document.querySelector<HTMLElement>("#pixi-status");
  const app = document.querySelector<HTMLElement>("#app");
  if (pixiStatus) pixiStatus.textContent = "Failed to start";
  if (app) app.dataset.ready = "error";
  console.error("CardGuild bootstrap failed", error);
});
