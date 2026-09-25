import type { SceneCatalog, SceneDefinition } from "./types";

export function assertScene(scene: SceneDefinition, catalog: SceneCatalog): void {
  if (!scene.id || !scene.lines.length) throw new Error("Scene needs an ID and lines");
  for (const line of scene.lines) {
    if (!line.text.trim()) throw new Error(`${scene.id}: empty dialogue`);
    if (!line.speakerId) {
      if (line.expressionId) throw new Error(`${scene.id}: expression without speaker`);
      continue;
    }
    const speaker = catalog.speakers[line.speakerId];
    const faces = speaker && catalog.faceSets[speaker.faceSetId];
    if (!faces?.frames[line.expressionId ?? faces.defaultExpression]) throw new Error(`${scene.id}: unknown speaker or expression`);
  }
}
