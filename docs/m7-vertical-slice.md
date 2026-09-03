# M7 Production Vertical Slice

M7-8(#19)의 설계 기록입니다. 새 시스템을 만드는 이슈가 아니라, #13~#18이 만든 것을 **하나의
authoritative Adventure로 조립**해 onboarding부터 finale victory까지 실제로 완주되게 하는
이슈입니다.

```text
PRODUCTION_CONTENT.adventureId
→ adventure.goblin-trouble
→ Tutorial Prefix (#18)  →  Main Progression  →  Elite / Support  →  Finale
```

user-facing Adventure selector를 추가하지 않았고, 새 Adventure ID도 만들지 않았습니다.
`PACK.adventures`에는 여전히 하나만 들어 있습니다.

Balance 완주(모든 Starter × 모든 party size)는 #21, visual coverage gate는 #20입니다.

---

## 1. 최종 progression (8 encounters)

권장 범위 6–8 중 상한을 썼습니다. #18이 tutorial을 4개 썼으므로 main은 4개입니다.

| # | Encounter | Map | 무엇을 요구하는가 | 3P 적 구성 | 보상 |
|---:|---|---|---|---|---|
| 1 | `road-ambush` | 3×3 | 이동·Strike·3-action | skirmisher | **card** |
| 2 | `spear-line` | 7×4 | 좁은 통로에서 10ft reach 통제 | spearman ×2 + skeleton guard | **card** |
| 3 | `ruined-gate` | 9×7 | 레버 상호작용, web의 Reflex 세이브 | skirmisher + brute | **card** |
| 4 | `goblin-chief` | 5×3 | 앞서 고른 카드를 elite 상대로 사용 | brute + chief | **weapon** |
| 5 | `bone-cellar` | 7×5 | 물량. party size만큼 잡졸이 늘어남 | guard + rabble ×3 | — |
| 6 | `wolf-run` | 9×7 | 기동 압박. speed 35–40이 후열을 노림 | dire wolf + yearling ×3 | **utility** |
| 7 | `archer-perch` | 9×7 | 원거리 + 회복. 사제를 먼저 끊어야 함 | archer ×2 + priest + rabble | **defence** |
| 8 | `cult-sanctum` | 9×7 | 세 역할 동시. 회복 리더 + 화력 + 잡졸 | hierophant + firebrand + initiate ×3 | — |

### 확인되는 곡선

Objective는 8개 전부 `defeat-all-enemies` 하나입니다. 새 objective kind를 만들지 않았습니다.
난이도는 **map geometry × composition × creature role**로만 올라갑니다.

| 검사 | 1P | 2P | 3P |
|---|---:|---:|---:|
| opener 적 수 (최소) | 1 | 1 | 1 |
| finale 적 수 (엄격히 최대) | 3 | 4 | 5 |
| onboarding 이후 최소 creature definition 수 | 2 | 2 | 2 |
| finale creature definition 수 | 3 | 3 | 3 |

세 party size 모두에서 opener가 최소, finale이 **앞의 모든 encounter보다 엄격히 많습니다.**
onboarding을 지나면 한 종류만 반복하는 전투가 더 없습니다. 이 네 줄은 회귀 테스트로 고정되어
있습니다.

아래 두 줄은 **role이 아니라 서로 다른 creature definition 수**를 셉니다. role은 runtime
metadata가 아니라 이 문서의 design matrix에만 있으므로, 같은 role의 서로 다른 creature 둘로
바뀌어도 테스트는 통과합니다. 실제 role mix(예: `archer-perch` = ranged + support + lackey)는
아래 표의 design review가 담보하고, 테스트는 "한 종류로만 채워지지 않았다"까지만 고정합니다.

### 소비된 content

| | 사용 | 전체 | 남긴 것 |
|---|---:|---:|---|
| Scenario (#16) | 8 | 10 | `web-hollow`, `collapsed-span` |
| Creature (#15) | 13 | 18 | spider ×2, `bone-hulk`, `goblin-slinger`, `goblin-lackey` |
| Reward equipment (#17) | 9 | 13 | `dueling-rapier`, `boar-spear`, `scout-leather`, `spiked-shield` |

남긴 것은 전부 **의도적 reserve**이며 #20의 allowlist 후보입니다.

- `web-hollow`는 brute + skirmisher라 role 축에서 `goblin-chief`·`ruined-gate`와 겹칩니다.
  8개 안에 넣으면 역할 곡선이 평평해집니다. web 지형 노출은 `ruined-gate`가 이미 합니다.
- `collapsed-span`은 #16이 이미 reserve로 분류했습니다 — 협곡이 보드를 분단해 근접 전용
  파티가 첫 라운드에 할 일이 없습니다.
- 위 두 Scenario를 빼면 그 안에만 있던 creature 5종이 함께 빠집니다. `goblin-lackey`가
  `collapsed-span`에만 배치되어 있는 것은 #16 authoring의 결과이고, 배치를 늘리는 것은
  #19가 아니라 #16/#21의 판단입니다.

---

## 2. Reward progression

6개 보상 — **card 3 + equipment 3**입니다. `bone-cellar`와 finale은 보상이 없어
no-reward encounter 경로도 실제로 지나갑니다.

| 시점 | 등급 | 선택지 | 무엇을 가르는가 |
|---|---|---|---|
| after `road-ambush` | early | Brace Behind Cover ↔ Careful Advance | 버틸 것인가 반응을 피할 것인가 |
| after `spear-line` | early | Trip ↔ Demoralize | Athletics 대 Intimidation |
| after `ruined-gate` | early | Spirit Lance ↔ Arcane Ward | 압박이냐 보호냐 |
| after `goblin-chief` | **mid** | **Throwing Axes ↔ Greatsword ↔ Flick Mace** | 사거리 / 순수 화력 / DEX 전환 |
| after `wolf-run` | **mid** | **Medic's Kit ↔ Strider's Boots ↔ Hexer's Focus** | 회복 / 이동·Athletics / 주문 화력 |
| after `archer-perch` | **late** | **Tower Shield ↔ Buckler ↔ Warding Charm** | 최대 AC / Reflex / Will·Arcane Ward |

### onboarding은 여전히 card만 줍니다

#18이 tutorial 보상을 card로만 구성한 이유는 그대로입니다 — baseline equipment 9종은 전부
누군가의 starter 장비라, 보상으로 주면 그 Starter에게는 **슬롯이 이미 같은 물건으로 찬**
dead choice가 됩니다. #19는 그 제약을 tutorial prefix 안으로 좁히고, prefix가 끝나는
`goblin-chief` 직후부터 #17 reward pool을 엽니다. 회귀 테스트가 두 가지를 함께 고정합니다:

- prefix 중에 나오는 보상은 전부 card
- 어떤 보상 선택지도 어떤 Starter가 이미 착용 중인 item이 아님
- `reserve` 3종(`executioner-axe`, `brigandine`, `bloodied-talisman`)은 절대 노출되지 않음

### Build direction

#17의 다섯 방향 중 **세 방향이 실제로 조립 가능**합니다(AC 요구는 2).

방향의 정의는 `docs/m7-equipment-matrix.md` §4가 source of truth입니다. 아래 "필요한 item"은
그 조합에서 **`reward` 등급만** 남긴 것으로, baseline 장비(half-plate, shield, scale-mail,
leather-armor)는 이미 착용 중이라 Adventure가 나눠 줄 필요가 없습니다. 조합을 이쪽에서 줄여
적지는 않습니다.

| Direction | matrix 조합 | 나눠 줘야 하는 item | 노출 |
|---|---|---|---|
| Heavy breaker | greatsword + tower-shield (+ half-plate) | greatsword + tower-shield | ✅ |
| Party support | medic's kit + shield + scale-mail | medic's kit | ✅ |
| Spell skirmisher | hexer's focus + throwing axes + leather-armor | hexer's focus + throwing axes | ✅ |
| DEX controller | flick-mace + scout-leather + strider's boots | flick-mace + scout-leather + strider's boots | ❌ (`scout-leather` 미노출) |
| Defensive duelist | dueling-rapier + buckler + warding-charm | dueling-rapier + buckler + warding-charm | ❌ (`dueling-rapier` 미노출) |

AC의 하한이 2이므로 세 방향으로 충분하고, 이를 채우려고 content를 더 넣지 않았습니다.
`scout-leather`와 `dueling-rapier`는 #20의 노출 확대 대상으로 남습니다. 세 equipment 보상이
weapon / feet / shield 세 슬롯을 건드리므로 "방향"이 실제로 다른 build를 만듭니다. 이 목록도
테스트에 그대로 적혀 있어, 조용히 하나가 빠지면 diff로 드러납니다.

---

## 3. archer-perch가 막았던 것

이 이슈에서 실제로 고친 **content 문제**입니다.

network progression smoke는 aerin·lyra·brom 3P로 8개 전투를 실제 전투 규칙으로 끝까지
싸웁니다. 이 셋은 **전원 근접**입니다(halberd / light blade / mace). `archer-perch`는 9×7
개활지에 archer ×2 + 회복하는 bone-priest를 세웁니다. 파티가 두세 라운드를 걸어 들어가는
동안 화살을 맞고, 도착하면 사제가 회복합니다.

측정값입니다. 두 축을 분리해서 쟀습니다.

| 조건 | 결과 (seed 1·7·42·99·123·777) |
|---|---|
| 초기 driver, 원거리 보상 없음 | **0/6 완주.** 11개 seed로 넓히면 8개가 `archer-perch`에서 사망 |
| 개선된 driver(집중 공격·아군 회복), 원거리 보상 **없음** | **0/6 완주.** 6개 중 5개가 여전히 `archer-perch` |
| 개선된 driver, `throwing-axes`를 선택지에 추가 | **3/6 완주** (1·123·777). 나머지는 `cult-sanctum`·`archer-perch`·`wolf-run` |

두 번째 줄이 요점입니다 — driver를 아무리 똑똑하게 만들어도 파티에 **사거리라는 답 자체가
없으면** 통과하지 못합니다. 그래서 `goblin-chief` 직후 보상을 무기 3지선다로 만들고 그 안에
`throwing-axes`(martial ranged 20ft, `thrown`이라 STR damage 전량)를 넣었습니다. 이것은
issue가 mid reward에 요구한 "다른 tactical route를 열 수 있는 choice" 그 자체입니다.

3/6이라는 숫자를 그대로 적어 둡니다. **아직 아슬아슬합니다.** 스크립트 파티가 절반은
떨어지므로, Starter × party size 전 조합의 balance는 여전히 #21의 일입니다. #19가 보장하는
것은 production path가 처음부터 끝까지 **연결되어 있고 실제로 완주된다**는 사실입니다.

---

## 4. Network progression smoke

`tests/network/adventure-progression.integration.test.ts` — #18의 tutorial prefix 테스트가
전체 progression을 덮게 자라서 이름을 바꿨습니다.

한 번의 실행이 지나가는 것:

```text
startCardGuildServer → HTTP /api/sessions → WebSocket hello(contentIdentity)
→ set-party-composition → begin-adventure
→ 8× (start-encounter → 실제 전투 → finalizeCombat)
→ 6× (choose-reward → set-loadout)
→ complete
```

모든 행동이 **client intent envelope**로 갑니다. host는 적 턴만 pump하고 사람의 경계마다
멈추므로, hero reaction window는 클라이언트가 답합니다(`heroReactions > 0`으로 고정).

### driver에 들어간 정책

플레이어가 할 수 없는 일은 하지 않습니다 — 전부 공유 legality query에서 나옵니다.

| 순서 | 정책 | 왜 |
|---|---|---|
| 1 | Stand / Escape Grab | 넘어지거나 붙잡힌 채로는 아무것도 못 함 |
| 2 | 레버 상호작용 | `ruined-gate`가 요구 |
| 3 | HP 절반 이하 아군 회복 | 회복하는 적에게 소모전으로 지지 않기 위해 |
| 4 | 가장 싼 공격을, **가장 HP가 낮은 적에게** | 피해를 분산하면 회복을 못 이김 |
| 5 | Raise Shield → 적에게 접근 | — |

보상을 고른 뒤에는 **슬롯이 빈 멤버**에게 장착하고, 빈 슬롯이 없으면 `deriveLoadoutSnapshot`
으로 AC와 Strike damage가 **떨어지지 않는** 멤버에게 장착합니다. 판단 근거를 production
resolver에서 읽으므로 테스트가 자체 산술을 만들지 않습니다.

### 결정론

seed는 1로 고정했습니다. hero reaction window가 열리고 위 정책으로 완주되는 seed입니다.
`deriveCombatSeed(adventureSeed, encounterId)`와 replay/fingerprint/content identity 계약은
건드리지 않았습니다.

---

## 5. UI / UX

8단계와 3지선다는 기존 화면이 감당하도록 만들어진 형태가 아니었습니다.

| 문제 | 무엇을 했는가 |
|---|---|
| progress rail이 4개 기준이라 8개에서 1024×768에 **잘림** — 하필 finale이 잘림 | 행을 한 줄로 압축(패딩·글꼴·번호 원 축소), `max-height: min(30rem, 52vh)` + 스크롤을 안전망으로. 잘리지 않는 것을 1024×768 스모크로 고정 |
| 어떤 전투가 보상을 주는지 화면에 없음 | 보상 있는 단계에 금색 핍(`◆`, `aria-label`·`title` 포함). 8개 중 6개가 주므로 텍스트 배지는 소음이라 핍으로 |
| finale이 다른 전투와 구별되지 않음 | 마지막 단계에 `FINALE` 태그와 테두리. **위치에서 파생**하며 content id를 특별 취급하지 않음 |
| Collection이 이름을 `·`로 이어 붙인 한 줄이라, 보상 6개가 쌓이면 읽히지 않음 | 아이콘 chip 목록 + 개수 배지. 수량은 2개 이상일 때만 표기 |
| 장비 보상은 자동 장착되지 않는데 화면이 그 사실을 말하지 않음 | between-encounters에 "미장착 보상 N개 — Manage Loadout에서 장착하거나 준비해야 다음 전투에 반영됩니다". N은 **보상으로 받은 사본만** 셉니다 — collection은 starter 장비까지 담고 있어서 "소유 − 착용"으로 세면 halberd를 greatsword로 바꾼 순간 창고에 남은 halberd가 영영 "대기 중"이 되고, 무기 슬롯이 하나뿐이라 0으로 내려갈 수가 없습니다. 새 state 없이 `createStartingCollection`(authored `starterLoadout`을 읽으므로 재장착에 흔들리지 않음)을 빼서 출처를 복원합니다. 착용 사본은 **starter 기준선에 먼저 귀속**되므로, 이미 착용 중인 물건과 같은 보상은 두 번째 멤버가 들 때까지 알림에 남습니다 — 그때까지는 실제로 한 사본이 놀고 있기 때문입니다. 스모크가 starter 방패·부츠를 벗은 뒤 알림이 사라지는 것을 고정합니다 |
| 보상 3지선다가 2열 그리드에서 **2 + 고아 1**로 깨짐 | 열 수를 선택지 수에서 받아 한 줄로(`--reward-choice-count`), 1100px 이하에서는 균등하게 세로 배치. 선택지 폭을 `justify-self: stretch`로 통일 — 크기가 다르면 순위처럼 읽힘 |
| 3열이 되면 이름이 카드 밖으로 넘침 | content 패널 상한을 40rem → 46rem, 이름·종류 칸에 `min-width: 0`과 줄바꿈 허용 |

핍과 finale 표시는 **authored 순서와 reward 표에서 파생**합니다. 화면 코드가 특정 encounter
id를 알지 못합니다.

### 함께 고친 PixiJS 자원 경고

전투를 떠날 때 PixiJS가 `[BindGroup] a 'textureSource' was destroyed while still bound to a
shader`를 경고하고 있었습니다. teardown이 board mesh의 텍스처를 `Texture.EMPTY`로 바꾼 **뒤에**
scene을 먼저 떼어내고 렌더했기 때문에, mesh가 그려지지 않아 bind group이 재구성되지 않은 채
텍스처가 해제됐습니다. mesh가 아직 stage에 있는 상태로 한 번 그린 뒤 떼어내도록 순서를
바꿨습니다.

스모크의 `captureRuntimeErrors`가 이제 **PixiJS 경고도 오류로 취급**합니다. 자원 수명 실수는
아무것도 throw하지 않아도 버그이기 때문입니다. 순서를 되돌리면 스모크가 실패하는 것을
확인했습니다.

---

## 6. 이미지 자산

**새로 요청한 이미지가 없습니다.** `npm run assets:check`가 production pack에 대해 exact
coverage를 요구하고 통과합니다 — 이 Adventure가 참조하는 8개 Scenario tilemap, equipment
25종, card 32종 아이콘이 모두 이미 매핑되어 있습니다(#15·#16·#17에서 생산).

### 다만 #20에 넘기는 발견

`presentation/m3/tilemaps.json`의 10개 Scenario가 **같은 ground palette 3종**
(`terrain.stone-floor` / `terrain.rubble` / `terrain.chasm`)을 씁니다. terrain 아트가
Scenario가 아니라 **tile trait**(`open`/`difficult`/`impassable`/`web`/`blocked`)에 매핑되어
있기 때문입니다.

기능상 문제는 없지만, 8개 전투를 연속으로 하면 길목·개활지·성소가 전부 같은 지하실로 보입니다.
고치려면 Scenario 단위 terrain theme이라는 **새 축**이 필요하고, 그것은 #16의 authoring
계약과 #20의 visual gate에 속합니다. #19에서 임시로 만들지 않았습니다.

---

## 7. 범위 밖

issue가 명시한 대로 아래를 vertical slice를 위해 임시 구현하지 않았습니다.

```text
multiple user-facing Adventure selection
branching narrative graph · optional branch state · quest flags
new Scenario objective kind
persistent campaign inventory beyond collection/loadout
Save / Resume persistence
Scenario 단위 terrain theme (→ #20)
```

Adventure contract는 그대로입니다 — linear `encounterIds`, party size 1–3, encounter 뒤의
고정 `card | equipment` 선택, encounter 사이 loadout 변경. 새 필드를 추가하지 않았습니다.
