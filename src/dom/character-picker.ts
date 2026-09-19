import type { ActorState } from "../game";
import type { AssetCatalog } from "../presentation";

/** Shared bust portraits, using the same crop as the initiative strip. */
export function updateCharacterPicker(root: HTMLElement, actors: readonly Pick<ActorState, "id" | "name" | "definitionId">[], selected: string, catalog: AssetCatalog, choose: (id: string) => void, disabled = false): void {
  root.className = "ui-character-picker";
  root.setAttribute("role", "group"); root.setAttribute("aria-label", "상세 대상");
  const signature = actors.map(actor => `${actor.id}:${actor.definitionId}:${actor.name}`).join("|");
  if (root.dataset.actors !== signature) {
    root.replaceChildren(...actors.map(actor => {
      const button = document.createElement("button"); button.type = "button";
      button.className = "ui-button ui-character-picker__face"; button.dataset.actorId = actor.id;
      button.setAttribute("aria-label", `${actor.name} 상세`); button.title = actor.name;
      const face = document.createElement("span"); face.setAttribute("aria-hidden", "true");
      const visual = catalog.manifest.actorVisuals[actor.definitionId];
      if (visual) Object.assign(face.style, catalog.domPortraitStyle(visual.front, 36));
      else face.textContent = actor.name.slice(0, 1);
      button.append(face); button.addEventListener("click", () => choose(actor.id)); return button;
    }));
    root.dataset.actors = signature;
  }
  root.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
    button.disabled = disabled; button.setAttribute("aria-pressed", String(button.dataset.actorId === selected));
  });
}
