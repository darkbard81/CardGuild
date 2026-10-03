import { expect, test } from "@playwright/test";
import sharp from "sharp";

type Mode = "off" | "small" | "alpha-hidden" | "overlap" | "layers" | "hidden" | "move" | "camera" | "anchor" | "flip" | "behind";
for (const renderer of ["canvas"] as const) test(`U-STANDEE ${renderer}: full padded rectangle, union, foreground-only, hidden actors, motion and camera`, async ({ playwright }, info) => {
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/terrain-preview.html");
    await expect(page.locator("#status")).toHaveAttribute("data-revision", "1");
    const actual = await page.evaluate(async selectedRenderer => {
      const url = performance.getEntriesByType("resource").find(entry => entry.name.includes("/pixi__js.js"))!.name;
      const { Application, Container, RenderLayer, Sprite, Texture, RendererType } = await import(/* @vite-ignore */ url);
      const modulePath: string = "/src/pixi/battle/TerrainOcclusion.ts";
      const { TerrainOcclusion } = await import(/* @vite-ignore */ modulePath);
      const root = document.createElement("div"); root.style.cssText = "width:400px;height:300px";
      document.body.replaceChildren(root); document.body.style.cssText = "margin:0;display:block";
      const app = new Application(); await app.init({ resizeTo: root, preference: selectedRenderer, background: "#000000", autoDensity: true, resolution: 2 }); root.append(app.canvas);
      const world = new Container(); const layer = new RenderLayer({ sortableChildren: true, sortFunction: (a: { zIndex: number; label: string }, b: { zIndex: number; label: string }) => a.zIndex - b.zIndex || a.label.localeCompare(b.label) });
      app.stage.addChild(world, layer);
      const solid = (color: string, width: number, height: number) => {
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, width, height); return Texture.from(canvas);
      };
      const terrain = (color: string, x: number, y: number, width: number, height: number, zIndex: number, label: string) => {
        const display = new Container({ label }); display.zIndex = zIndex;
        const surface = new Sprite(solid(color, width, height)); surface.position.set(x, y); display.addChild(surface); world.addChild(display); layer.attach(display);
        return { display, surface };
      };
      const back = terrain("#00ff00", 0, 0, 400, 300, -10, "background");
      const front = terrain("#0000ff", 100, 40, 200, 200, 20, "foreground");
      const upper = terrain("#ffff00", 150, 80, 130, 100, 30, "upper"); upper.display.visible = false;
      const canvas = document.createElement("canvas"); canvas.width = 100; canvas.height = 120;
      const context = canvas.getContext("2d")!; context.fillStyle = "#ff0000"; context.fillRect(30, 20, 40, 80);
      const texture = Texture.from(canvas);
      const actor = (x: number, label: string) => {
        const display = new Container({ label }); display.position.set(x, 180); display.zIndex = 10;
        const body = new Sprite(texture); body.anchor.set(0.5, 1); display.addChild(body); world.addChild(display); layer.attach(display);
        return { display, body };
      };
      const first = actor(160, "first"), second = actor(170, "second");
      const occlusion = new TerrainOcclusion();
      const update = () => { occlusion.update([back, front, upper], [first, second]); layer.sortRenderLayerChildren(); app.render(); };
      const state = { mode: (mode: string) => {
        first.display.visible = true; second.display.visible = true; first.body.alpha = 1; second.display.alpha = 1; first.display.position.set(160, 180); second.display.position.set(170, 180);
        first.body.anchor.set(0.5, 1); first.body.scale.set(1); second.body.anchor.set(0.5, 1); second.body.scale.set(1);
        world.position.set(0); world.scale.set(1); front.display.zIndex = 20; upper.display.visible = mode === "layers";
        if (mode === "hidden") { first.display.visible = false; second.display.renderable = false; } else second.display.renderable = true;
        if (mode === "alpha-hidden") { first.body.alpha = 0; second.display.alpha = 0; }
        if (mode === "small") { first.body.scale.set(0.5); second.display.visible = false; }
        if (mode === "move") { first.display.x = 300; second.display.x = 310; }
        if (mode === "camera") { world.position.set(50, 20); world.scale.set(1.2); }
        if (mode === "anchor" || mode === "flip") { first.body.anchor.x = 0.2; second.display.visible = false; }
        if (mode === "flip") first.body.scale.x = -1;
        if (mode === "behind") front.display.zIndex = 0;
        if (mode === "off") { occlusion.clear(); app.render(); } else update();
      } };
      (window as unknown as { occlusionFixture: typeof state }).occlusionFixture = state;
      update(); return app.renderer.type === RendererType.WEBGL ? "webgl" : app.renderer.type === RendererType.CANVAS ? "canvas" : "webgpu";
    }, renderer);
    expect(actual).toBe(renderer);
    const mode = async (value: Mode) => page.evaluate(value => (window as unknown as { occlusionFixture: { mode(value: string): void } }).occlusionFixture.mode(value), value);
    const pixel = async (x: number, y: number) => { const { data, info } = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true }); const offset = (Math.floor(y * 2) * info.width + Math.floor(x * 2)) * 3; return [...data.subarray(offset, offset + 3)]; };
    const near = async (x: number, y: number, expected: number[]) => { const actual = await pixel(x, y); actual.forEach((value, i) => expect(Math.abs(value - expected[i]!)).toBeLessThanOrEqual(3)); };
    await near(145, 120, [217, 0, 38]); // Two actor rectangles overlap, opacity applies once.
    await near(115, 70, [0, 217, 38]); // Transparent standee padding still cuts terrain.
    await near(105, 70, [0, 0, 255]); // Just outside the rectangle remains opaque.
    await page.screenshot({ path: info.outputPath(`standee-${renderer}.png`) });
    await mode("off"); await near(145, 120, [0, 0, 255]);
    await mode("overlap"); await near(145, 120, [217, 0, 38]);
    await mode("small"); await near(115, 70, [0, 0, 255]); await near(155, 140, [217, 0, 38]);
    await mode("alpha-hidden"); await near(145, 120, [0, 0, 255]);
    await mode("layers"); await near(165, 120, [223, 38, 32]);
    await mode("hidden"); await near(145, 120, [0, 0, 255]);
    await mode("move"); await near(145, 120, [0, 0, 255]); await near(285, 120, [217, 0, 38]);
    await mode("camera"); await near(224, 164, [217, 0, 38]); await near(176, 104, [0, 0, 255]);
    await mode("anchor"); await near(115, 70, [0, 0, 255]); await near(145, 70, [0, 217, 38]);
    await mode("flip"); await near(115, 70, [0, 217, 38]);
    await mode("behind"); await near(145, 120, [255, 0, 0]); await near(115, 70, [0, 0, 255]);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
});

test("U-STANDEE production standees and composed columns restore identical ON/OFF pixels across facing and flat-map rebuilds", async ({ page }, info) => {
  info.annotations.push({ type: "fixture", description: "seed 60; local preview revisions 1–7; no server request" });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/terrain-preview.html?renderer=canvas");
  await expect(page.locator("#status")).toHaveAttribute("data-revision", "1");
  await expect(page.locator("#renderer")).toContainText("Canvas");
  const toggle = page.getByRole("checkbox", { name: "캐릭터 앞 지형 투명화" });
  const board = page.locator("#board");
  const pixels = async () => sharp(await board.screenshot()).removeAlpha().raw().toBuffer();
  const changed = (a: Buffer, b: Buffer) => {
    expect(a.length).toBe(b.length);
    let count = 0;
    for (let i = 0; i < a.length; i += 3) if (Math.max(...[0, 1, 2].map(channel => Math.abs(a[i + channel]! - b[i + channel]!))) > 3) count++;
    return count;
  };
  await page.getByRole("button", { name: "모든 캐릭터 가림 예제" }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-revision", "2");
  await expect(page.locator("#status")).toContainText("선택 없음");
  for (const [index, direction] of ["south", "north", "west"].entries()) {
    await page.getByRole("combobox", { name: "예제 캐릭터 방향" }).selectOption(direction);
    await expect(page.locator("#status")).toHaveAttribute("data-revision", String(3 + index));
    const on = await pixels();
    await page.screenshot({ path: info.outputPath(`production-${direction}-on.png`) });
    await toggle.uncheck();
    const off = await pixels();
    await page.screenshot({ path: info.outputPath(`production-${direction}-off.png`) });
    expect(changed(on, off), `${direction}: terrain changes with neither actor selected`).toBeGreaterThan(1000);
    await toggle.check();
    expect(changed(on, await pixels()), `${direction}: clear/rebuild restores pixels`).toBe(0);
  }
  await page.mouse.move(370, 420); await page.mouse.wheel(0, -150);
  await page.keyboard.down("Alt"); await page.mouse.down();
  await page.mouse.move(400, 440); await page.mouse.up(); await page.keyboard.up("Alt");
  await page.mouse.move(750, 20);
  const movedCamera = await pixels(); await toggle.uncheck();
  expect(changed(movedCamera, await pixels()), "real wheel/pan retains standee clipping").toBeGreaterThan(1000);
  await toggle.check();
  expect(changed(movedCamera, await pixels()), "camera ON/OFF round-trip").toBe(0);
  await page.screenshot({ path: info.outputPath("production-camera-on.png") });
  await page.getByRole("button", { name: "모두 높이 0" }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-revision", "6");
  const flat = await pixels(); await toggle.uncheck();
  expect(changed(flat, await pixels()), "legacy flat board is unaffected").toBe(0);
  await toggle.check();
  await page.getByRole("button", { name: "모든 캐릭터 가림 예제" }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-revision", "7");
  const rebuilt = await pixels(); await toggle.uncheck();
  expect(changed(rebuilt, await pixels()), "retired column textures rebuild after flat map").toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});
