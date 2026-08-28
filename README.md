# CardGuild

Card Hunter식 장비 카드와 PF2e식 3-Action 전투를 결합한 Tactical Adventure입니다.
M0 전투 코어 수직 슬라이스 위에 M1 JSON Content Pipeline을 연결했습니다. 한 명의
플레이어와 두 고블린이 정사각형 격자에서 승리 또는 패배까지 전투할 수 있습니다.

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

### CardGuild Rules Override

M0의 Facing은 PF2e Remaster 기본 규칙이 아니라 CardGuild 고유 전술 규칙입니다.
이동을 마칠 때 네 방향 중 하나를 정하고, Strike와 Reactive Strike는 전방/측면만
대상으로 삼습니다. 바로 뒤에서 가하는 근접 공격은 대상 AC를 2 낮춥니다. 이는
PF2e의 Off-Guard/Flanking을 구현한 것이 아니며 이후 rules config로 분리할 규칙입니다.

## 구조

```text
src/game   순수 CombatState + Command + Event, grid, trait providers, AI, replay
src/content JSON authoring DTO, semantic compiler, canonical fingerprint, M0 loader
content    JSON Schema와 versioned Content Pack authoring source
src/app    세션과 입력 상태, 적 AI 턴 orchestration
src/pixi   격자·토큰·highlight·Facing·전투 feedback
src/dom    행동·카드·HUD·로그·Reaction·결과 UI
```

`src/game`은 PixiJS, DOM, 브라우저 API, Ajv, 파일 경로에 의존하지 않습니다. UI는
`listLegalActions`, `listLegalTargets`, `previewAction`의 결과를 표시하고
`CombatCommand`만 전송합니다. 같은 seed와 command log는 같은 event sequence와
state hash를 만듭니다. CombatState와 replay는 pack ID/version/fingerprint를
보존하며 콘텐츠가 다르면 replay command 실행 전에 실패합니다.

장비와 Condition은 개별 ID 분기 대신 `TraitDefinition` provider를 통해 카드와
Context Action을 공급합니다. `Escape` UI는 Condition이 공급한 Stand/Escape 같은
Recovery Action을 하나의 메뉴로 묶습니다.

M0 콘텐츠의 source of truth는 [`content/m0`](content/m0) JSON이며, Schema와
작성 규칙은 [`content/README.md`](content/README.md)에 있습니다. Equipment,
Card, Condition과 Trait provider는 engine TypeScript를 수정하지 않고 JSON으로
추가할 수 있습니다.

설계 기준은 [`documents/dev_map_draft_v2.md`](documents/dev_map_draft_v2.md), M1 구현
범위는 GitHub 이슈 `#2`를 따릅니다.

## 검증

```bash
npm run content:check # Schema, references, compile, fingerprint
npm run check         # Content, TypeScript, core 경계, ESLint, Vitest
npm run build         # Content 검증 후 production bundle
npm run test:smoke  # 실제 Chromium/PixiJS/DOM 상호작용
npm test            # Vitest + Playwright
```

Vitest는 Content Schema/reference/fingerprint, RNG, 4단계 성공도, 3-Action/MAP,
직교 pathfinding, terrain/LOS, Facing, 장비 카드 provenance, Context Action,
Reaction lifecycle, replay identity/hash, victory/defeat를 검증합니다. Playwright는 실제 캔버스 입력으로 이동 후 Facing,
레버, Shield, Sustain, AI 턴, Reaction과 전투 결과 화면을 검증합니다.

## M1 범위 밖

전체 PF2e 규칙, 손 점유/그립, deck builder, adventure/loot, 신규 게임 아트,
완성형 VFX/audio, 서버·온라인 협동·저장은 후속 단계입니다.
