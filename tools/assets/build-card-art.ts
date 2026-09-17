import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { CARD_ART_PLAN_PATH, readCardArtPlan, sha256 } from "./card-art";

const root = process.cwd();
const plan = await readCardArtPlan(root);
const requested = process.argv.slice(2);
if (requested.length !== 1 || !requested[0]) throw new Error("Usage: npm run assets:cards -- <card.id|all>");
const selected = requested[0] === "all" ? plan.cards : plan.cards.filter((entry) => entry.cardId === requested[0]);
if (!selected.length) throw new Error(`Unknown commissioned card: ${requested[0]}`);

// Prepare every selected output before replacing any existing delivery file.
const outputs = await Promise.all(selected.map(async (entry) => {
  const source = await readFile(path.join(root, entry.source));
  const image = sharp(source, { failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || metadata.width !== plan.sourceSize.width || metadata.height !== plan.sourceSize.height ||
      (metadata.orientation !== undefined && metadata.orientation !== 1)) {
    throw new Error(`${entry.cardId}: expected unrotated 1024x1536 PNG; regenerate without cropping or stretching.`);
  }
  if (!(await image.stats()).isOpaque) throw new Error(`${entry.cardId}: source background must be opaque.`);
  const output = await image.resize(plan.outputSize.width, plan.outputSize.height, { kernel: plan.conversion.kernel })
    .webp({ quality: plan.conversion.quality, effort: plan.conversion.effort }).toBuffer();
  return { entry, source, output };
}));
for (const { entry, source, output } of outputs) {
  const destination = path.join(root, entry.output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(`${destination}.tmp`, output);
  await rename(`${destination}.tmp`, destination);
  entry.sourceSha256 = sha256(source);
  entry.outputSha256 = sha256(output);
  entry.generatedWith = "built-in image_gen via luna-gen";
  process.stdout.write(`${entry.cardId}: 1024x1536 -> 512x768 WebP (${output.length} bytes)\n`);
}
const planPath = path.join(root, CARD_ART_PLAN_PATH);
await writeFile(`${planPath}.tmp`, `${JSON.stringify(plan, null, 2)}\n`);
await rename(`${planPath}.tmp`, planPath);
