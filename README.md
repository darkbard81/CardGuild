# CardGuild

Card Hunter식 장비 카드와 PF2e식 3-Action 전투를 결합한 Tactical Adventure입니다.
결정론적 전투 코어와 JSON Content Pipeline 위에 M2 Adventure Flow와 top-down 2.5D
board presentation을 연결했습니다. 전투 화면은 canvas 전체를 전장으로 쓰고 HUD는 그
위에 떠 있는 반투명 패널로만 배치합니다. 같은 파티가 세 Encounter를 순서대로 진행하고
선택한 Reward를 AdventureState의 Collection에 유지합니다.

## 요구 환경과 실행

- Node.js 22.13 이상(22.x) 또는 Node.js 24 이상
- npm 11 이상
- 최소 지원 해상도 1024x768. 보드 투영은 HUD gutter를 제외한 영역 안에서 계산되며,
  gutter 크기는 `data-hud-gutter` 패널을 실제로 measure해서 얻습니다. style.css가
  바뀌면 투영이 따라오고, smoke test는 어떤 패널도 보드 quad와 겹치지 않는지 검증합니다.

```bash
npm install
npm run dev
```

## M2 플레이

- `Goblin Trouble`은 Road Ambush → Ruined Gate → Goblin Chief의 linear Adventure입니다.
- 전투 승리 후 두 Reward 중 하나를 획득하며, 획득과 Loadout 변경은 분리됩니다.
- 각 Encounter는 영속 party identity/loadout으로 새 CombatState와 파생 seed를 만듭니다.
- 전투 HP, Condition, Reaction, 손패와 지속 효과는 다음 Encounter로 이월하지 않습니다.

- 입력은 대상 우선입니다. 보드에서 적·칸·오브젝트·자신을 클릭하면 그 대상에
  합법인 행동만 링 메뉴로 열리고, 항목을 고르면 즉시 실행됩니다. `Esc`나 바깥
  클릭으로 닫습니다.
- `Step`, `Stride`, `Strike`는 손패와 무관한 고정 Basic Action이며 별도 버튼 없이
  링 메뉴에 나타납니다.
- 이동은 상하좌우만 가능하며 목적지를 고른 뒤 보드 위 4방향 위젯에서 최종 Facing을
  선택합니다.
- `Escape`, `Interact`, `Raise Shield`, `Sustain Spell`은 현재 상태가 제공하는
  Context Action이며 해당 대상(자신·오브젝트)을 클릭할 때 링 메뉴에 포함됩니다.
- 손패 카드는 클릭해서 먼저 고를 수도 있습니다. 이때 합법 대상이 보드에 강조되고
  그중 하나를 클릭하면 실행됩니다.
- Halberd의 `Trip`, Boots of Fly의 `Fly`, Focus Spell인 `Spirit Beacon`,
  `Reactive Strike`는 출처가 보존되는 전술 카드입니다.
- 레버를 사용하면 중앙의 Blocked gate가 열립니다. Rubble, Chasm, Wall, Web은
  이동 및 LOS/LOE 판정에 서로 다른 Trait으로 참여합니다.
- 적 AI와 모든 동률, 판정, 셔플은 기본 seed `1`에서 결정론적으로 처리됩니다.

### CardGuild Rules Override

Facing은 PF2e Remaster 기본 규칙이 아니라 CardGuild 고유 전술 규칙입니다.
이동을 마칠 때 네 방향 중 하나를 정하고, Strike와 Reactive Strike는 전방/측면만
대상으로 삼습니다. 바로 뒤에서 가하는 근접 공격은 대상 AC를 2 낮춥니다. 이는
PF2e의 Off-Guard/Flanking을 구현한 것이 아니며 이후 rules config로 분리할 규칙입니다.

## 구조

```text
src/game   순수 CombatState + Command + Event, grid, trait providers, AI, replay
src/content JSON authoring DTO, semantic compiler, canonical fingerprint, M2 loader
content    JSON Schema와 versioned Content Pack authoring source
src/adventure 순수 AdventureState/Command/Event와 Combat bridge
src/app    Adventure/전투 세션, 명시적 interaction state machine, 적 AI 턴 orchestration
src/pixi   BoardProjection/PerspectiveMesh/camera/depth renderers와 tactical overlay
src/presentation WebP atlas AssetCatalog와 layered tilemap mapping
src/dom    Adventure/Reward, 링 컨텍스트 메뉴·카드·HUD·로그·Reaction·결과 UI
```

전투 입력은 `battle-interaction.ts`의 `Interaction` union(`idle`/`card`/`ring`/`facing`)이
단계를 소유합니다. 각 단계가 자기 데이터를 들고 있으므로 링 항목이나 확정된 목적지가
다음 단계로 새지 않으며, 이후 AoE·multi-target·drag 같은 targeting mode도 여기에
붙입니다.

`src/game`은 PixiJS, DOM, 브라우저 API, Ajv, 파일 경로에 의존하지 않습니다. UI는
`listLegalActions`, `listLegalTargets`, `previewAction`의 결과를 표시하고
`CombatCommand`만 전송합니다. 같은 seed와 command log는 같은 event sequence와
state hash를 만듭니다. CombatState와 replay는 pack ID/version/fingerprint를
보존하며 콘텐츠가 다르면 replay command 실행 전에 실패합니다.

장비와 Condition은 개별 ID 분기 대신 `TraitDefinition` provider를 통해 카드와
Context Action을 공급합니다. Condition이 공급한 Stand/Escape 같은 Recovery Action도
자신을 클릭했을 때 열리는 링 메뉴에 함께 나타나므로 별도 UI 분기가 없습니다.

M2 콘텐츠의 source of truth는 [`content/m2`](content/m2) JSON이며, Schema와
작성 규칙은 [`content/README.md`](content/README.md)에 있습니다. Equipment,
Card, Condition과 Trait provider는 engine TypeScript를 수정하지 않고 JSON으로
추가할 수 있습니다.

Presentation path는 gameplay fingerprint에 포함되지 않습니다. 투영·광원·팔레트 기준은
`art/STYLE.md`, 원본 PNG와 재생성 계획은 `art/source`, 투명 분리/QC 결과는
`art/processed`, 2048² runtime WebP atlas는 `public/assets`, atlas·ground/transition/object
layer mapping은 `presentation/m2`에 있습니다. 캐릭터는 front/back 양면 paper standee이며
north는 back, 나머지 cardinal 방향은 front와 projected facing arrow로 표시합니다.

설계 기준은 [`documents/dev_map_draft_v2.md`](documents/dev_map_draft_v2.md), M2 구현
범위는 GitHub 이슈 `#3`을 따릅니다.

## 검증

```bash
npm run content:check # Schema, references, compile, fingerprint
npm run assets        # raw PNG cleanup -> normalized frames -> atlas/tilemap -> validation
npm run assets:build  # 위 pipeline 산출물 재생성
npm run assets:check  # alpha, anchors, 양면 standee, atlas, layered tilemap 검증
npm run check         # Content/asset, TypeScript, core 경계, ESLint, Vitest
npm run build         # Content/asset 검증 후 production bundle
npm run test:smoke    # 짧은 Chromium/PixiJS/DOM 입력·responsive smoke
npm test            # Vitest + Playwright
```

Vitest는 Content v2 Schema/reference/fingerprint, Adventure 3전/Reward/실패/seed/Combat bridge,
projective BoardProjection/depth/layered tilemap, RNG, 4단계 성공도, 3-Action/MAP,
직교 pathfinding, terrain/LOS, Facing, 장비 카드 provenance, Context Action,
Reaction lifecycle, replay identity/hash, victory/defeat를 검증합니다. Playwright는 Adventure shell,
지연 WebP atlas 로딩, 실제 perspective board hover/링 메뉴 이동·공격/Facing,
1024x768 최소 해상도 적합성과 ultrawide reflow를 검증합니다.

## M2 범위 밖

전체 PF2e 규칙, 손 점유/그립, deck/loadout editor, branch Adventure, 랜덤 loot economy,
sprite animation, 완성형 VFX/audio, 서버·온라인 협동·저장은 후속 단계입니다.
