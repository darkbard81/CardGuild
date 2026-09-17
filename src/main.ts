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
  app.canvas.setAttribute("aria-label", "CardGuild top-down tactical battle board");
  pixiRoot.append(app.canvas);
  app.resize();
  const catalog = createPresentationCatalog();
  const controller = new AdventureController(app, catalog, required<HTMLElement>("#app"));

  pixiStatus.textContent = "2.5D board ready";

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
  if (pixiStatus) pixiStatus.textContent = "Failed to start";
  const failure = document.createElement("section");
  failure.className = "ui-panel ui-panel--dialog ui-startup-failure";
  failure.setAttribute("role", "alert");
  const title = document.createElement("h1"); title.textContent = "게임을 시작하지 못했습니다";
  const detail = document.createElement("p"); detail.textContent = "화면 초기화에 실패했습니다. 다시 시도해 주세요. 문제가 계속되면 브라우저의 그래픽 가속 설정을 확인하세요.";
  const retry = document.createElement("button"); retry.type = "button";
  retry.className = "ui-button ui-button--primary"; retry.textContent = "다시 시도";
  retry.addEventListener("click", () => window.location.reload());
  failure.append(title, detail, retry);
  document.querySelector("#app")?.replaceChildren(failure);
  retry.focus();
  console.error("CardGuild bootstrap failed", error);
});
