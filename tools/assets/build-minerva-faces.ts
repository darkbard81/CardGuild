import { mkdir } from "node:fs/promises";
import sharp from "sharp";

// One uniform sheet transform; individual portraits are never trimmed or recentered.
const { data, info } = await sharp("art/source/scenes/minerva.png").resize(2048, 2048).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const x = (i / 4 % info.width) % 512, y = Math.floor(i / 4 / info.width) % 512;
  // Remove interpolation across cell boundaries using the same two-pixel gutter everywhere.
  if (x < 2 || x >= 510 || y < 2 || y >= 510) {
    data.fill(0, i, i + 4);
    continue;
  }
  const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
  const magenta = r > g + 25 && b > g + 25;
  const blue = b > r + 25 && b > g + 25;
  if (!magenta && !blue) continue;
  const spill = magenta ? Math.min(r, b) - g : b - Math.max(r, g);
  const alpha = spill > 70 ? 0 : 1 - spill / 90;
  data[i + 3] = Math.round(alpha * 255);
  if (alpha === 0) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; continue; }
  data[i] = Math.max(0, Math.min(255, (r - (magenta ? spill : 0)) / alpha));
  data[i + 1] = Math.max(0, Math.min(255, g / alpha));
  data[i + 2] = Math.min(data[i]!, data[i + 1]!);
  if (magenta) data[i] = data[i + 1]!;
}
await mkdir("art/processed/scenes/minerva", { recursive: true });
const sheet = sharp(data, { raw: info });
await sheet.clone().png().toFile("art/processed/scenes/minerva.png");
await sheet.clone().webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile("public/assets/scenes/minerva.webp");
const ids = ["neutral", "welcome", "joy", "wink", "explain", "think", "question", "surprise", "worry", "sad", "cry", "flustered", "blush", "displeased", "firm", "cheer"];
for (const [i, id] of ids.entries()) {
  await sheet.clone().extract({ left: i % 4 * 512, top: Math.floor(i / 4) * 512, width: 512, height: 512 }).png().toFile(`art/processed/scenes/minerva/${id}.png`);
}
