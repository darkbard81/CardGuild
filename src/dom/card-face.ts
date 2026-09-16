import type { ActionTiming } from "../game/types";
import type { AssetCatalog } from "../presentation";

const imageLoads = new Map<string, Promise<boolean>>();

function loadCardImage(url: string): Promise<boolean> {
  let pending = imageLoads.get(url);
  if (!pending) {
    pending = new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => { resolve(true); };
      image.onerror = () => { resolve(false); };
      image.src = url;
    });
    imageLoads.set(url, pending);
  }
  return pending;
}

export function formatActionCost(timing: ActionTiming): string {
  return timing.kind === "reaction" ? "↻" : "●".repeat(timing.actions);
}

export interface CardFaceOptions {
  readonly catalog?: AssetCatalog | null;
  readonly cardId?: string;
  readonly name: string;
  readonly timing?: ActionTiming;
  readonly badges?: readonly string[];
}

/** Decoration only: the owning screen keeps its button, gestures and rule decisions. */
export function createCardFace(options: CardFaceOptions): HTMLSpanElement {
  const face = document.createElement("span");
  face.className = "card-face";
  const art = document.createElement("span");
  art.className = "card-face-art";
  art.setAttribute("aria-hidden", "true");
  const assetId = options.cardId ? options.catalog?.cardVisual(options.cardId) : null;
  if (assetId && options.catalog) {
    const source = options.catalog.asset(assetId).source;
    face.dataset.artStorage = source.type;
    if (source.type === "image") {
      Object.assign(art.style, { backgroundImage: `url("${source.path}")`, backgroundSize: "contain", backgroundPosition: "center" });
      face.dataset.imageState = "loading";
      void loadCardImage(source.path).then((loaded) => { face.dataset.imageState = loaded ? "ready" : "error"; });
    } else {
      art.classList.add("card-face-art-legacy");
      Object.assign(art.style, options.catalog.domFillStyle(assetId));
    }
  } else {
    face.dataset.artStorage = "missing";
    art.textContent = options.name === "Empty" ? "+" : options.name.slice(0, 1);
  }
  const title = document.createElement("strong");
  title.className = "card-face-name";
  title.textContent = options.name;
  face.append(art, title);
  if (options.timing) {
    const cost = document.createElement("span");
    cost.className = "card-face-cost cost-badge";
    cost.textContent = formatActionCost(options.timing);
    cost.setAttribute("role", "img");
    cost.setAttribute("aria-label", options.timing.kind === "reaction" ? "Reaction" : `${options.timing.actions} actions`);
    face.append(cost);
  }
  if (options.badges?.length) {
    const badges = document.createElement("span");
    badges.className = "card-face-badges";
    for (const text of options.badges) {
      const badge = document.createElement("span");
      badge.textContent = text;
      badges.append(badge);
    }
    face.append(badges);
  }
  return face;
}
