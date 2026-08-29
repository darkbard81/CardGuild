import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

type AssetKind = "actor" | "terrain" | "object" | "ui";
type SourceMode = "terrain-block" | "terrain-overlay" | "grounded-object" | "directional-actor";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

interface FramePlan {
  readonly assetId: string;
  readonly direction?: string;
  readonly sourceIndex?: number;
  readonly flipX?: boolean;
  readonly kind: AssetKind;
  readonly anchor: Point;
  readonly displaySize: { readonly width?: number; readonly height?: number };
  readonly footprint?: Size;
}

interface SourcePlan {
  readonly input: string;
  readonly mode: SourceMode;
  readonly definitionId?: string;
  readonly grid: { readonly rows: number; readonly cols: number };
  readonly canvas: Size;
  readonly frames: readonly FramePlan[];
  readonly prompt: string;
}

interface GenerationPlan {
  readonly version: 1;
  readonly styleSheet: string;
  readonly promptConvention: string;
  readonly background: "#FF00FF";
  readonly atlas: {
    readonly size: number;
    readonly padding: number;
    readonly image: string;
    readonly data: string;
  };
  readonly sources: readonly SourcePlan[];
  readonly presentation: {
    readonly terrainVisuals: Readonly<Record<string, string>>;
    readonly objectVisuals: Readonly<Record<string, string>>;
  };
}

interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface CleanFrame {
  readonly plan: FramePlan;
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
  readonly box: PixelBox;
}

interface ProcessedAsset {
  readonly source: SourcePlan;
  readonly frame: FramePlan;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly sourceBox: PixelBox;
  readonly processingScale: number;
}

interface ScenarioTile {
  readonly id: string;
  readonly position: Point;
  readonly traits: readonly { readonly id: string }[];
}

interface ScenarioObject {
  readonly id: string;
  readonly position: Point;
  readonly traits: readonly { readonly id: string }[];
}

interface ScenarioSource {
  readonly id: string;
  readonly map: {
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly ScenarioTile[];
    readonly objects: readonly ScenarioObject[];
  };
}

const MAGENTA_CORE_DISTANCE = 105;
const MAGENTA_EDGE_DISTANCE = 190;
const ALPHA_VISIBLE_THRESHOLD = 8;

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
}

function assertUnitPoint(point: Point, label: string): void {
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new Error(`${label} must be within 0..1.`);
  }
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validatePlan(plan: GenerationPlan): void {
  if (plan.version !== 1) throw new Error("Generation plan version must be 1.");
  if (plan.background !== "#FF00FF") throw new Error("Generated sources must use the #FF00FF background contract.");
  if (!isPowerOfTwo(plan.atlas.size)) throw new Error("Atlas size must be a power of two.");
  if (plan.atlas.padding < 1 || plan.atlas.padding > 2) throw new Error("Atlas padding must be 1 or 2 pixels.");
  const ids = new Set<string>();
  for (const source of plan.sources) {
    assertPositiveInteger(source.grid.rows, `${source.input} rows`);
    assertPositiveInteger(source.grid.cols, `${source.input} cols`);
    if (source.frames.length !== source.grid.rows * source.grid.cols) {
      throw new Error(`${source.input} frame count does not match its grid.`);
    }
    if (!source.prompt.includes("art/STYLE.md")) throw new Error(`${source.input} prompt must reference art/STYLE.md.`);
    for (const frame of source.frames) {
      if (ids.has(frame.assetId)) throw new Error(`Duplicate asset ID ${frame.assetId}.`);
      ids.add(frame.assetId);
      assertUnitPoint(frame.anchor, `${frame.assetId} anchor`);
      if (frame.sourceIndex !== undefined && (!Number.isInteger(frame.sourceIndex) || frame.sourceIndex < 0 || frame.sourceIndex >= source.frames.length)) {
        throw new Error(`${frame.assetId} sourceIndex is outside its source grid.`);
      }
    }
    if (source.mode === "directional-actor") {
      const directions = source.frames.map((frame) => frame.direction);
      const expected = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];
      if (JSON.stringify(directions) !== JSON.stringify(expected)) {
        throw new Error(`${source.input} must contain the canonical eight-direction order.`);
      }
      if (!source.definitionId) throw new Error(`${source.input} is missing definitionId.`);
    }
  }
}

function colorDistanceFromMagenta(red: number, green: number, blue: number): number {
  return Math.hypot(red - 255, green, blue - 255);
}

function isMagentaBackgroundCandidate(red: number, green: number, blue: number): boolean {
  const magentaExcess = (red + blue) / 2 - green;
  const balancedMagenta = Math.abs(red - blue) < 70 && magentaExcess > 25;
  return colorDistanceFromMagenta(red, green, blue) < MAGENTA_EDGE_DISTANCE
    || balancedMagenta
    || (red > 100 && blue > 100 && green < 185 && magentaExcess > 38);
}

function cleanMagenta(pixels: Buffer, width: number, height: number): Buffer {
  const cleaned = Buffer.from(pixels);
  const count = width * height;
  const candidates = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  let queueStart = 0;
  let queueEnd = 0;

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const red = cleaned[offset] ?? 0;
    const green = cleaned[offset + 1] ?? 0;
    const blue = cleaned[offset + 2] ?? 0;
    if (colorDistanceFromMagenta(red, green, blue) < MAGENTA_CORE_DISTANCE) {
      cleaned[offset] = 0;
      cleaned[offset + 1] = 0;
      cleaned[offset + 2] = 0;
      cleaned[offset + 3] = 0;
    }
    if (isMagentaBackgroundCandidate(red, green, blue)) candidates[index] = 1;
  }

  const enqueue = (index: number): void => {
    if (visited[index] || !candidates[index]) return;
    visited[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    if (index === undefined) continue;
    const offset = index * 4;
    cleaned[offset] = 0;
    cleaned[offset + 1] = 0;
    cleaned[offset + 2] = 0;
    cleaned[offset + 3] = 0;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height) enqueue(nextY * width + nextX);
      }
    }
  }

  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = cleaned[offset + 3] ?? 0;
    if (alpha === 0) continue;
    const red = cleaned[offset] ?? 0;
    const green = cleaned[offset + 1] ?? 0;
    const blue = cleaned[offset + 2] ?? 0;
    const distance = colorDistanceFromMagenta(red, green, blue);
    if (distance >= MAGENTA_EDGE_DISTANCE) continue;
    const normalized = Math.max(0, Math.min(1, (distance - MAGENTA_CORE_DISTANCE) / (MAGENTA_EDGE_DISTANCE - MAGENTA_CORE_DISTANCE)));
    const nextAlpha = Math.min(alpha, Math.round(255 * normalized));
    cleaned[offset + 3] = nextAlpha;
    if (nextAlpha < 255 && nextAlpha > 0) {
      const fraction = nextAlpha / 255;
      cleaned[offset] = Math.max(0, Math.min(255, Math.round((red - 255 * (1 - fraction)) / fraction)));
      cleaned[offset + 1] = Math.max(0, Math.min(255, Math.round(green / fraction)));
      cleaned[offset + 2] = Math.max(0, Math.min(255, Math.round((blue - 255 * (1 - fraction)) / fraction)));
    }
  }
  return cleaned;
}

function visibleBox(pixels: Buffer, width: number, height: number): PixelBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3] ?? 0;
      if (alpha <= ALPHA_VISIBLE_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX || maxY < minY
    ? null
    : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function finalizeStraightAlpha(image: Buffer, size: Size): Promise<Buffer> {
  const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] ?? 0;
    if (alpha <= 18) {
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 0;
    }
  }
  return sharp(pixels, { raw: { width: size.width, height: size.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function extractCleanFrames(root: string, source: SourcePlan): Promise<readonly CleanFrame[]> {
  const input = path.join(root, source.input);
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${source.input} has no readable dimensions.`);
  const frames: CleanFrame[] = [];
  for (let row = 0; row < source.grid.rows; row += 1) {
    for (let col = 0; col < source.grid.cols; col += 1) {
      const index = row * source.grid.cols + col;
      const frame = source.frames[index];
      if (!frame) throw new Error(`${source.input} is missing frame ${index}.`);
      const left = Math.round(col * metadata.width / source.grid.cols);
      const top = Math.round(row * metadata.height / source.grid.rows);
      const right = Math.round((col + 1) * metadata.width / source.grid.cols);
      const bottom = Math.round((row + 1) * metadata.height / source.grid.rows);
      const width = right - left;
      const height = bottom - top;
      const raw = await sharp(input)
        .extract({ left, top, width, height })
        .ensureAlpha()
        .raw()
        .toBuffer();
      const pixels = cleanMagenta(raw, width, height);
      const box = visibleBox(pixels, width, height);
      if (!box) throw new Error(`${frame.assetId} became empty during background cleanup.`);
      frames.push({ plan: frame, pixels, width, height, box });
    }
  }
  return source.frames.map((plan, targetIndex) => {
    const sourceIndex = plan.sourceIndex ?? targetIndex;
    const frame = frames[sourceIndex];
    if (!frame) throw new Error(`${plan.assetId} references missing source cell ${sourceIndex}.`);
    return { ...frame, plan };
  });
}

function processedPath(root: string, source: SourcePlan, frame: FramePlan): string {
  if (frame.kind === "actor") {
    const actorSlug = source.definitionId?.split(".").slice(1).join("-");
    if (!actorSlug || !frame.direction) throw new Error(`${frame.assetId} has incomplete actor metadata.`);
    return path.join(root, "art", "processed", "actors", actorSlug, `${frame.direction}.png`);
  }
  if (frame.kind === "object") {
    return path.join(root, "art", "processed", "objects", `${frame.assetId.replace(/^object\./, "").replaceAll(".", "-")}.png`);
  }
  return path.join(root, "art", "processed", "terrain", `${frame.assetId.replace(/^(terrain|transition)\./, "").replaceAll(".", "-")}.png`);
}

function exactMask(mode: SourceMode, size: Size): Buffer | null {
  if (mode === "terrain-block") {
    const halfWidth = size.width / 2;
    const surfaceHeight = size.width / 2;
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><polygon points="${halfWidth},0 ${size.width},${surfaceHeight / 2} ${size.width},${size.height - surfaceHeight / 2} ${halfWidth},${size.height} 0,${size.height - surfaceHeight / 2} 0,${surfaceHeight / 2}" fill="white"/></svg>`,
    );
  }
  if (mode === "terrain-overlay") {
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><polygon points="${size.width / 2},0 ${size.width},${size.height / 2} ${size.width / 2},${size.height} 0,${size.height / 2}" fill="white"/></svg>`,
    );
  }
  return null;
}

async function processSource(root: string, source: SourcePlan): Promise<readonly ProcessedAsset[]> {
  const frames = await extractCleanFrames(root, source);
  const safeWidth = source.mode === "directional-actor" ? source.canvas.width * 0.84 : source.canvas.width * 0.86;
  const safeHeight = source.mode === "directional-actor" ? source.canvas.height * 0.82 : source.canvas.height * 0.86;
  const sharedScale = source.mode === "terrain-block"
    ? 1
    : Math.min(...frames.map((frame) => Math.min(safeWidth / frame.box.width, safeHeight / frame.box.height)));
  const outputs: ProcessedAsset[] = [];

  for (const frame of frames) {
    const cropPipeline = sharp(frame.pixels, { raw: { width: frame.width, height: frame.height, channels: 4 } })
      .extract(frame.box);
    if (frame.plan.flipX) cropPipeline.flop();
    const cropped = await cropPipeline.png().toBuffer();
    const mask = exactMask(source.mode, source.canvas);
    let result: Buffer;
    let processingScale = sharedScale;
    if (source.mode === "terrain-block") {
      result = await sharp(cropped)
        .resize(source.canvas.width, source.canvas.height, { fit: "fill" })
        .composite(mask ? [{ input: mask, blend: "dest-in" }] : [])
        .png({ compressionLevel: 9 })
        .toBuffer();
      processingScale = Math.min(source.canvas.width / frame.box.width, source.canvas.height / frame.box.height);
    } else {
      const scaledWidth = Math.max(1, Math.round(frame.box.width * sharedScale));
      const scaledHeight = Math.max(1, Math.round(frame.box.height * sharedScale));
      const scaled = await sharp(cropped)
        .resize(scaledWidth, scaledHeight, { fit: "fill" })
        .png()
        .toBuffer();
      const left = Math.round(frame.plan.anchor.x * source.canvas.width - scaledWidth / 2);
      const top = source.mode === "terrain-overlay"
        ? Math.round((source.canvas.height - scaledHeight) / 2)
        : Math.round(frame.plan.anchor.y * source.canvas.height - scaledHeight);
      if (left < 0 || top < 0 || left + scaledWidth > source.canvas.width || top + scaledHeight > source.canvas.height) {
        throw new Error(`${frame.plan.assetId} does not fit its normalized canvas.`);
      }
      const composites: OverlayOptions[] = [{ input: scaled, left, top }];
      if (mask) composites.push({ input: mask, blend: "dest-in" });
      result = await sharp({
        create: {
          width: source.canvas.width,
          height: source.canvas.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(composites)
        .png({ compressionLevel: 9 })
        .toBuffer();
    }

    result = await finalizeStraightAlpha(result, source.canvas);
    const output = processedPath(root, source, frame.plan);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, result);
    outputs.push({
      source,
      frame: frame.plan,
      file: output,
      width: source.canvas.width,
      height: source.canvas.height,
      sourceBox: frame.box,
      processingScale,
    });
    process.stdout.write(`Processed ${frame.plan.assetId} -> ${path.relative(root, output)}\n`);
  }
  return outputs;
}

function packFrames(assets: readonly ProcessedAsset[], size: number, padding: number): Readonly<Record<string, PixelBox>> {
  const sorted = [...assets].sort((left, right) => right.height - left.height || right.width - left.width || left.frame.assetId.localeCompare(right.frame.assetId));
  const frames: Record<string, PixelBox> = {};
  let x = padding;
  let y = padding;
  let shelfHeight = 0;
  for (const asset of sorted) {
    if (x + asset.width + padding > size) {
      x = padding;
      y += shelfHeight + padding * 2;
      shelfHeight = 0;
    }
    if (y + asset.height + padding > size) throw new Error(`Atlas ${size}x${size} is too small for ${asset.frame.assetId}.`);
    frames[asset.frame.assetId] = { left: x, top: y, width: asset.width, height: asset.height };
    x += asset.width + padding * 2;
    shelfHeight = Math.max(shelfHeight, asset.height);
  }
  return frames;
}

async function buildAtlas(root: string, plan: GenerationPlan, assets: readonly ProcessedAsset[]): Promise<void> {
  const packed = packFrames(assets, plan.atlas.size, plan.atlas.padding);
  const byId = new Map(assets.map((asset) => [asset.frame.assetId, asset]));
  const atlasImagePath = path.join(root, plan.atlas.image);
  const atlasDataPath = path.join(root, plan.atlas.data);
  await mkdir(path.dirname(atlasImagePath), { recursive: true });
  const composites = Object.entries(packed).map(([id, frame]) => {
    const asset = byId.get(id);
    if (!asset) throw new Error(`Packed frame ${id} has no processed source.`);
    return { input: asset.file, left: frame.left, top: frame.top };
  });
  await sharp({
    create: {
      width: plan.atlas.size,
      height: plan.atlas.size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ lossless: true, effort: 6 })
    .toFile(atlasImagePath);

  const frames = Object.fromEntries(Object.entries(packed).map(([id, frame]) => {
    const asset = byId.get(id);
    if (!asset) throw new Error(`Missing processed asset ${id}.`);
    return [id, {
      frame: { x: frame.left, y: frame.top, w: frame.width, h: frame.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height },
      sourceSize: { w: frame.width, h: frame.height },
      anchor: asset.frame.anchor,
    }];
  }));
  const atlasData = {
    frames,
    animations: {},
    meta: {
      app: "CardGuild asset pipeline",
      version: "1",
      image: path.basename(atlasImagePath),
      format: "RGBA8888",
      size: { w: plan.atlas.size, h: plan.atlas.size },
      scale: "1",
    },
  };
  await writeJson(atlasDataPath, atlasData);
  await writeJson(path.join(root, "presentation", "m2", "atlas-map.json"), atlasData);
  process.stdout.write(`Packed ${assets.length} sprites -> ${path.relative(root, atlasImagePath)}\n`);
}

async function buildManifest(root: string, plan: GenerationPlan, assets: readonly ProcessedAsset[]): Promise<void> {
  const definitions = Object.fromEntries(assets.map((asset) => [asset.frame.assetId, {
    frame: asset.frame.assetId,
    kind: asset.frame.kind,
    anchor: asset.frame.anchor,
    ...(asset.frame.displaySize.width === undefined ? {} : { displayWidth: asset.frame.displaySize.width }),
    ...(asset.frame.displaySize.height === undefined ? {} : { displayHeight: asset.frame.displaySize.height }),
    ...(asset.frame.footprint === undefined ? {} : { footprint: asset.frame.footprint }),
  }]));
  const actorVisuals: Record<string, Record<string, string>> = {};
  for (const source of plan.sources) {
    if (source.mode !== "directional-actor" || !source.definitionId) continue;
    actorVisuals[source.definitionId] = Object.fromEntries(source.frames.map((frame) => {
      if (!frame.direction) throw new Error(`${frame.assetId} is missing direction.`);
      return [frame.direction, frame.assetId];
    }));
  }
  const manifest = {
    version: 2,
    bundle: "m2-encounter",
    atlas: { path: "/assets/m2-atlas.json" },
    assets: definitions,
    actorVisuals,
    terrainVisuals: plan.presentation.terrainVisuals,
    objectVisuals: plan.presentation.objectVisuals,
  };
  const sourceMap = Object.fromEntries(assets.map((asset) => [asset.frame.assetId, path.relative(root, asset.file)]));
  await writeJson(path.join(root, "presentation", "m2", "asset-manifest.json"), manifest);
  await writeJson(path.join(root, "presentation", "m2", "asset-sources.json"), sourceMap);
}

function traitSet(tile: ScenarioTile): ReadonlySet<string> {
  return new Set(tile.traits.map((trait) => trait.id));
}

function semanticType(traits: ReadonlySet<string>): string {
  if (traits.has("gate") || traits.has("gate-open")) return "gate";
  if (traits.has("blocked")) return "blocked";
  if (traits.has("impassable")) return "impassable";
  if (traits.has("web")) return "web";
  if (traits.has("difficult")) return "difficult";
  return "open";
}

async function buildTilemaps(root: string): Promise<void> {
  const scenarios = await readJson<readonly ScenarioSource[]>(path.join(root, "content", "m2", "scenarios.json"));
  const groundPalette = ["terrain.stone-floor", "terrain.rubble", "terrain.chasm"];
  const transitionPalette = ["transition.web"];
  const objectPalette = ["object.wall", "object.gate.closed", "object.lever"];
  const maps: Record<string, unknown> = {};
  for (const scenario of scenarios) {
    const { width, height } = scenario.map;
    const length = width * height;
    const ground = new Array<number>(length).fill(-1);
    const transitions = new Array<number>(length).fill(-1);
    const objects = new Array<number>(length).fill(-1);
    const tileIds = new Array<string | null>(length).fill(null);
    const objectIds = new Array<string | null>(length).fill(null);
    const types = new Array<string>(length).fill("missing");
    const walkable = new Array<boolean>(length).fill(false);
    const costs = new Array<number | null>(length).fill(null);
    for (const tile of scenario.map.tiles) {
      const { x, y } = tile.position;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error(`${scenario.id} tile ${tile.id} is outside ${width}x${height}.`);
      }
      const index = y * width + x;
      if (tileIds[index] !== null) throw new Error(`${scenario.id} has duplicate tile position ${x},${y}.`);
      const traits = traitSet(tile);
      ground[index] = traits.has("impassable") ? 2 : traits.has("difficult") ? 1 : 0;
      if (traits.has("web")) transitions[index] = 0;
      if (traits.has("gate") || traits.has("gate-open")) objects[index] = 1;
      else if (traits.has("blocked")) objects[index] = 0;
      tileIds[index] = tile.id;
      objectIds[index] = (objects[index] ?? -1) >= 0 ? tile.id : null;
      types[index] = semanticType(traits);
      const isWalkable = !traits.has("blocked") && !traits.has("impassable") && !traits.has("gate");
      walkable[index] = isWalkable;
      costs[index] = isWalkable ? (traits.has("difficult") ? 2 : 1) : null;
    }
    for (const object of scenario.map.objects) {
      const index = object.position.y * width + object.position.x;
      if (index < 0 || index >= length) throw new Error(`${scenario.id} object ${object.id} is outside the map.`);
      if (object.traits.some((trait) => trait.id === "lever")) objects[index] = 2;
      objectIds[index] = object.id;
    }
    if (tileIds.some((id) => id === null)) throw new Error(`${scenario.id} does not define every tile.`);
    maps[scenario.id] = {
      width,
      height,
      palettes: { ground: groundPalette, transitions: transitionPalette, objects: objectPalette },
      layers: { ground, transitions, objects },
      meta: { tileIds, objectIds, type: types, walkable, cost: costs },
    };
  }
  await writeJson(path.join(root, "presentation", "m2", "tilemaps.json"), { version: 1, maps });
  process.stdout.write(`Built ${Object.keys(maps).length} layered tilemaps\n`);
}

async function writePipelineMetadata(root: string, plan: GenerationPlan, assets: readonly ProcessedAsset[]): Promise<void> {
  const metadata = {
    version: 1,
    styleSheet: plan.styleSheet,
    promptConvention: plan.promptConvention,
    backgroundCleanup: {
      method: "edge-connected chroma matte with soft defringe",
      coreDistance: MAGENTA_CORE_DISTANCE,
      edgeDistance: MAGENTA_EDGE_DISTANCE,
      outputAlpha: "straight",
    },
    atlas: { size: plan.atlas.size, padding: plan.atlas.padding },
    assets: Object.fromEntries(assets.map((asset) => [asset.frame.assetId, {
      source: asset.source.input,
      output: path.relative(root, asset.file),
      sourceBox: asset.sourceBox,
      sourceIndex: asset.frame.sourceIndex ?? asset.source.frames.indexOf(asset.frame),
      flipX: asset.frame.flipX ?? false,
      processingScale: Number(asset.processingScale.toFixed(6)),
      anchor: asset.frame.anchor,
    }])),
  };
  await writeJson(path.join(root, "art", "processed", "pipeline-meta.json"), metadata);
}

async function buildQcPreviews(root: string, assets: readonly ProcessedAsset[]): Promise<void> {
  const byId = new Map(assets.map((asset) => [asset.frame.assetId, asset]));
  const qcRoot = path.join(root, "art", "processed", "qc");
  await mkdir(qcRoot, { recursive: true });
  const previewIds = [
    "terrain.stone-floor",
    "terrain.rubble",
    "terrain.chasm",
    "transition.web",
    "object.wall",
    "object.gate.closed",
    "object.gate.open",
    "object.lever",
    "actor.hero.aerin.south",
    "actor.goblin-skirmisher.south",
    "actor.goblin-brute.south",
    "actor.goblin-chief.south",
  ];
  const cellWidth = 300;
  const cellHeight = 300;
  const composites: OverlayOptions[] = [];
  for (const [index, id] of previewIds.entries()) {
    const asset = byId.get(id);
    if (!asset) throw new Error(`QC preview is missing ${id}.`);
    const thumbnail = await sharp(asset.file)
      .resize(cellWidth - 32, cellHeight - 32, {
        fit: "contain",
        withoutEnlargement: false,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    const metadata = await sharp(thumbnail).metadata();
    if (!metadata.width || !metadata.height) throw new Error(`QC preview could not size ${id}.`);
    const column = index % 4;
    const row = Math.floor(index / 4);
    composites.push({
      input: thumbnail,
      left: column * cellWidth + Math.round((cellWidth - metadata.width) / 2),
      top: row * cellHeight + Math.round((cellHeight - metadata.height) / 2),
    });
  }
  for (const [name, background] of [
    ["alpha-light.png", { r: 242, g: 236, b: 221, alpha: 1 }],
    ["alpha-dark.png", { r: 17, g: 24, b: 32, alpha: 1 }],
  ] as const) {
    await sharp({
      create: { width: cellWidth * 4, height: cellHeight * 3, channels: 4, background },
    }).composite(composites).png({ compressionLevel: 9 }).toFile(path.join(qcRoot, name));
  }

  const terrainIds = [
    "terrain.stone-floor", "terrain.rubble", "terrain.stone-floor",
    "terrain.rubble", "terrain.chasm", "terrain.rubble",
    "terrain.stone-floor", "terrain.rubble", "terrain.stone-floor",
  ];
  const terrainComposites: OverlayOptions[] = [];
  const positions = terrainIds.map((id, index) => ({ id, x: index % 3, y: Math.floor(index / 3) }))
    .sort((left, right) => left.x + left.y - (right.x + right.y) || left.y - right.y || left.x - right.x);
  for (const position of positions) {
    const asset = byId.get(position.id);
    if (!asset) throw new Error(`Terrain QC preview is missing ${position.id}.`);
    const centerX = 256 + (position.x - position.y) * 64;
    const centerY = 48 + (position.x + position.y) * 32;
    terrainComposites.push({ input: asset.file, left: centerX - 64, top: centerY - 32 });
  }
  await sharp({
    create: { width: 512, height: 320, channels: 4, background: { r: 17, g: 24, b: 32, alpha: 1 } },
  }).composite(terrainComposites).png({ compressionLevel: 9 }).toFile(path.join(qcRoot, "terrain-grid.png"));

  const actorSources = [...new Map(
    assets
      .filter((asset) => asset.source.mode === "directional-actor")
      .map((asset) => [asset.source.input, asset.source]),
  ).values()];
  for (const source of actorSources) {
    const directionComposites: OverlayOptions[] = source.frames.map((frame, index) => {
      const asset = byId.get(frame.assetId);
      if (!asset) throw new Error(`Direction QC preview is missing ${frame.assetId}.`);
      return {
        input: asset.file,
        left: (index % source.grid.cols) * source.canvas.width,
        top: Math.floor(index / source.grid.cols) * source.canvas.height,
      };
    });
    const actorSlug = source.definitionId?.split(".").slice(1).join("-");
    if (!actorSlug) throw new Error(`${source.input} is missing an actor slug.`);
    await sharp({
      create: {
        width: source.grid.cols * source.canvas.width,
        height: source.grid.rows * source.canvas.height,
        channels: 4,
        background: { r: 17, g: 24, b: 32, alpha: 1 },
      },
    }).composite(directionComposites).png({ compressionLevel: 9 }).toFile(path.join(qcRoot, `${actorSlug}-directions.png`));
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const planPath = path.join(root, "art", "source", "generation-plan.json");
  const plan = await readJson<GenerationPlan>(planPath);
  validatePlan(plan);
  await access(path.join(root, plan.styleSheet));
  await access(path.join(root, plan.promptConvention));
  const groups = await Promise.all(plan.sources.map((source) => processSource(root, source)));
  const assets = groups.flat();
  await buildAtlas(root, plan, assets);
  await buildManifest(root, plan, assets);
  await buildTilemaps(root);
  await writePipelineMetadata(root, plan, assets);
  await buildQcPreviews(root, assets);
  process.stdout.write(`Assets built: ${assets.length} frames from ${plan.sources.length} generated sources\n`);
}

await main();
