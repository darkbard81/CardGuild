import { Application } from "pixi.js";

import "./style.css";

function getRequiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required element was not found: ${selector}`);
  }

  return element;
}

async function bootstrap(): Promise<void> {
  const pixiRoot = getRequiredElement<HTMLDivElement>("#pixi-root");
  const pixiStatus = getRequiredElement<HTMLElement>("#pixi-status");
  const app = new Application();

  await app.init({
    resizeTo: pixiRoot,
    background: "#101722",
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    preference: "webgl",
  });

  app.canvas.id = "pixi-canvas";
  app.canvas.setAttribute("aria-label", "CardGuild battlefield renderer");
  pixiRoot.append(app.canvas);
  app.resize();

  pixiRoot.dataset.ready = "true";
  pixiStatus.textContent = "Ready";

  window.addEventListener(
    "beforeunload",
    () => {
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

  if (pixiStatus) {
    pixiStatus.textContent = "Failed to start";
  }

  console.error("CardGuild bootstrap failed", error);
});
