import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const CARD_ART_PLAN_PATH = "art/source/card-art-plan.json";

export interface CardArtEntry {
  cardId: string;
  assetId: string;
  classTheme: string;
  source: string;
  output: string;
  prompt: string;
  sourceSha256?: string;
  outputSha256?: string;
  generatedWith?: string;
}

export interface CardArtPlan {
  version: 1;
  sourceSize: { width: number; height: number };
  outputSize: { width: number; height: number };
  conversion: { kernel: "lanczos3"; quality: number; effort: number };
  cards: CardArtEntry[];
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function cardArtHref(entry: CardArtEntry): string {
  return `/${entry.output.slice("public/".length)}`;
}

export async function readCardArtPlan(root: string): Promise<CardArtPlan> {
  const plan = JSON.parse(await readFile(path.join(root, CARD_ART_PLAN_PATH), "utf8")) as CardArtPlan;
  if (plan.version !== 1 || plan.sourceSize.width !== 1024 || plan.sourceSize.height !== 1536 ||
      plan.outputSize.width !== 512 || plan.outputSize.height !== 768 ||
      plan.conversion.kernel !== "lanczos3" || plan.conversion.quality !== 85 || plan.conversion.effort !== 6) {
    throw new Error("Card art must use 1024x1536 PNG -> 512x768 WebP, Lanczos3, quality 85, effort 6.");
  }
  const ids = new Set<string>();
  for (const entry of plan.cards) {
    const slug = entry.cardId.replace(/^card\./, "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || entry.cardId !== `card.${slug}` ||
        entry.assetId !== `ui.card.${slug}` || entry.source !== `art/local/cards/${slug}.png` ||
        entry.output !== `public/assets/cards/${slug}.webp` || ids.has(entry.cardId)) {
      throw new Error(`Invalid or duplicate card art identity/path: ${entry.cardId}`);
    }
    for (const phrase of ["2:3 ratio", "2D hyper Detailed Chibi Anime Style", "Chibi Elf Woman has Massive bust", "no text", "no frame"]) {
      if (!entry.prompt.includes(phrase)) throw new Error(`${entry.cardId} prompt is missing: ${phrase}`);
    }
    ids.add(entry.cardId);
  }
  return plan;
}

/** Checks only tracked delivery files; local originals are authoring inputs, never a build dependency. */
export async function assertCardArtOutput(root: string, entry: CardArtEntry): Promise<void> {
  const bytes = await readFile(path.join(root, entry.output));
  const image = sharp(bytes, { failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "webp" || metadata.width !== 512 || metadata.height !== 768) {
    throw new Error(`${entry.cardId} must be a readable 512x768 WebP.`);
  }
  const stats = await image.stats();
  if (!stats.isOpaque) throw new Error(`${entry.cardId} must have an opaque full-bleed background.`);
  if (!entry.sourceSha256 || !/^[a-f0-9]{64}$/.test(entry.sourceSha256) || sha256(bytes) !== entry.outputSha256) {
    throw new Error(`${entry.cardId} is missing provenance or its output hash does not match. Run assets:cards.`);
  }
}
