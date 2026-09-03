# CardGuild

Card Hunter식 장비 카드와 PF2e식 3-Action 전투를 결합한 Tactical Adventure입니다.
결정론적 전투 코어와 JSON Content Pipeline 위에 M5 server-authoritative 1–3인 협동,
호스트 Party Builder와 캐릭터별 Control, Collection/Loadout Builder, top-down 2.5D board presentation을 연결했습니다. 전투 화면은 canvas 전체를 전장으로
쓰고 HUD는 그 위에 떠 있는 반투명 패널로만 배치합니다. Adventure Reward는 Collection
소유권으로 남으며, 다음 Encounter 전에 장비와 준비 카드를 편성할 수 있습니다.

## 요구 환경과 실행

- Node.js 22.13 이상(22.x) 또는 Node.js 24 이상
- npm 11 이상
- 최소 지원 해상도 1024x768. 보드 투영은 HUD gutter를 제외한 영역 안에서 계산되며,
  gutter 크기는 `data-hud-gutter` 패널을 실제로 measure해서 얻습니다. style.css가
  바뀌면 투영이 따라오고, smoke test는 어떤 패널도 보드 quad와 겹치지 않는지 검증합니다.

```bash
npm install
npm run dev:coop
```

브라우저는 `http://127.0.0.1:4173`에서 엽니다. 호스트가 `Create & Host`로 세션을 만든 뒤
화면에 표시되는 Session ID만 B/C에게 전달합니다. 공개 방 목록이나 matchmaking은 없고,
게스트는 그 ID로 `Join Host`합니다. 재접속 credential은 각 탭의 `sessionStorage`에만
보관되며 URL이나 초대 코드에는 포함되지 않습니다.

Production build는 client와 server entry를 모두 생성합니다.

```bash
npm run build
npm run start:production
```

`start:production`은 `deploy/cardguild.production.env`를 읽어 `127.0.0.1:3011`에서
`dist/` 정적 client와 `/api`, `/ws`를 같은 origin으로 제공합니다. 허용 origin은
`https://card.krdp.ddns.net` 하나입니다. 운영 reverse proxy는 저장소 밖의 기존 Caddy
설정에서 `127.0.0.1:3011`로 전달합니다.

외부 client는 `https://card.krdp.ddns.net`만 사용하고, port 3011은 loopback에만
바인딩되어 Caddy를 통해서만 접근합니다. 개발 서버는 계속 Vite가 `/api`와 `/ws`를
port 8787 backend로 proxy합니다.

## M5 파티 편성과 캐릭터 제어

- Players와 Party는 서로 다른 모델입니다. 한 세션에는 1–3명의 player seat가 있고,
  호스트는 4명의 playable character 중 중복 없이 1–3명을 골라 `party.hero-1`부터
  순서대로 편성합니다. 네트워크 player ID, 영속 PartyMember ID, 전투 actor ID는 분리됩니다.
- Slot 1은 항상 호스트 소유입니다. 게스트는 편성된 Slot 2/3 중 비어 있는 캐릭터 하나를
  선택하거나 원자적으로 다른 캐릭터로 바꿉니다. 호스트는 온라인 게스트가 선택한
  캐릭터를 조작할 수 없고, 선택되지 않았거나 오프라인인 캐릭터를 모두 조작합니다.
- 게스트 연결이 끊기면 claim은 유지된 채 해당 캐릭터의 Loadout/turn/reaction 제어만
  즉시 호스트로 fallback됩니다. 같은 credential로 재접속하면 미해결 경계에서도 제어를
  되찾고 최신 snapshot과 combat event history를 복구합니다.
- HTTP join 뒤 한 번도 연결하지 않아 claim이 없는 offline guest는 로비 호스트가 제거해
  seat를 복구할 수 있습니다. 제거된 reconnect credential은 즉시 폐기됩니다.
- 호스트만 Party 편성, Adventure 시작, Encounter 진입, shared Reward 선택을 할 수
  있습니다. Party 편성은 게스트 claim이 생긴 뒤 잠기며, 시작 시 Party 크기는 접속한
  player 수 이상이어야 합니다.
- 브라우저는 intent만 전송합니다. seed, state, outcome, command sequence/ID와 적 AI는
  server가 만들고 기존 pure reducer로 다시 검증합니다.
- accepted transition마다 session revision이 증가하고 모든 client가 full authoritative
  snapshot과 gameplay hash를 받습니다. 한 client의 intent만 outstanding으로 유지하며,
  stale revision과 request ID 재사용/중복 retry를 server가 처리합니다.
- attach/detach는 gameplay state/hash/revision을 바꾸지 않는 protocol v3 control-only
  snapshot(`events=[]`)으로 배포됩니다. 신선도는 `(revision, controlRevision)` 쌍으로
  판단하며, 중복 연결은 최신 연결이 이전 연결을 대체합니다. server restart persistence와
  host migration은 지원하지 않습니다.

## 플레이

- `Goblin Trouble`은 Road Ambush에서 Cult Sanctum까지 이어지는 8 Encounter linear Adventure이며,
  앞의 4개가 tutorial prefix입니다.
- 여섯 번의 전투 승리 뒤 Reward 선택지(카드 3–4, 장비 4) 중 하나를 획득하며, `Manage Loadout`에서 장비 slot과 준비
  카드를 click/select 방식으로 편성합니다. 장착해도 Collection 수량은 차감되지 않습니다.
- Builder Preview와 다음 전투는 같은 loadout resolver를 사용합니다. AC/Reflex,
  Class DC, resolved Strike(attack/damage/range/trait), Trait-granted Card,
  Context Action과 카드 provenance가 함께 갱신됩니다.
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
- 적 AI는 server에서만 실행됩니다. 제품 세션 seed는 Node crypto로 만들며, 테스트는
  주입한 고정 seed로 동률·판정·셔플·AI 결과를 재현합니다.

### CardGuild Rules Override

Facing은 PF2e Remaster 기본 규칙이 아니라 CardGuild 고유 전술 규칙입니다.
이동을 마칠 때 네 방향 중 하나를 정하고, Strike와 Reactive Strike는 전방/측면만
대상으로 삼습니다. 바로 뒤에서 가하는 근접 공격은 대상 AC를 2 낮춥니다. 이는
PF2e의 Off-Guard/Flanking을 구현한 것이 아니며 이후 rules config로 분리할 규칙입니다.

## 구조

```text
src/game   순수 CombatState + Command + Event, grid, trait providers, AI, replay
src/content JSON authoring DTO, semantic compiler, canonical fingerprint, schema v8 loader
content    JSON Schema와 versioned Content Pack authoring source
src/adventure 순수 AdventureState/Command/Event와 Combat bridge
src/loadout Collection copy validation, 파생 deck/stat/context preview와 ActorSetup resolver
src/session 순수 Session authority, authorization, atomic Adventure↔Combat, gameplay hash
src/protocol protocol v3 type/schema, gameplay/control revision과 strict Ajv validation
src/server HTTP create/join, credential, SessionHost queue, WebSocket, server AI orchestration
src/client full snapshot/reconnect/idempotent intent client
src/app    snapshot 기반 Adventure/Battle controller와 명시적 interaction state machine
src/pixi   BoardProjection/PerspectiveMesh/camera/depth renderers와 tactical overlay
src/presentation WebP atlas AssetCatalog와 layered tilemap mapping
src/dom    Adventure/Reward/Loadout Builder, 링 컨텍스트 메뉴·카드·HUD·로그·Reaction·결과 UI
```

전투 입력은 `battle-interaction.ts`의 `Interaction` union(`idle`/`card`/`ring`/`facing`)이
단계를 소유합니다. 각 단계가 자기 데이터를 들고 있으므로 링 항목이나 확정된 목적지가
다음 단계로 새지 않으며, 이후 AoE·multi-target·drag 같은 targeting mode도 여기에
붙입니다.

`src/game`, `src/adventure`, `src/loadout`, `src/session`은 socket이나 DOM을 모르며,
server 전용 typecheck는 DOM lib 없이 이 경계를 검증합니다. UI는
`listLegalActions`, `listLegalTargets`, `previewAction`의 결과를 표시하고
`CombatCommand`만 전송합니다. 같은 seed와 command log는 같은 event sequence와
state hash를 만듭니다. CombatState와 replay는 pack ID/version/fingerprint와 Combat
Setup Fingerprint를 보존하며 콘텐츠나 loadout setup이 다르면 첫 replay command 전에
실패합니다.

장비와 Condition은 개별 ID 분기 대신 `TraitDefinition` provider를 통해 카드와
Context Action을 공급합니다. Condition이 공급한 Stand/Escape 같은 Recovery Action도
자신을 클릭했을 때 열리는 링 메뉴에 함께 나타나므로 별도 UI 분기가 없습니다.
Playable Character의 Save/Skill/Perception/Initiative는 Level, Attribute modifier,
Proficiency Rank와 Equipment/Condition/Trait modifier contribution을 입력으로 받는 하나의
deterministic resolver에서 파생합니다. Creature/Enemy는 같은 resolver 경계에 authored
fixed statistic을 제공하므로 PC용 16 Skill profile을 강제하지 않습니다. 같은 typed
bonus/penalty는 가장 큰 값만 적용되고, untyped는 penalty로만 존재하며 모두 누적됩니다.
Initiative source는 Perception 또는 Skill로만 선택할 수 있습니다.

Armor Class와 Max HP도 같은 경계에서 파생합니다. Character AC는
`10 + armor dexCap으로 제한된 DEX + 착용 category의 armor proficiency`를 base로 삼고,
Armor의 item bonus와 raised Shield의 circumstance bonus는 별도 산술 없이 공통
`resolveModifierStack()`을 통과합니다. Max HP는
`ancestry HP + level × (class HP + CON)`에서 파생되어 Encounter 시작 시 materialize되고,
current HP만 runtime mutable state입니다. Creature는 authored AC/Max HP를 유지합니다.
Loadout Preview와 Combat, UI는 모두 같은 `resolveArmorClass()` 결과를 사용합니다.

Strike와 Class DC도 같은 경계에 있습니다. Playable Character의 weapon은 최종 공격
수치를 저장하지 않고 `무엇을 쓰는지`(category/attackMode/dice/trait)만 선언하며,
`resolveStrike()`가 `attack Attribute + weapon proficiency + typed modifier + MAP`과
`weapon dice + 합법적인 Attribute contribution`을 계산합니다. melee는 STR, ranged와
thrown은 DEX를 쓰고 `finesse`는 둘 중 높은 쪽을 결정적으로 고릅니다. MAP은
`resolveMapPenalty()` 한 곳에서만 계산되어 agile weapon Strike만 `0 / -4 / -8`로
완화되고, 자기 turn 밖의 Reactive Strike에는 적용되지 않습니다. Weapon damage roll은
`strikeDamageTotal()`에서 PF2e 최소 1을 먼저 적용한 뒤 critical/action multiplier를
곱하므로 Preview의 damage range와 실제 damage가 같은 최소 정책을 씁니다. Legality query, Ring/Menu preview, Loadout Preview, 일반 Strike,
Reactive Strike가 모두 이 하나의 `ResolvedStrikeProfile`을 소비하므로 UI가 스스로
`STR + proficiency`를 더하지 않습니다. Class DC는
`10 + key Attribute + class DC proficiency + typed modifier`에서 파생되며 Save/Skill DC와
구분된 별도 statistic입니다. Creature/Enemy는 authored fixed strike를 유지하고 PC용
weapon proficiency 공식을 강제하지 않습니다.

Card와 Action은 한 경계를 공유합니다. `CardDefinition`은 규칙을 소유하지 않고
`ActionDefinition`을 참조하는 deck/provenance wrapper이며, Action은 `move`/`strike`/
`check`/`direct` 네 가지 `resolution` 중 하나를 선언합니다. Card는 최종 modifier나 DC를
저장하지 않고 **어떤 Skill/Save/Perception을 쓰는지**와 **DC를 어디서 가져오는지**만
선언하므로, Trip은 Athletics vs 대상 Reflex DC, Escape는 Athletics vs 고정 DC,
Spell tag가 붙은 Card는 대상 Save vs 시전자 Skill DC로 각각 #7/#8/#9 resolver를
조합해 계산됩니다. `spell`/`focus` Trait은 metadata일 뿐 executor를 고르지 않습니다.
`buildResolvedActionPlan()`이 RNG를 건드리지 않고 `ResolvedActionPlan`을 만들고
Preview와 실행이 같은 plan을 소비하므로 Preview modifier/DC와 실제 roll이 구조적으로
같습니다. Basic/Context/Innate/Card와 Reaction까지 모두 같은
`executeResolvedAction()`을 지나며, Reaction의 MAP도 executor가 `0`을 적어 넣는 대신
off-turn MAP context가 결정합니다. `CHECK_ROLLED`는 `actionActorId`와 `rollerActorId`를
따로 보고하므로 대상이 굴리는 Save도 모호하지 않습니다.

Production 콘텐츠의 source of truth는 [`content/m7`](content/m7) JSON이며 pack identity는
`cardguild.m7@0.3.0`, contract는 schema v8입니다. Client UI, battle rendering, WebSocket
hello와 authoritative server는 모두 `src/content/production-content.ts`의
`PRODUCTION_CONTENT` 한 지점을 통해 이 pack을 봅니다. [`content/m6`](content/m6)의
`cardguild.m6@0.9.0`과 [`content/m3`](content/m3)의 `cardguild.m4@0.6.0` pack은 규칙 회귀
fixture로 보존되며 production authoring 대상이 아닙니다. 디렉터리 안내는
[`content/README.md`](content/README.md)에 있습니다. **신규 Card / Equipment / Character / Creature / Encounter / Adventure를 추가하는 방법은
[`docs/PRODUCTION-BLUEPRINT.md`](docs/PRODUCTION-BLUEPRINT.md) 하나에 있습니다** — schema 계약,
현재 release envelope, asset 절차, 검증 절차가 모두 그 문서의 golden path에 있습니다.
Equipment, Card, Condition과 Trait provider는 engine TypeScript를 수정하지 않고 JSON으로
추가할 수 있습니다.

Presentation path는 gameplay fingerprint에 포함되지 않습니다. 투영·광원·팔레트 기준은
`art/STYLE.md`, 원본 PNG와 재생성 계획은 `art/source`, 투명 분리/QC 결과는
`art/processed`, 4096² runtime WebP atlas는 `public/assets`, atlas·ground/transition/object
layer 및 Equipment/Card icon mapping은 `presentation/m3`에 있습니다. 보드 위 콘텐츠는 절대 픽셀이 아니라
투영된 셀 폭 대비(`referenceCellWidth` 128px, 아트 제작 기준)로 스케일됩니다. 창 크기가
달라져도 스탠디가 칸에서 차지하는 비율은 고정이고 카메라 zoom만 크기를 바꿉니다.
HP 뱃지는 역스케일해 작은 창에서도 화면 크기를 유지합니다.

카메라 zoom은 배율이 아니라 셀 크기로 정의됩니다. zoom 1은 항상 "맵 전체가 안전영역에
들어오는" 상태이고, 상한은 셀이 `maxCellWidth`(220px)가 될 때까지입니다. 덕분에 9x7
맵도 3x3과 같은 밀착 뷰에 도달합니다. 기본 상태에서 이미 셀이 목표보다 큰 맵은
`minZoomHeadroom`(1.5x)만큼은 항상 확대할 수 있습니다. Pan은 보드 중심이 안전영역을
벗어나지 않도록 제한되며, 턴이 시작될 때 해당 액터가 화면 밖이면 최소 거리만 pan해
시야에 넣습니다(zoom 1에서는 전체가 보이므로 아무 일도 하지 않습니다). 캐릭터는 front/back 양면 paper standee이며
north는 back, 나머지 cardinal 방향은 front와 projected facing arrow로 표시합니다.

설계 기준은 [`documents/dev_map_draft_v2.md`](documents/dev_map_draft_v2.md), M5 구현
범위와 protocol 정정 사항은 GitHub 이슈 `#6`, M6-1 Character Stat Foundation은
GitHub 이슈 `#7`을 따릅니다.

## 검증

```bash
npm run content:check # 모든 pack의 Schema, references, compile, fingerprint
npm run content:production-check # 현재 M7 release policy/reachability/1P-3P 구조 coverage
npm run assets        # raw PNG cleanup -> normalized frames -> atlas/tilemap -> validation
npm run assets:build  # 위 pipeline 산출물 재생성
npm run assets:check  # alpha, anchors, 양면 standee, atlas, layered tilemap 검증
npm run check         # Content/asset, TypeScript, core 경계, ESLint, Vitest
npm run build         # Content/asset 검증 후 production bundle
npm run typecheck:server # DOM 없는 server/session/protocol type boundary
npm run test:network # 실제 random-port HTTP/WebSocket 3-client integration
npm run test:smoke   # 3 BrowserContext co-op + Chromium/PixiJS/DOM responsive smoke
npm test             # unit + network + Playwright
npm run playtest     # seeded 자동 플레이(밸런스 조사 도구, gate 아님)
```

Vitest는 Content schema v8 Schema/reference/fingerprint, PF2e proficiency/statistic resolver와
typed modifier stacking, Armor Class/Max HP 파생과 armor loadout, playable 4인 profile과 1–3P spawn,
Player/Party/Character/Control 분리, Collection/Loadout ownership와 파생
deck/stat/context, Adventure 8전/Reward/실패/seed/Combat bridge,
projective BoardProjection/depth/layered tilemap, RNG, 4단계 성공도, 3-Action/MAP,
직교 pathfinding, terrain/LOS, Facing, 장비 카드 provenance, Context Action,
Reaction lifecycle, replay setup identity/hash, victory/defeat를 검증합니다. Playwright는
Adventure shell, responsive Loadout Builder, 지연 WebP atlas 로딩, 실제 perspective board
hover/링 메뉴 이동·공격/Facing, Reward → 준비 카드/장비 변경 → 다음 Encounter 실제
손패·능력치·Context Action 연결, 1024x768 적합성과 ultrawide reflow를 검증합니다.
Network integration은 실제 `ws` client 3개로 queue/gameplay·control revision/idempotency,
claim race와 authorization, turn/reaction disconnect fallback·reconnect, server AI,
newest-wins reconnect와 protocol v1 fail-fast를 검증합니다. Playwright는 별도
BrowserContext 3개로 host Party Builder, guest character picker, 1P 다중 제어, 2P fallback,
3P 분산 제어와 hash 수렴을 검증하며 기존 링 메뉴/Facing/HUD camera도 함께 회귀 검증합니다.

## M5 범위 밖

계정/OAuth, matchmaking/public room, late join/spectator, host migration/kick, chat,
hidden-hand/PvP, prediction/rollback/delta protocol, DB·Redis·다중 process·server restart 복구,
AFK auto-turn/reaction auto-pass/disconnect AI takeover는 후속 범위입니다. 전체 PF2e 규칙,
branch Adventure, 완성형 VFX/audio와 3인 balance polish도 포함하지 않습니다.
