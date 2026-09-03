import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";
import { expect, type Page, test } from "@playwright/test";

/**
 * Walks one solo host run and photographs every screen the player actually sees.
 * The shots are UI/UX review material, not assertions: a step that cannot be reached
 * is reported in the manifest instead of failing the run, so a redesign in progress
 * still produces a comparable set.
 */

const SHOT_ROOT = process.env.CARDGUILD_UI_SHOT_DIR ?? "docs/ui-review/current";
const ROAD_MAP = { width: 3, height: 3 };

type Viewport = { readonly id: string; readonly width: number; readonly height: number; readonly label: string };

const VIEWPORTS: readonly Viewport[] = [
  { id: "1440x900", width: 1440, height: 900, label: "데스크톱 기준 해상도" },
  { id: "1024x768", width: 1024, height: 768, label: "지원 최소 해상도" },
];

type ShotEntry = {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly file: string | null;
  readonly skipped?: string;
};

type Corner = { readonly x: number; readonly y: number };

function projectCorners(
  corners: readonly [Corner, Corner, Corner, Corner],
  gridX: number,
  gridY: number,
): { readonly x: number; readonly y: number } {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const topWidth = topRight.x - topLeft.x;
  const bottomWidth = bottomRight.x - bottomLeft.x;
  const ratio = topWidth / bottomWidth;
  const u = gridX / ROAD_MAP.width;
  const v = gridY / ROAD_MAP.height;
  const denominator = 1 + (ratio - 1) * v;
  return {
    x: (topWidth * u + (ratio * bottomLeft.x - topLeft.x) * v + topLeft.x) / denominator,
    y: ((ratio * bottomRight.y - topLeft.y) * v + topLeft.y) / denominator,
  };
}

async function boardPoint(page: Page, gridX: number, gridY: number): Promise<{ x: number; y: number }> {
  const published = await page.locator("#pixi-canvas").getAttribute("data-board-corners");
  const corners = JSON.parse(published ?? "[]") as Corner[];
  if (corners.length !== 4) throw new Error("The board has not published its corners yet.");
  return projectCorners(corners as [Corner, Corner, Corner, Corner], gridX, gridY);
}

/** Collects the shots for one viewport and remembers what it could not reach. */
class ScreenAlbum {
  private readonly entries: ShotEntry[] = [];
  private index = 0;

  constructor(
    private readonly page: Page,
    private readonly viewport: Viewport,
  ) {}

  private get directory(): string {
    return path.join(SHOT_ROOT, this.viewport.id);
  }

  /**
   * Shots are numbered by capture order, so a set that gains or loses a screen
   * renumbers the ones after it. Clearing first keeps the orphans from the previous
   * run out of the folder the review page reads.
   */
  async open(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith(".png") || entry.name === "manifest.json")) {
        await rm(path.join(this.directory, entry.name));
      }
    }
  }

  async shot(id: string, title: string, note: string, fullPage = true): Promise<void> {
    this.index += 1;
    const file = `${String(this.index).padStart(2, "0")}-${id}.png`;
    // Fonts and the Pixi frame both settle a tick after the DOM does.
    await this.page.waitForTimeout(400);
    const shot = await this.page.screenshot({ fullPage });
    await mkdir(this.directory, { recursive: true });
    // Playwright writes a fast, fat PNG. These are committed review material and get
    // re-shot on every redesign, so re-encode losslessly — same pixels, a third the bytes.
    await writeFile(path.join(this.directory, file), await sharp(shot).png({ compressionLevel: 9, effort: 10 }).toBuffer());
    this.entries.push({ id, title, note, file });
  }

  skip(id: string, title: string, note: string, reason: string): void {
    this.index += 1;
    this.entries.push({ id, title, note, file: null, skipped: reason });
  }

  async write(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      path.join(this.directory, "manifest.json"),
      `${JSON.stringify({
        viewport: this.viewport,
        capturedAt: new Date().toISOString(),
        shots: this.entries,
      }, null, 2)}\n`,
    );
  }
}

async function openSoloAdventure(page: Page, album: ScreenAlbum): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "session");
  await album.shot(
    "session-lobby",
    "세션 로비 (진입 화면)",
    "첫 화면. 이름 입력, Create & Host, Join Host가 한 화면에 있고 첫 행동이 무엇인지 안내한다.",
  );

  await page.locator("#session-display-name").fill("Solo Host");
  await page.locator("#create-session").click();
  await expect(page.locator("#session-screen")).toHaveAttribute("data-viewer-role", "host");
  await album.shot(
    "party-builder",
    "호스트 로비 · 파티 편성",
    "Session ID 공유, seat 목록, 4명 중 1–3명 캐릭터 편성과 Begin Adventure 게이팅.",
  );

  await page.locator("#party-slot-2").selectOption("");
  await page.locator("#party-slot-3").selectOption("");
  await page.locator("#apply-party").click();
  await expect(page.locator("#begin-adventure")).toBeEnabled();
  await page.locator("#begin-adventure").click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
}

async function captureLoadout(page: Page, album: ScreenAlbum): Promise<void> {
  await page.getByRole("button", { name: "Manage Loadout" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "loadout");
  await album.shot(
    "loadout-builder",
    "Loadout Builder (기본 상태)",
    "장비 슬롯 · Collection · 덱 기여 카드가 한 화면에 있는 편성 화면.",
  );

  // The weapon slot is already open on entry, so the second distinct state worth
  // reviewing is the prepared-card picker, not another equipment list.
  await page.getByRole("button", { name: "+ Add Card" }).click();
  await album.shot(
    "loadout-card-picker",
    "Loadout · 준비 카드 추가",
    "Prepared Cards 슬롯에 넣을 카드 후보 목록. 덱 미리보기와 나란히 놓인다.",
  );

  await page.locator('.equipment-slot[data-slot="weapon"]').click();
  await page.locator('.loadout-option[data-option-id="empty-weapon"]').click();
  await expect(page.locator("#loadout-detail")).toContainText("+8 → +6");
  await album.shot(
    "loadout-preview-diff",
    "Loadout · 적용 전 변화 미리보기",
    "무기를 비웠을 때 명중/피해가 어떻게 바뀌는지 Apply 전에 diff로 보여주는 상태.",
  );

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "adventure");
}

async function captureCombat(page: Page, album: ScreenAlbum): Promise<void> {
  await page.getByRole("button", { name: "Enter Encounter" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });
  await expect(page.locator("#initiative-list .active")).toHaveText("Aerin");
  await album.shot(
    "combat-turn",
    "전투 화면 · 내 턴 시작",
    "canvas 전체가 전장이고 HUD는 그 위 반투명 패널. 액션 pip, 이니셔티브, 핸드 독, 로그.",
    false,
  );

  const enemy = await boardPoint(page, 2.5, 1.5);
  await page.locator("#pixi-canvas").click({ position: enemy });
  const ring = page.locator("#ring-root");
  if (await ring.isVisible()) {
    await album.shot(
      "combat-action-ring",
      "전투 화면 · 타겟 선택 후 액션 링",
      "칸을 먼저 고르고 그 자리에서 행동을 고르는 target-first 라디얼 메뉴.",
      false,
    );
    await page.keyboard.press("Escape");
  } else {
    album.skip(
      "combat-action-ring",
      "전투 화면 · 타겟 선택 후 액션 링",
      "칸을 먼저 고르고 그 자리에서 행동을 고르는 target-first 라디얼 메뉴.",
      "적 칸 클릭에서 라디얼 메뉴가 열리지 않았습니다.",
    );
  }

  await page.locator("#hero-details-toggle").click();
  await expect(page.locator("#hero-details")).toBeVisible();
  await album.shot(
    "combat-hero-sheet",
    "전투 화면 · 캐릭터 상세 시트",
    "상세 버튼으로 펼친 시트. 요약 카드가 덜어낸 세이브 DC, Strike, 장비 수치가 여기 모인다.",
    false,
  );
  await page.locator("#hero-details-toggle").click();
}

/** A screen that only shows up mid-fight, tracked so it can be reported when it never did. */
type Interrupts = { reaction: boolean; result: boolean };

const INTERRUPT_SHOTS = {
  reaction: {
    id: "reaction-window",
    title: "리액션 창",
    note: "적의 이동으로 열린 반응 기회. 게임을 멈추고 쓸지 넘길지 묻는 유일한 인터럽트 UI.",
    missing: "리액션 카드를 준비한 채 인터럽트 패스를 돌렸지만 이 시드의 전투에서는 반응 기회가 열리지 않았습니다.",
  },
  result: {
    id: "encounter-result",
    title: "전투 결과 모달",
    note: "Encounter가 끝났을 때 승패를 알리고 같은 시드로 다시 시작하게 하는 모달.",
    missing: "Adventure 흐름에서는 전투가 끝나는 즉시 Adventure 화면으로 넘어가 결과 모달이 뜨지 않습니다. 승패 안내는 보상 화면과 실패 화면이 대신합니다.",
  },
} as const;

async function captureReaction(page: Page, album: ScreenAlbum, interrupts: Interrupts): Promise<boolean> {
  if (!await page.locator("#reaction-modal").isVisible()) return false;
  if (!interrupts.reaction) {
    interrupts.reaction = true;
    const shot = INTERRUPT_SHOTS.reaction;
    await album.shot(shot.id, shot.title, shot.note, false);
  }
  return true;
}

async function captureResult(page: Page, album: ScreenAlbum, interrupts: Interrupts): Promise<boolean> {
  if (!await page.locator("#result-modal").isVisible()) return false;
  if (!interrupts.result) {
    interrupts.result = true;
    const shot = INTERRUPT_SHOTS.result;
    await album.shot(shot.id, shot.title, shot.note, false);
  }
  return true;
}

/** Plays Road Ambush out with Strikes, photographing the interrupts as they appear. */
async function winRoadAmbush(page: Page, album: ScreenAlbum, interrupts: Interrupts): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    let ready = false;
    for (let step = 0; step < 25 && !ready; step += 1) {
      if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
      if (await captureResult(page, album, interrupts)) break;
      if (await captureReaction(page, album, interrupts)) {
        await page.getByRole("button", { name: "Use Reaction" }).click({ timeout: 2_000 }).catch(() => undefined);
        continue;
      }
      if ((await page.locator("#initiative-list .active").textContent())?.includes("Aerin")) ready = true;
      else await page.waitForTimeout(300);
    }
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
    if (await captureResult(page, album, interrupts)) break;

    while (await page.locator("#action-pips .available").count()) {
      let struck = false;
      for (const [gridX, gridY] of [[2.5, 1.5], [1.5, 1.5]] as const) {
        if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
        if (await page.locator("#result-modal").isVisible()) break;
        await page.locator("#pixi-canvas").click({ position: await boardPoint(page, gridX, gridY) });
        const strike = page.locator('#ring-root .ring-option[data-action-id="strike"]');
        if (await strike.isVisible()) {
          const revision = await page.locator("#app").getAttribute("data-session-revision");
          await strike.click();
          await expect(page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
          struck = true;
          break;
        }
        await page.keyboard.press("Escape");
      }
      if (!struck) break;
      if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
      if (await captureResult(page, album, interrupts)) break;
    }
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
    if (await captureResult(page, album, interrupts)) break;
    // A fully spent turn ends itself, so only an unfinished one needs the button.
    const spent = await page.locator("#action-pips .available").count() === 0;
    const revision = await page.locator("#app").getAttribute("data-session-revision");
    if (!spent) await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "");
  }
}

/**
 * A hero who only ends turns hands the encounter to the enemies, which is the cheapest
 * way to reach the reaction window and the defeat modal — the two screens a winning run
 * never shows. The pass is time-boxed because it is review material, not a test.
 */
async function captureInterrupts(page: Page, album: ScreenAlbum, interrupts: Interrupts): Promise<void> {
  const deadline = Date.now() + 90_000;
  await page.getByRole("button", { name: "Enter Encounter" }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-screen", "combat", { timeout: 20_000 });

  while (Date.now() < deadline) {
    if (await page.locator("#app").getAttribute("data-screen") !== "combat") break;
    if (await captureResult(page, album, interrupts)) break;
    if (await captureReaction(page, album, interrupts)) {
      await page.getByRole("button", { name: "Use Reaction" }).click({ timeout: 2_000 }).catch(() => undefined);
      continue;
    }
    if ((await page.locator("#initiative-list .active").textContent())?.includes("Aerin")) {
      const revision = await page.locator("#app").getAttribute("data-session-revision");
      await page.getByRole("button", { name: "End Turn" }).click().catch(() => undefined);
      await expect(page.locator("#app")).not.toHaveAttribute("data-session-revision", revision ?? "")
        .catch(() => undefined);
      continue;
    }
    await page.waitForTimeout(200);
  }

  if (await page.locator("#app").getAttribute("data-screen") === "adventure") {
    const outcome = await page.locator("#app").getAttribute("data-outcome");
    await album.shot(
      "adventure-outcome",
      outcome === "defeat" ? "Adventure 실패 화면" : "Encounter 종료 후 Adventure",
      "전투가 끝난 뒤 진행 레일과 다음 행동이 어떻게 갱신되는지 보여주는 상태.",
    );
  }
}

/** `deferredTo` names the viewport that runs the interrupt pass, or null when this one did. */
function reportMissing(album: ScreenAlbum, interrupts: Interrupts, deferredTo: string | null): void {
  for (const key of ["reaction", "result"] as const) {
    if (interrupts[key]) continue;
    const shot = INTERRUPT_SHOTS[key];
    album.skip(
      shot.id,
      shot.title,
      shot.note,
      deferredTo === null ? shot.missing : `${deferredTo} 캡쳐를 참고하세요. 이 해상도에서는 인터럽트 패스를 돌리지 않습니다.`,
    );
  }
}

for (const [index, viewport] of VIEWPORTS.entries()) {
  test(`captures every CardGuild screen at ${viewport.id}`, async ({ page }) => {
    test.setTimeout(300_000);
    const album = new ScreenAlbum(page, viewport);
    const interrupts: Interrupts = { reaction: false, result: false };
    await album.open();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await openSoloAdventure(page, album);
    await album.shot(
      "adventure-brief",
      "Adventure 진행 화면",
      "8단계 진행 레일, 보상 표시, 소유 Collection, 다음 Encounter 브리핑.",
    );

    await captureLoadout(page, album);
    await captureCombat(page, album);
    await winRoadAmbush(page, album, interrupts);

    const rewardHeading = await page.locator("#adventure-content h1")
      .textContent({ timeout: 5_000 }).catch(() => null);
    if (rewardHeading === "Choose one reward") {
      await album.shot(
        "reward-choice",
        "보상 선택 화면",
        "Encounter 승리 후 파티가 공유하는 보상 하나를 고르는 화면.",
      );
      await page.locator(".reward-choice").first().click();
      await album.shot(
        "adventure-after-reward",
        "보상 수령 후 Adventure",
        "미장착 보상 안내와 다음 단계로 진행하는 상태.",
      );
    } else {
      album.skip(
        "reward-choice",
        "보상 선택 화면",
        "Encounter 승리 후 파티가 공유하는 보상 하나를 고르는 화면.",
        "플레이가 보상 단계까지 도달하지 못했습니다.",
      );
    }

    // One interrupt pass is enough material to review; running it per viewport would
    // double the capture time for screens that do not change with window size.
    if (index === 0 && await page.getByRole("button", { name: "Enter Encounter" }).isVisible()) {
      await captureInterrupts(page, album, interrupts);
    }
    reportMissing(album, interrupts, index === 0 ? null : VIEWPORTS[0]?.id ?? "기준 해상도");

    await album.write();
  });
}
