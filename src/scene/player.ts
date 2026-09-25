import { silentSceneAudio, type SceneAudioPort, type SceneDefinition, type SceneLine, type SceneResult } from "./types";

/** A revision identifies a displayed page, so stale input can never advance its successor. */
export class ScenePlayer {
  private index = -1;
  private finished = false;
  private revision = 0;
  public constructor(
    private readonly scene: SceneDefinition,
    private readonly onLine: (line: SceneLine, index: number, revision: number) => void,
    private readonly onFinish: (result: SceneResult) => void,
    private readonly audio: SceneAudioPort = silentSceneAudio,
  ) {
    if (!scene.lines.length) throw new Error(`Scene ${scene.id} has no lines`);
  }
  public start(): void {
    if (this.index !== -1 || this.finished) return;
    this.show(0);
  }
  public next(revision: number): void {
    if (this.finished || this.index < 0 || revision !== this.revision) return;
    if (this.index + 1 === this.scene.lines.length) this.finish("completed");
    else this.show(this.index + 1);
  }
  public skip(): void { this.finish("skipped"); }
  public cancel(): void { this.finish("cancelled"); }
  private show(index: number): void {
    this.index = index;
    this.revision++;
    const line = this.scene.lines[index]!;
    // Optional audio failures must not prevent reading or closing a scene.
    try { if (line.audio) this.audio.apply(line.audio); } catch { /* visual playback remains available */ }
    this.onLine(line, index, this.revision);
  }
  private finish(result: SceneResult): void {
    if (this.finished || this.index < 0) return;
    this.finished = true;
    try { this.audio.stop(); } catch { /* completion is independent of audio */ }
    this.onFinish(result);
  }
}
