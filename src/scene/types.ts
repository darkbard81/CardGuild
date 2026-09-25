/** Presentation-only contracts: no Actor, Class, campaign or save dependencies. */
export interface SceneAudioCue {
  readonly bgm?: string | null;
  readonly voice?: string;
  readonly sfx?: readonly string[];
}
export interface SceneAudioPort {
  apply(cue: SceneAudioCue): void;
  stop(): void;
}
export const silentSceneAudio: SceneAudioPort = { apply: () => {}, stop: () => {} };
export interface SceneLine {
  readonly text: string;
  readonly speakerId?: string;
  readonly expressionId?: string;
  readonly audio?: SceneAudioCue;
}
export interface SceneDefinition {
  readonly id: string;
  readonly lines: readonly SceneLine[];
}
export interface SceneSpeakerDefinition {
  readonly name: string;
  readonly faceSetId: string;
}
export interface FaceFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}
export interface SceneFaceSet {
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly defaultExpression: string;
  readonly frames: Readonly<Record<string, FaceFrame>>;
}
export interface SceneCatalog {
  readonly speakers: Readonly<Record<string, SceneSpeakerDefinition>>;
  readonly faceSets: Readonly<Record<string, SceneFaceSet>>;
}
export type SceneResult = "completed" | "skipped" | "cancelled";
