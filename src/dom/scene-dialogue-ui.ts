import { assertScene } from "../scene/validation";
import { ScenePlayer } from "../scene/player";
import type { SceneAudioPort, SceneCatalog, SceneDefinition, SceneResult } from "../scene/types";

/** A viewport-wide input layer with an independent, translucent bottom dialogue panel. */
export class SceneDialogueUi {
  private dialog: HTMLDialogElement | null = null;
  private player: ScenePlayer | null = null;
  private disposing = false;
  private completionRetry: (() => void) | null = null;
  private finishing = false;

  public open(scene: SceneDefinition, catalog: SceneCatalog, options: {
    title: string;
    finishLabel: string;
    onFinish: (result: SceneResult) => void;
    audio?: SceneAudioPort;
    holdOnFinish?: boolean;
  }): void {
    this.close();
    assertScene(scene, catalog);
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.className = "scene-dialogue";
    dialog.tabIndex = 0;
    dialog.setAttribute("aria-label", options.title);
    dialog.setAttribute("aria-describedby", "scene-dialogue-text scene-dialogue-hint");
    let revision = 0;
    let press: { id: number; revision: number; x: number; y: number } | null = null;
    let releasedRevision: number | null = null;
    const pointers = new Set<number>();
    let multiple = false;
    // A press belongs to the page where it started. Drags and multi-touch are inert.
    dialog.addEventListener("pointerdown", event => {
      event.stopPropagation();
      pointers.add(event.pointerId);
      multiple ||= pointers.size > 1;
      releasedRevision = null;
      if (pointers.size === 1 && event.button === 0) {
        press = { id: event.pointerId, revision, x: event.clientX, y: event.clientY };
      }
    });
    dialog.addEventListener("pointermove", event => {
      event.stopPropagation();
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) press = null;
    });
    dialog.addEventListener("pointerup", event => {
      event.stopPropagation();
      if (!multiple && press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 12) {
        releasedRevision = press.revision;
      }
      pointers.delete(event.pointerId);
      if (!pointers.size) { multiple = false; press = null; }
    });
    dialog.addEventListener("pointercancel", event => {
      event.stopPropagation();
      pointers.delete(event.pointerId); press = null; releasedRevision = null;
      if (!pointers.size) multiple = false;
    });
    dialog.addEventListener("click", event => {
      event.stopPropagation();
      if ((event.target as Element).closest("button")) return;
      const touch = event instanceof PointerEvent && event.pointerType === "touch";
      if ((!touch && event.detail > 1) || releasedRevision === null) return;
      event.preventDefault();
      const token = releasedRevision; releasedRevision = null;
      if (this.finishing) this.completionRetry?.();
      else player.next(token);
    });
    dialog.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.repeat) { event.preventDefault(); return; }
      if ((event.target as Element).closest("button")) return;
      event.preventDefault();
      if (this.finishing) this.completionRetry?.();
      else player.next(revision);
    });
    const player = new ScenePlayer(scene, (line, index, token) => {
      revision = token;
      const panel = document.createElement("section"); panel.className = "ui-panel scene-dialogue-panel";
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
      const heading = document.createElement("div"); heading.className = "scene-dialogue-heading";
      const name = document.createElement("h2"); name.textContent = speaker?.name ?? options.title;
      const text = document.createElement("p"); text.className = "scene-dialogue-text"; text.textContent = line.text;
      text.id = "scene-dialogue-text";
      const position = document.createElement("span"); position.className = "scene-dialogue-position";
      position.textContent = `${index + 1} / ${scene.lines.length}`;
      heading.append(name, position);
      const controls = document.createElement("div"); controls.className = "scene-dialogue-controls";
      const hint = document.createElement("span"); hint.id = "scene-dialogue-hint";
      hint.textContent = index === scene.lines.length - 1
        ? `화면 클릭·터치 또는 Enter / Space · ${options.finishLabel}`
        : "화면 어디든 클릭·터치 또는 Enter / Space로 계속";
      const skip = document.createElement("button"); skip.type = "button"; skip.className = "ui-button"; skip.textContent = "건너뛰기";
      skip.addEventListener("click", event => {
        event.stopPropagation();
        if (skip.isConnected) player.skip();
      });
      controls.append(hint, skip);
      copy.append(heading, text, controls); body.append(portrait, copy); panel.append(body);
      dialog.replaceChildren(panel);
      if (dialog.open) dialog.focus({ preventScroll: true });
    }, result => {
      this.player = null;
      this.finishing = true;
      if (!options.holdOnFinish) { dialog.close(); dialog.remove(); this.dialog = null; }
      if (!this.disposing) options.onFinish(result);
    }, options.audio);
    this.player = player;
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      if (this.finishing) this.completionRetry?.(); else player.cancel();
    });
    document.body.append(dialog);
    player.start();
    dialog.showModal();
    dialog.focus({ preventScroll: true });
  }
  public showCompletion(message: string, retry?: () => void): void {
    this.completionRetry = retry ?? null;
    const text = this.dialog?.querySelector(".scene-dialogue-text");
    if (text) { text.textContent = message; text.setAttribute("role", "status"); }
    const controls = this.dialog?.querySelector<HTMLElement>(".scene-dialogue-controls");
    if (controls) controls.hidden = true;
    this.dialog?.focus({ preventScroll: true });
  }
  public close(): void {
    this.disposing = true;
    this.player?.cancel();
    this.disposing = false;
    this.dialog?.remove();
    this.dialog = null;
    this.player = null;
    this.finishing = false;
    this.completionRetry = null;
  }
}
