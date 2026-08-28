# CardGuild

Card Hunter식 장비 카드와 PF2e식 3-Action 전투를 결합한 Tactical Adventure의
M0 전투 코어 수직 슬라이스입니다. 한 명의 플레이어와 두 고블린이 정사각형
격자에서 승리 또는 패배까지 전투할 수 있습니다.

## 요구 환경과 실행

- Node.js 22.13 이상(22.x) 또는 Node.js 24 이상
- npm 11 이상

```bash
npm install
npm run dev
```

## M0 플레이

- `Step`, `Stride`, `Strike`는 손패와 무관한 고정 Basic Action입니다.
- 이동은 상하좌우만 가능하며 목적지를 고른 뒤 최종 Facing을 선택합니다.
- `Escape`, `Interact`, `Raise Shield`, `Sustain Spell`은 현재 상태가 제공하는
  Context Action입니다.
- Halberd의 `Trip`, Boots of Fly의 `Fly`, Focus Spell인 `Spirit Beacon`,
  `Reactive Strike`는 출처가 보존되는 전술 카드입니다.
- 레버를 사용하면 중앙의 Blocked gate가 열립니다. Rubble, Chasm, Wall, Web은
  이동 및 LOS/LOE 판정에 서로 다른 Trait으로 참여합니다.
- 적 AI와 모든 동률, 판정, 셔플은 기본 seed `1`에서 결정론적으로 처리됩니다.

## 구조

```text
src/game   순수 CombatState + Command + Event, grid, cards, traits, AI, replay
src/app    세션과 입력 상태, 적 AI 턴 orchestration
src/pixi   격자·토큰·highlight·Facing·전투 feedback
src/dom    행동·카드·HUD·로그·Reaction·결과 UI
```

`src/game`은 PixiJS, DOM, 브라우저 API에 의존하지 않습니다. UI는
`listLegalActions`, `listLegalTargets`, `previewAction`의 결과를 표시하고
`CombatCommand`만 전송합니다. 같은 seed와 command log는 같은 event sequence와
state hash를 만듭니다.

설계 기준은 [`documents/dev_map_draft_v2.md`](documents/dev_map_draft_v2.md), 구현
범위는 GitHub 이슈 `#1`을 따릅니다.

## 검증

```bash
npm run check       # TypeScript, core 경계, ESLint, Vitest
npm run build       # production bundle
npm run test:smoke  # 실제 Chromium/PixiJS/DOM 상호작용
npm test            # Vitest + Playwright
```

Vitest는 RNG, 4단계 성공도, 3-Action/MAP, 직교 pathfinding, terrain/LOS,
Facing, 장비 카드 provenance, Context Action, Reaction use/pass, replay hash,
victory/defeat를 검증합니다. Playwright는 실제 캔버스 입력으로 이동 후 Facing,
레버, Shield, Sustain, AI 턴, Reaction과 전투 결과 화면을 검증합니다.

## M0 범위 밖

전체 PF2e 규칙, 손 점유/그립, deck builder, adventure/loot, 신규 게임 아트,
완성형 VFX/audio, 서버·온라인 협동·저장은 후속 단계입니다.
