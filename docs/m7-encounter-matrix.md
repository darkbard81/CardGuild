# M7 Encounter Threat Matrix

M7-5(#16)의 Encounter Library 설계 기록입니다. 목적은 새 encounter scripting system이 아니라
**map geometry × party-size composition × creature role** 조합으로 서로 다른 전술 문제를
만드는 것입니다.

Objective는 전부 `defeat-all-enemies` 하나만 사용합니다. AoN XP budget은 4-character
baseline을 가진 **calibration reference**로만 참고하고 XP/level을 Scenario runtime metadata로
복제하지 않습니다.

- Encounter XP Budget — https://2e.aonprd.com/Rules.aspx?ID=2717
- Choosing Creatures — https://2e.aonprd.com/Rules.aspx?ID=2718

Balance 수치의 최종 승인은 #21, visual coverage release gate는 #20입니다.

---

## 1. Party-size scaling contract

`EncounterActorPlacement.partySize?`가 추가됐습니다. 이것은 **encounter production
scaling**이며 PF2e Rule Expansion이 아닙니다.

```text
partySize 없음        → 1P/2P/3P 모두 생성 (기존 authoring과 backward compatible)
partySize {min:2,max:3} → 2P/3P에서만 생성
partySize {min:3,max:3} → 3P에서만 생성
```

판정은 `placementAppliesToPartySize()` 하나가 소유하고 **세 소비 지점이 모두 그것을**
씁니다.

| 소비 지점 | 무엇을 하는가 |
|---|---|
| `buildAdventureEncounter()` | 실제 party member 수로 static placement를 filter |
| `compileScenario()` | preview hero가 1명이므로 **1P composition**으로 compile |
| `validateContentPackSemantics()` | 1P/2P/3P 각각의 effective composition을 따로 검사 |

### Validation을 둘로 나눈 이유

이전 validator는 모든 static placement를 하나의 `occupied` set에 넣었습니다. `partySize`를
도입하면 **서로 동시에 존재하지 않는 placement까지 충돌로 오인**합니다.

| 층 | 검사 |
|---|---|
| **Authored-global** (party size 무관) | instanceId 유일성, actor 존재, static hero 금지, tile 존재·bounds·blocked 금지, `min <= max`, spawn seat/position 유일성 |
| **Effective composition** (`partySize = 1,2,3` 각각) | static↔static 충돌, static↔active spawn 충돌, 해당 크기에 enemy 최소 1 |

따라서 **range가 겹치지 않는 두 placement는 같은 tile을 합법적으로 재사용**할 수 있습니다.
같은 party size에서 동시에 활성화될 때만 충돌입니다.

`partySize`는 authored source의 일부이므로 fingerprint에 들어갑니다. runtime-only scaling
state나 환경 변수로 composition을 바꾸지 않습니다.

---

## 2. Threat Matrix (10 scenarios)

`1P / 2P / 3P` 열은 해당 party size에서 실제로 생성되는 enemy 구성입니다.

| Scenario | Purpose | Map | Terrain / interactable | 1P | 2P | 3P | Creature roles | AoN threat band | Status | Balance risk |
|---|---|---|---|---|---|---|---|---|---|---|
| `encounter.road-ambush` | 첫 접촉. 단일 위협으로 기본 조작만 가르침 | 3×3 | **difficult ×2** | skirmisher ×1 | 동일 | 동일 | Skirmisher | Trivial | **Tutorial (T1)** | 없음. 의도적으로 확장하지 않음 |
| `encounter.ruined-gate` | 상호작용 도입. 레버로 문을 열어야 전선이 열림 | 9×7 | **lever + gate**, difficult, web, chasm | skirmisher + brute | 동일 | 동일 | Skirmisher, Brute | Low | **Tutorial (T3)** | 레버를 못 찾으면 교착 |
| `encounter.goblin-chief` | 첫 elite. 앞서 고른 보상을 실제로 쓰는 자리 | 5×3 | 없음 | brute + chief | 동일 | 동일 | Brute, Elite | Moderate | **Tutorial (T4)** | 좁은 맵이라 1P가 협공당함 |
| `encounter.bone-cellar` | 잡졸 물량. 수가 party size를 따라 늘어남 | 7×5 | 기둥 2개, difficult 2칸 | guard + rabble ×1 | + rabble ×1 | + rabble ×1 | Soldier, Lackey | Low → Moderate | Main | 3P에서 4마리가 동시에 붙음 |
| `encounter.wolf-run` | 기동 압박. speed 35–40 적이 후열을 노림 | 9×7 | 개활지, difficult 3칸 | dire wolf + yearling | + yearling | + yearling | Skirmisher, Lackey | Moderate | Main | 개활지라 Nera·Lyra가 먼저 물림 |
| `encounter.spear-line` | 대열 통제. 10ft reach가 통로를 잠금 | 7×4 | **좁은 통로**, 기둥 4개 | spearman ×1 | spearman ×2 | + skeleton guard | Soldier | Low → Moderate | **Tutorial (T2)** | 통로가 좁아 근접 파티가 줄서기를 강요당함 |
| `encounter.archer-perch` | 원거리 + 회복 압박. 사제를 먼저 끊어야 함 | 9×7 | 엄폐 기둥 4개, difficult | archer + priest | + archer | + rabble | Ranged, Support | Moderate | Main | 사제 회복이 장기전을 만듦 |
| `encounter.web-hollow` | 지형 통제. 거미줄이 접근을 늦추고 거미가 붙잡음 | 7×5 | **web ×6**, difficult | giant + cave spider | + cave spider | + cave spider | Brute, Skirmisher | Moderate | Main | Grabbed 연쇄 시 1P가 묶임 |
| `encounter.collapsed-span` | 분단된 보드. 원거리만 즉시 교전 가능 | 9×7 | **impassable 6칸(협곡)**, difficult | slinger + bone hulk | + slinger | + lackey | Ranged, Brute | Moderate | **Reserve** | 근접 전용 파티가 첫 라운드에 할 일이 없음 |
| `encounter.cult-sanctum` | 피날레 후보. 회복 리더 + 화력 + 잡졸 | 9×7 | 기둥 2개, difficult 3칸 | hierophant + firebrand + initiate | + initiate | + initiate | Elite/Support, Ranged, Lackey | Severe | **Main** (finale 후보) | hierophant 회복 + firebrand 화력이 겹치면 1P는 거의 불가능 |

### Tactical identity 확인

각 Scenario는 최소 **두 축**에서 다른 정체성을 갖습니다.

| Scenario | Map geometry | Composition scaling | Creature role |
|---|---|---|---|
| road-ambush | 3×3 최소 | 고정 | 단일 |
| ruined-gate | interactable gate | 고정 | 근접 2종 |
| goblin-chief | 5×3 좁음 | 고정 | elite |
| bone-cellar | 기둥 분할 | **증가** | soldier + lackey |
| wolf-run | 개활지 9×7 | **증가** | 고속 skirmisher |
| spear-line | **통로 7×4** | **증가** | reach soldier |
| archer-perch | 엄폐 기둥 | **증가** | ranged + support |
| web-hollow | **web 지형** | **증가** | 붙잡기 |
| collapsed-span | **분단 협곡** | **증가** | 원거리 + 중장 |
| cult-sanctum | 개활 9×7 | **증가** | 3역할 동시 |

7개 Scenario가 party size로 composition을 바꾸고, 나머지 3개는 tutorial/elite로 고정
composition을 유지합니다.

### #15 creature role 분포

| Role | 등장 Scenario |
|---|---|
| Lackey | bone-cellar, wolf-run, collapsed-span, cult-sanctum |
| Skirmisher | road-ambush, ruined-gate, wolf-run, web-hollow |
| Brute | ruined-gate, goblin-chief, web-hollow, collapsed-span |
| Soldier (reach) | bone-cellar, spear-line |
| Ranged | archer-perch, collapsed-span, cult-sanctum |
| Elite / Support | goblin-chief, archer-perch, cult-sanctum |

#15의 6개 role이 모두 쓰이고, 18종 중 13종이 배치됐습니다. 나머지는 #19/#21에서 배치하거나
reserve로 남습니다.

### Tutorial / Main / Reserve

| Status | Scenario |
|---|---|
| Tutorial | road-ambush (T1), spear-line (T2), ruined-gate (T3), goblin-chief (T4) |
| Main | bone-cellar, wolf-run, archer-perch, web-hollow, cult-sanctum |
| Reserve | collapsed-span |

#18이 tutorial 4개를 이 10개 안에서 골랐습니다. tutorial 전용 scenario는 추가하지 않았습니다.

### #18이 배치한 onboarding 순서

`adventure.goblin-trouble` 하나가 authoritative entry이며, #19가 같은 Adventure ID에 뒤를
이어 붙입니다. 별도 user-facing Adventure를 만들지 않았습니다.

| 단계 | Encounter | 무엇을 가르치는가 | 이어지는 보상 |
|---|---|---|---|
| T1 | `road-ambush` | Stride/Step, 3-action, 기본 Strike. 3×3에 적 1명 | **Steel Shield** ↔ **Brace Behind Cover** — 방어를 장비 슬롯과 준비 카드 두 방식으로 |
| T2 | `spear-line` | 위치와 방어. 10ft reach 창병이 좁은 통로를 잠금 | **Trip** ↔ **Demoralize** — Athletics 대 Intimidation, 두 통제 축 |
| T3 | `ruined-gate` | 기술/세이브/통제. 레버 상호작용, web의 Reflex 세이브 | **Boots of Fly** ↔ **Spirit Lance** — 기동 대 세이브 주문 |
| T4 | `goblin-chief` | 앞서 고른 보상을 실제 전투에서 사용 | — |

보상은 전부 **#13 production card 또는 starter가 이미 쓰는 baseline equipment**입니다.
따라서 #17 reward pool이 없어도 tutorial prefix 자체는 완결됩니다.

각 단계의 보상은 *다음* 단계가 가르칠 것을 미리 쥐여 줍니다 — T1의 방어 보상이 T2의 위치·방어
수업에, T2의 통제 보상이 T3의 기술·세이브 수업에 쓰입니다.

---

## 3. Presentation production bridge

### 고친 것

`buildTilemaps()`가 `content/m3/scenarios.json`(M4 회귀 fixture)을 읽고 있었습니다. #12가
runtime을 production selector로 옮길 때 따라오지 않은 drift이고, 그대로 두면 **신규 M7
Scenario ID의 tilemap이 생성되지 않아** `AssetCatalog.tilemap()`이 런타임에서 throw합니다.

`PRODUCTION_CONTENT.pack.scenarioSources`를 읽도록 바꿨습니다.

| | before | after |
|---|---|---|
| tilemap 입력 | `content/m3/scenarios.json` | production pack |
| 생성된 tilemap | 3 | **10** |

### 고치지 않은 것

`presentation/m3`와 `m3-atlas` 이름은 그대로 둡니다. 이슈가 명시한 대로 M7에서 output path
rename/migration을 하지 않습니다. technical debt로 남깁니다.

### assets checker

`assertVisualMap()`은 #17에서 이미 `content/m3` 대신 `PRODUCTION_CONTENT`를 읽도록 바꿨고,
production pack에 대해 **exact coverage**를 요구합니다. #16이 요구한 "M7 visual mapping
추가가 M3 exact-list와 충돌하지 않을 것"은 충족되며, 실제로는 더 강한 형태입니다 —
equipment 25종·card 32종이 모두 매핑되어야 통과합니다.

이 gate의 최종 소유는 #20이므로, #20이 `content:production-check`를 만들 때 이 검사를
그대로 옮기거나 확장하면 됩니다. #16에서 검사를 느슨하게 되돌리지 않았습니다.

---

## 4. 범위 밖

Objective는 `defeat-all-enemies` 하나만 유지합니다. 아래는 구현하지 않았습니다.

```text
survive N rounds / escort / capture / escape
hazard subsystem
branching encounter script
difficulty · XP engine
spawn scripting DSL
presentation directory · atlas rename project
second asset pipeline
```

필요해지면 후속 Rules/Presentation Expansion으로 보냅니다.
