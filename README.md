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
- wire protocol은 v4입니다. v3의 `end-turn`에는 `facing`이 없고 tile target에는 `facing`이
  필수였으므로 두 버전은 서로의 payload를 거부합니다. 그래서 같은 `v`를 선언한 채 intent
  단위로 실패하는 대신 handshake에서 `PROTOCOL_MISMATCH`로 끊습니다.
- attach/detach는 gameplay state/hash/revision을 바꾸지 않는 protocol v4 control-only
  snapshot(`events=[]`)으로 배포됩니다. 신선도는 `(revision, controlRevision)` 쌍으로
  판단하며, 중복 연결은 최신 연결이 이전 연결을 대체합니다. server restart persistence와
  host migration은 지원하지 않습니다.

## 플레이

- `Goblin Trouble`은 Road Ambush에서 Cult Sanctum까지 이어지는 8 Encounter linear Adventure이며,
  앞의 4개가 tutorial prefix입니다.
- 여섯 번의 전투 승리 뒤 Reward 선택지(카드 보상 3개, 장비 보상 4개) 중 하나를 획득하며, `Manage Loadout`에서 장비 slot과 준비
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
- 이동은 상하좌우만 가능하며 Facing은 GameCore가 실제 경로의 마지막 이동 방향으로
  결정합니다. 일반 이동에는 방향 확인 단계가 없습니다.
- 방향성이 있는 Actor/Object/Tile 행동은 현재 Facing으로 합법성을 검사한 뒤 대상 방향으로
  회전합니다. self/none/Sustain은 방향을 유지하며, 뒤쪽 적을 자동 회전으로 공격할 수 없습니다.
- 자기 칸의 `Step`은 4방향 위젯으로 방향을 선택하고 1 Action을 소비합니다. 위치 이동,
  이동 이벤트, Reaction은 발생하지 않으며 Prone/Grabbed 등 Step 제한도 그대로 적용됩니다.
- `End Turn`을 누르면 자기 칸에 4방향 위젯이 나타나고, 선택한 최종 Facing과 턴 종료를 무료인
  하나의 명령으로 처리합니다. `Esc` 또는 바깥 클릭은 명령 없이 이전 입력 상태로 돌아갑니다.
  같은 방향이면 중복 `FACING_CHANGED`는 발생하지 않습니다.
- Action을 모두 사용하면 같은 위젯이 자동으로 열립니다. 방향을 고르면 그대로 턴이 끝나고,
  취소하면 턴은 유지되며 그 턴에는 다시 자동으로 열리지 않습니다. 턴을 끝내는 명령은
  언제나 플레이어가 고른 방향과 함께 나갑니다.
- AI는 일반 행동의 방향 계산을 GameCore에 맡기며, 턴 종료 시 가장 가까운 살아있는 적을
  바라봅니다. 동률은 Actor ID 순서, 적이 없으면 현재 방향을 유지합니다.
- 같은 팀의 살아있는 Actor가 있는 칸은 통과할 수 있지만 이동을 끝낼 수 없습니다.
  상대 팀의 살아있는 Actor는 통과와 정지를 모두 막으며, defeated Actor는 점유에서 제외됩니다.
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
이동 Facing은 마지막 이동 구간에서 결정하며, 제자리 Step과 End Turn에서 방향을 선택합니다.
Strike와 Reactive Strike는 공격자의 전방/측면만 대상으로 삼습니다.

- Rear: 대상 Facing의 정확한 후방 인접 칸에서 가하는 근접 Strike는 그 공격자에게만
  대상을 Off-Guard로 만듭니다. 이는 CardGuild 고유의 추가 원인입니다.
- Flanking: 공격자와 아군의 중심을 연결한 선이 대상 칸의 서로 반대인 변 또는 모서리를
  통과해야 합니다. 대상 Facing과 무관하며, 두 공격자 모두 살아 있고 현재 근접 Strike로
  대상을 위협해야 합니다(공격자 Facing, 사거리, 시야 및 효과선 적용).
  현재 행동 불능 판정은 defeated이며, 남은 Action/Reaction이나 현재 턴 소유자는 무관합니다.
- 기존 Manhattan 거리 규칙을 유지하므로 대각선 인접 칸은 10ft reach가 필요합니다.
  Character는 현재 선택된 melee 무기 또는 기본 unarmed Strike를 사용합니다.
  현재 Creature의 fixed Strike는 reach를 포함한 authored 근접 공격으로 취급합니다.
- Off-Guard는 AC -2 circumstance penalty입니다. Rear와 Flanking의 modifier를 공통
  stack에 각각 전달하므로 동시에 성립해도 -4가 되지 않습니다. 더 큰 circumstance
  penalty가 우선하며, circumstance bonus는 별도로 함께 적용됩니다.
- 기본 Strike, Strike 기반 Card, Reactive Strike 모두 같은 판정을 사용합니다.
  원거리 Strike나 skill/save check에는 적용하지 않으며, 전역 Actor condition을 추가하지
  않습니다. Preview와 실행의 공통 plan 및 debug notes에 원인과 적용/억제 여부를 표시합니다.


규칙 설명은 HUD가, 위치와 입력은 보드가 담당합니다. 전투 Preview는 `Target AC`와
`Off-Guard -2` 효과를 한 번 표시하고, `Rear · Flanking` 원인 및 협공 아군 이름을 별도로
표시합니다. 더 강한 기존 circumstance 페널티가 있으면 실제 AC와 `추가 AC 감소 없음`을
표시합니다. 상세 stack은 개발 모드의 접힌 Debug에 둡니다. 보드에는 Rear·Flanking·
Off-Guard를 설명하는 표식이나 글자를 그리지 않습니다. 이동 후의 가상 공격이나 방향
추천도 제공하지 않습니다.

End Turn 및 제자리 Step은 바라볼 보드 위치를 한 번 클릭/터치하면 Actor 위치에서 그
위치로 향하는 Facing이 정해지고 곧바로 전송됩니다. 방향 판정은 GameCore의
`facingToward()`가 하며 presentation은 복제하지 않고, 화면 사분면이 아니라
`BoardProjection`이 돌려준 보드 좌표를 씁니다. 선택한 위치로 이동하지는 않습니다.
방향키도 같은 명령을 보냅니다. 전송 전에는 gameplay state가 변하지 않고, Esc·보드 밖
클릭은 이전 선택으로 돌아가며, 서버가 거절하면 그대로 다시 고를 수 있습니다. Action 0의
자동 선택기 열기와 카드 대상 한 번 터치 실행은 유지합니다. 터치에서 공격 전 Preview를
읽으려면 기존 링 메뉴에서 첫 터치로 행동을 선택합니다.

## 구조

```text
src/game   순수 CombatState + Command + Event, grid, trait providers, AI, replay
src/content JSON authoring DTO, semantic compiler, canonical fingerprint, schema v8 loader
content    JSON Schema와 versioned Content Pack authoring source
src/adventure 순수 AdventureState/Command/Event와 Combat bridge
src/loadout Collection copy validation, 파생 deck/stat/context preview와 ActorSetup resolver
src/session 순수 Session authority, authorization, atomic Adventure↔Combat, gameplay hash
src/protocol protocol v4 type/schema, gameplay/control revision과 strict Ajv validation
src/server HTTP create/join, credential, SessionHost queue, WebSocket, server AI orchestration
src/client full snapshot/reconnect/idempotent intent client
src/app    snapshot 기반 Adventure/Battle controller와 명시적 interaction state machine
src/pixi   affine BoardProjection/board plane/camera/depth renderers와 tactical overlay
src/presentation atlas + standalone actor 혼합 저장 AssetCatalog와 layered tilemap mapping
src/dom    Adventure/Reward/Loadout Builder, 링 컨텍스트 메뉴·카드·HUD·로그·Reaction·결과 UI
```

전투 입력은 `battle-interaction.ts`의 `Interaction` union(`idle`/`card`/`ring`/`direction`)이
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

M8 Facing 변경은 과거 command의 의미도 바꿉니다. 과거 `end-turn`에는 `facing`이 없고
과거 이동 command의 `target.facing`은 플레이어가 고른 최종 방향이었지만, 지금 이동
Facing은 resolved path의 마지막 segment에서 나옵니다. **M8 이전 replay 호환은 보장하지
않습니다** — legacy migration이나 version adapter를 두지 않으므로 옛 replay는 거부되거나
과거와 다른 Facing/state/hash를 냅니다. 결정론 보장은 M8 이후 생성된 replay에만
적용됩니다.

장비와 Condition은 개별 ID 분기 대신 `TraitDefinition` provider를 통해 카드와
Context Action을 공급합니다. Condition이 공급한 Stand/Escape 같은 Recovery Action도
자신을 클릭했을 때 열리는 링 메뉴에 함께 나타나므로 별도 UI 분기가 없습니다.
Playable Character의 Save/Skill/Perception/Initiative는 Level, Attribute modifier,
Proficiency Rank와 Equipment/Condition/Trait modifier contribution을 입력으로 받는 하나의
deterministic resolver에서 파생합니다. Creature/Enemy는 같은 resolver 경계에 authored
fixed statistic을 제공하므로 PC용 16 Skill profile을 강제하지 않습니다. typed
bonus/penalty는 type마다 가장 큰 bonus와 가장 나쁜 penalty가 각각 적용되고, untyped는
penalty로만 존재하며 모두 누적됩니다.
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
`cardguild.m7`, contract는 schema v8입니다. 현재 authored revision과 fingerprint는
`content/m7/manifest.json`과 `npm run content:check` 출력이 소유하므로 이 README에 복제하지
않습니다. Client UI, battle rendering, WebSocket hello와 authoritative server는 모두
`src/content/production-content.ts`의 `PRODUCTION_CONTENT` 한 지점을 통해 이 pack을 봅니다.
[`content/m6`](content/m6)의 `cardguild.m6@0.9.0`과 [`content/m3`](content/m3)의
`cardguild.m4@0.6.0` pack은 규칙 회귀 fixture로 보존되며 production authoring 대상이 아닙니다.
디렉터리 안내는 [`content/README.md`](content/README.md)에 있습니다.

**신규 Card / Equipment / Character / Creature / Encounter / Adventure를 추가하는 방법은
[`docs/PRODUCTION-BLUEPRINT.md`](docs/PRODUCTION-BLUEPRINT.md) 하나에 있습니다** — schema 계약,
현재 release envelope, asset 절차, 검증 절차가 모두 그 문서의 golden path에 있습니다. 위에서
소개용으로 적은 수치(Starter 수, Encounter 수, 보상 선택지 수)의 현재 값과 허용 범위도 그 문서
§1.3 표와 `tools/content/m7-production-policy.ts`가 소유합니다. Equipment, Card, Condition과
Trait provider는 engine TypeScript를 수정하지 않고 JSON으로 추가할 수 있습니다.

Presentation path는 gameplay fingerprint에 포함되지 않습니다. 투영·광원·팔레트 기준은
`art/STYLE.md`, 원본 PNG와 재생성 계획은 `art/source`, 투명 분리/QC 결과는
`art/processed`에 있습니다. runtime 저장은 두 갈래입니다 — terrain/object/UI는 4096² WebP
atlas(`public/assets/m3-atlas.{webp,json}`), actor standee는 파일 한 장씩
(`public/assets/actors/<namespace>/<name>/{front,back}.webp`). 논리 asset ID는 양쪽에서
동일하고, atlas·ground/transition/object layer 및 Equipment/Card icon mapping은
`presentation/m3`에 있습니다.

보드는 시점이 고정된 **affine diamond**입니다. 하나의 Pixi canvas 안에서 board plane과
standee plane이 transform을 나눠 가집니다.

```text
screen = Translate(origin) x UniformScale(s) x ScaleY(0.5) x Rotate(+45°) x board-local
```

이 순서는 `boardCameraRoot > boardSquashRoot > boardTurnRoot` 컨테이너 계층으로 적혀
있습니다. 결과로 모든 칸이 크기가 같은 2:1 diamond가 되고, 원근 수렴도 row에 따른 셀
크기 변화도 없습니다. `BoardProjection`은 이 affine 변환의 forward/inverse만 계산하며
`gridToScreen`/`screenToGrid`/`getCellCorners`가 picking·overlay·animation의 유일한
경계입니다. 회전각과 squash는 presentation config(`boardRotationRadians`,
`boardSquashY`)일 뿐 gameplay content에는 없습니다 — grid·pathfinding·LOS는 그대로
직교 사각 격자입니다.

무엇이 board plane에 속하는지는 한 가지 질문이 정합니다 — **그 그림이 칸 자체의 상태인가,
칸 위에 놓인 물건인가.** 바닥·difficult·chasm·web·벽·gate(닫힘/열림)는 칸의 상태이므로 전부
같은 규격의 정사각 terrain tile로 board texture에 합성되고, 레버·상자 같은 point prop과
액터만 upright plane에 섭니다. 그 사이의 중간 범주는 없습니다.

Gate의 문짝·문틀·재질은 authored image가 담당하고 Pixi는 그것을 배치할 뿐입니다. 방향이
다른 벽에는 **같은 texture를 90° 회전**해 쓰므로 방향별 asset을 만들지 않습니다(축은 주변
`blocked` 이웃 수로 결정). 여는 것은 tile trait이 바뀌는 것뿐이고, 다음 `render(state)`가
`gate-open → gate → blocked` 순으로 표면을 골라 새 board texture를 만듭니다. Pixi
`Graphics`의 몫은 외곽선 하나뿐입니다 — 기준이 `blocked`이므로 닫힌 gate는 벽과 한 덩어리로
이어지고, 열리면 solid region에서 빠지면서 개구부 외곽선이 저절로 생깁니다.

Standee는 board plane의 자식이 아닙니다. 위치만 projection에서 받아 칸 중심에 서고,
몸은 화면에 대해 항상 upright이며 회전도 Y squash도 받지 않습니다. 원근이 없으므로 같은
zoom에서는 어느 칸에 서 있든 스탠디 크기가 같습니다. 보드 평면에 눕는 것은 발밑 base
graphic 하나뿐이고(`scaleY = boardSquashY`), HP 뱃지는 역스케일해 작은 창에서도 화면
크기를 유지합니다. 보드 위 콘텐츠는 절대 픽셀이 아니라 보드 자체의 uniform scale 대비
(`referenceCellWidth` 128px, 아트 제작 기준)로 스케일됩니다.

캐릭터는 front/back 양면 paper standee입니다. 45° 회전 때문에 north는 화면 우상,
west는 좌상으로 멀어지고 east는 우하, south는 좌하로 다가오므로, 방향은 화면에서
등지는 쌍과 마주보는 쌍으로 묶입니다.

```text
north -> back            west  -> back를 좌우 반전
east  -> front           south -> front를 좌우 반전
```

반전은 몸에만 적용하고 base·HP 뱃지·텍스트는 그대로 둡니다.

카메라 zoom은 배율이 아니라 **화면에 무엇이 들어오는지**로 정의됩니다. zoom 1은 항상 "맵
전체가 안전영역에 들어오는" 상태이고, 상한은 "`closeUpCells`(1)칸이 안전영역을 채우는"
상태입니다. 두 끝이 모두 픽셀이 아니라 framing이므로 밀집 맵도 성긴 맵과 같은 밀착 뷰에
도달하고, 노트북에서든 큰 모니터에서든 최대 확대의 뜻이 같습니다.

```text
maxZoom = max( boardFitScale(close-up frame) / boardFitScale(frame), minZoomHeadroom )
```

회전 후 모든 보드가 같은 2:1 모양이라 두 fit이 항상 같은 축에서 걸리고, 결국 비율은 칸
수의 비(`(cols+rows) / 2`)가 됩니다 — 그래서 창 크기가 바뀌어도 zoom 범위는 그대로입니다
(3x3=3x, 7x4=5.5x, 9x7=8x). 회전 때문에 fit은 columns와 rows를 함께 보며, 3x9 같은 세로
맵도 같은 식으로 들어갑니다.

**close-up이 1칸인 이유**는 그것이 맵이 아니라 캐릭터의 밀착 뷰이기 때문입니다. 스탠디는
셀 다이아몬드 폭보다 조금 작게 authoring되어 있어(`displayHeight` 132–164 대 다이아몬드
181), 다이아몬드 하나가 프레임을 채우면 스탠디 몸 전체가 안전영역 높이만큼 들어옵니다.
3칸이던 시절에는 3x3 맵이 이미 3칸을 보고 있어 상한이 1이 되고 임의의 상수
`minZoomHeadroom`(1.5x)만 남아, 작은 맵에서는 캐릭터에 다가갈 수 없었습니다. 1칸에서는
스스로가 close-up인 보드가 1x1뿐이라 그 경우에만 headroom이 걸립니다.

Pan은 두 규칙 중 **느슨한 쪽**을 씁니다. 보드가 안전영역보다 작으면 예전처럼 보드 중심이
안전영역을 벗어나지 못하고, 화면보다 큰 보드는 **어느 끝이든 안전영역 중앙까지 가져올 수
있는 만큼** 더 움직입니다. 중심만 가두면 9x7을 상한까지 확대했을 때 보드의 1/4밖에 볼 수
없기 때문입니다. 어느 쪽이든 화면 중앙에는 항상 보드가 남아 있어 되돌아올 수 있습니다.
턴이 시작될 때 해당 액터가 안전영역 밖이면 최소 거리만 pan해 시야에 넣습니다(zoom 1에서는
전체가 보이므로 아무 일도 하지 않습니다).

설계 기준은 [`documents/dev_map_draft_v2.md`](documents/dev_map_draft_v2.md), M5 구현
범위와 protocol 정정 사항은 GitHub 이슈 `#6`, M6-1 Character Stat Foundation은
GitHub 이슈 `#7`을 따릅니다.

## 검증

```bash
npm run content:check # 모든 pack의 Schema, references, compile, fingerprint
npm run content:production-check # 현재 M7 release policy/reachability/1P-3P 구조 coverage
npm run assets        # raw PNG cleanup -> normalized frames -> atlas/tilemap -> validation
npm run assets:build  # 위 pipeline 산출물 재생성
npm run assets:check  # alpha, anchors, 양면 standee, atlas/standalone 저장 파티션, layered tilemap 검증
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
affine BoardProjection/camera fit/depth/layered tilemap, RNG, 4단계 성공도, 3-Action/MAP,
직교 pathfinding, terrain/LOS, Facing, 장비 카드 provenance, Context Action,
Reaction lifecycle, replay setup identity/hash, victory/defeat를 검증합니다. Playwright는
Adventure shell, responsive Loadout Builder, atlas + standalone actor WebP 로딩, 실제 affine diamond board
hover/링 메뉴 이동·공격/Facing, Reward → 준비 카드/장비 변경 → 다음 Encounter 실제
손패·능력치·Context Action 연결, 1024x768 적합성과 ultrawide reflow를 검증합니다.
Network integration은 실제 `ws` client 3개로 queue/gameplay·control revision/idempotency,
claim race와 authorization, turn/reaction disconnect fallback·reconnect, server AI,
newest-wins reconnect와 legacy protocol(v1·v3) fail-fast를 검증합니다. Playwright는 별도
BrowserContext 3개로 host Party Builder, guest character picker, 1P 다중 제어, 2P fallback,
3P 분산 제어와 hash 수렴을 검증하며 기존 링 메뉴/Facing/HUD camera도 함께 회귀 검증합니다.

## UI/UX 리뷰 캡쳐

UI를 고치기 전후를 같은 자리에서 비교하려고, 실제 앱을 solo host로 한 판 돌리면서 화면별
대표 이미지를 찍어 둡니다. 목업이 아니라 지금 코드가 그리는 화면입니다.

```bash
npm run ui:capture:baseline # 원본(개선 전) 캡쳐 -> docs/ui-review/baseline/
npm run ui:capture          # 변경(개선 후) 캡쳐 -> docs/ui-review/current/
npm run ui:compare          # docs/ui-review/index.html 좌우 비교 페이지만 재생성
```

세션 로비, 파티 편성, Adventure 진행, Loadout Builder 세 상태, 전투 HUD와 액션 링, 보상
선택, 실패 화면을 1440x900과 1024x768로 찍습니다. 각 해상도의 `manifest.json`이 화면 ID와
리뷰 포인트, 그리고 찍지 못한 화면과 그 이유를 함께 남기므로 캡쳐 순서가 바뀌어도 원본과
변경이 화면 ID로 짝지어집니다. 자세한 사용법은 `docs/ui-review/README.md`에 있습니다.
캡쳐는 `playwright.capture.config.ts`로만 돌아가고 `npm run test:smoke`는 이 파일을
실행하지 않으므로, 테스트가 리뷰 자료를 덮어쓰지 않습니다.

## M5 범위 밖

계정/OAuth, matchmaking/public room, late join/spectator, host migration/kick, chat,
hidden-hand/PvP, prediction/rollback/delta protocol, DB·Redis·다중 process·server restart 복구,
AFK auto-turn/reaction auto-pass/disconnect AI takeover는 후속 범위입니다. 전체 PF2e 규칙,
branch Adventure, 완성형 VFX/audio와 3인 balance polish도 포함하지 않습니다.
