import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { assertScene } from "../../src/scene/validation";
import sharp from "sharp";
import { FLANKING_TRAINING_SCENE, PRONE_RECOVERY_SCENE, FIRST_BATTLE_SCENE, SCENE_CATALOG, WELCOME_SCENE } from "../../src/scene/catalog";

export async function checkSceneAssets(): Promise<void> {
  for (const scenario of Object.values(PRODUCTION_CONTENT.pack.scenarios)) {
    const sceneId = scenario.rules?.opening?.sceneId;
    if (sceneId && sceneId !== PRONE_RECOVERY_SCENE.id) throw new Error(`${scenario.id}: unknown opening scene ${sceneId}`);
  }
  assertScene(FLANKING_TRAINING_SCENE, SCENE_CATALOG);
  assertScene(WELCOME_SCENE, SCENE_CATALOG);
  assertScene(FIRST_BATTLE_SCENE, SCENE_CATALOG);
  assertScene(PRONE_RECOVERY_SCENE, SCENE_CATALOG);
  for (const [id, set] of Object.entries(SCENE_CATALOG.faceSets)) {
    const file = `public${set.image}`;
    const meta = await sharp(file).metadata();
    if (meta.format !== "webp" || meta.width !== set.width || meta.height !== set.height || !meta.hasAlpha) throw new Error(`${id}: incorrect face sheet dimensions or alpha`);
    const processed = `art/processed/scenes/${id}.png`;
    const png = await sharp(processed).metadata();
    if (png.format !== "png" || png.width !== set.width || png.height !== set.height || !png.hasAlpha) throw new Error(`${id}: incorrect processed PNG`);
    const frames = Object.entries(set.frames);
    if (id === "minerva" && frames.length !== 16) throw new Error("Minerva needs sixteen expressions");
    const occupied = new Set<string>();
    for (const [expression, frame] of frames) {
      const { x, y, width, height } = frame;
      if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > set.width || y + height > set.height) throw new Error(`${id}/${expression}: frame outside sheet`);
      if (id === "minerva" && (width !== 512 || height !== 512 || x % 512 || y % 512)) throw new Error("Minerva frames must retain the fixed 512px grid");
      if (occupied.has(`${x},${y}`)) throw new Error(`${id}: duplicate face frame`);
      occupied.add(`${x},${y}`);
      const data = await sharp(file).extract({ left: x, top: y, width, height }).ensureAlpha().raw().toBuffer();
      let empty = 0, visible = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
        if (a === 0) empty++; else visible++;
        if (a > 30 && ((b > r + 70 && b > g + 70) || (Math.min(r, b) > g + 70))) throw new Error(`${id}/${expression}: chroma background remains`);
      }
      if (empty < width * height * .1 || visible < width * height * .2) throw new Error(`${id}/${expression}: empty or opaque face frame`);
    }
  }
  process.stdout.write("Scene faces OK: Minerva 16 expressions, alpha, fixed frames and dialogue references\n");
}
