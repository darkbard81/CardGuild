import { assertScene } from "../scene/validation";
import { ScenePlayer } from "../scene/player";
import type { SceneAudioPort, SceneCatalog, SceneDefinition, SceneResult } from "../scene/types";

/** Modal DOM presenter. Destination navigation belongs entirely to the caller. */
export class SceneDialogueUi {
  private dialog: HTMLDialogElement | null = null;
  private player: ScenePlayer | null = null;
  private disposing = false;

  public open(scene: SceneDefinition, catalog: SceneCatalog, options: {
    title: string;
    finishLabel: string;
    onFinish: (result: SceneResult) => void;
    audio?: SceneAudioPort;
  }): void {
    this.close();
    assertScene(scene, catalog);
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.className = "ui-panel scene-dialogue";
    dialog.setAttribute("aria-label", options.title);
    // Repeat keydown and a second native double-click must not skip the new page.
    dialog.addEventListener("keydown", event => {
      if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
    });
    const player = new ScenePlayer(scene, (line, index, revision) => {
      dialog.replaceChildren();
      const body = document.createElement("div"); body.className = "scene-dialogue-body";
      const portrait = document.createElement("div"); portrait.className = "scene-face";
      const speaker = line.speakerId ? catalog.speakers[line.speakerId] : undefined;
      if (speaker) {
        const set = catalog.faceSets[speaker.faceSetId]!;
        const expression = line.expressionId ?? set.defaultExpression;
        const frame = set.frames[expression]!;
        portrait.style.aspectRatio = `${frame.width} / ${frame.height}`;
        portrait.dataset.expression = expression;
        portrait.setAttribute("role", "img");
        portrait.setAttribute("aria-label", `${speaker.name} · ${frame.label}`);
        portrait.style.backgroundImage = `url("${set.image}")`;
        portrait.style.backgroundSize = `${set.width / frame.width * 100}% ${set.height / frame.height * 100}%`;
        portrait.style.backgroundPosition = `${set.width === frame.width ? 0 : frame.x / (set.width - frame.width) * 100}% ${set.height === frame.height ? 0 : frame.y / (set.height - frame.height) * 100}%`;
      } else { portrait.hidden = true; body.classList.add("scene-dialogue-body--narration"); }
      const copy = document.createElement("div"); copy.className = "scene-dialogue-copy";
      const name = document.createElement("h2"); name.textContent = speaker?.name ?? options.title;
      const text = document.createElement("p"); text.className = "scene-dialogue-text"; text.textContent = line.text;
      text.tabIndex = -1;
      const position = document.createElement("p"); position.className = "scene-dialogue-position";
      position.textContent = `${index + 1} / ${scene.lines.length}`;
      copy.append(name, text, position); body.append(portrait, copy);
      const controls = document.createElement("div"); controls.className = "scene-dialogue-controls";
      const button = (label: string, action: () => void) => {
        const result = document.createElement("button"); result.type = "button"; result.className = "ui-button"; result.textContent = label;
        result.addEventListener("click", event => {
          const touch = event instanceof PointerEvent && event.pointerType === "touch";
          if ((!touch && event.detail > 1) || !result.isConnected) return;
          action();
        });
        return result;
      };
      const back = button("돌아가기", () => player.cancel());
      const skip = button("건너뛰기", () => player.skip());
      const next = button(index === scene.lines.length - 1 ? options.finishLabel : "다음", () => player.next(revision));
      next.className = "ui-button ui-button--primary";
      controls.append(back, skip, next); dialog.append(body, controls);
      // Focus the next action; text is announced once through its accessible description.
      text.id = "scene-dialogue-text";
      next.setAttribute("aria-describedby", text.id);
      if (dialog.open) next.focus();
    }, result => {
      this.player = null;
      dialog.close(); dialog.remove(); this.dialog = null;
      if (!this.disposing) options.onFinish(result);
    }, options.audio);
    this.player = player;
    dialog.addEventListener("cancel", event => { event.preventDefault(); player.cancel(); });
    document.body.append(dialog);
    player.start();
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>(".ui-button--primary")?.focus();
  }
  public close(): void {
    this.disposing = true;
    this.player?.cancel();
    this.disposing = false;
    this.dialog?.remove();
    this.dialog = null;
    this.player = null;
  }
}
