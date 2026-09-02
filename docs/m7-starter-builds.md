# M7 Starter Characters & Build Kits

M7-3(#14)의 Starter 설계 기록입니다. **4명은 동시에 쓰는 4인 파티가 아니라 Party Builder에서
고를 수 있는 roster**이고, runtime party size는 계속 1–3P입니다.

이 이슈는 새 Action/Rule/Equipment를 만들지 않습니다. #13이 만든 32-card library와 이미
존재하는 equipment를 **누가 무엇으로 시작하는가**로 배치할 뿐입니다.

| Issue | 소유 범위 |
|---|---|
| #13 | 어떤 Card/Action이 존재하는가 |
| **#14** | **누가 어떤 fixed card/equipment kit으로 시작하는가** |
| #17 | 어떤 추가 equipment/reward sidegrade가 존재하는가 |
| #19 | Adventure reward로 어떤 새 ownership을 얻는가 |

---

## 1. Build Matrix

아래 파생 수치는 각 Starter의 시작 loadout으로 `deriveLoadoutSnapshot()`이 실제로 계산한
값입니다. actor JSON에는 최종 AC/HP/Strike/DC를 저장하지 않습니다.

| | **Aerin** | **Lyra** | **Brom** | **Nera** |
|---|---|---|---|---|
| Primary role | Vanguard | Skirmisher | Guardian | **Tactician / Support** |
| Key attribute | STR 3 | DEX 4 | CON 4 / STR 3 | **WIS 4** |
| Strong saves | 균등 trained | 균등 trained | **Fortitude expert** | **Will expert** |
| Strong skills | Athletics expert | Acrobatics·Stealth expert | **Athletics master** | **Medicine·Diplomacy expert** |
| Weakness | heavy armor untrained, CHA 0 | **HP 15 최저**, medium/heavy untrained | **initiative 2 최저**, WIS -1, skill 폭 최소 | **AC 16 최저**, **Athletics 0**, STR 0, 방패 없음 |
| Weapon / armor style | martial **expert** · reach 10ft · medium + shield | martial trained · agile/finesse · light only | martial trained · **heavy expert** + shield | martial trained · **ranged 60ft** · light only |
| Derived HP / AC | 21 / 18 | 15 / 18 | **26 / 20** | 18 / **16** |
| Derived Class DC | 16 | 17 | 16 | **19** |
| Derived initiative | 6 | 8 | 2 | **9** |
| Derived Strike | Halberd +8, 1d10+3, 10ft | Light Blade +7, 1d6+2, 5ft | Guardian Mace +6, 1d8+3, 5ft | Shortbow **+5, 1d6+0**, 60ft |
| Base card grants | Spirit Beacon ×2, Reactive Strike ×1 | Spirit Beacon ×1, Hover Step ×2, Careful Advance ×1 | Reactive Strike ×2, Brace Behind Cover ×2, Demoralize ×2 | Heal ×2, Soothe ×2 |
| Starter prepared | Knockdown, Intimidating Strike | Slip Free, Combat Grab | Grapple | Battle Medicine, Lay on Hands, Iron Presence |
| Capacity / free | 3 / **1** | 3 / **1** | 2 / **1** | 4 / **1** |
| Starter equipment | Halberd · Scale Mail · Shield · Boots of Fly | Light Blade · Leather Armour · Boots of Fly | Guardian Mace · Half Plate · Shield | Composite Shortbow · Leather Armour |
| Deck size | 10 | 8 | 7 | 7 |
| Primary loop | 10ft reach에서 Trip/Knockdown으로 전선을 눕히고 Reactive Strike로 이탈을 처벌 | Hover Step·Fly로 각을 잡고 agile/finesse로 연타 | Brace 후 버티며 Athletics master로 Grapple 고정 | 후열에서 Heal/Soothe로 파티를 유지하고 Iron Presence로 통제 |
| Secondary loop | Spirit Beacon 유지 | Slip Free로 구속 탈출, Combat Grab으로 고정 | Demoralize로 광역 압박 | 60ft Strike로 최소한의 압박 |
| Known limitations | 무거워 이동 선택지가 적음 | HP가 낮아 반격 한 번에 무너짐 | 거의 항상 마지막에 행동 | Trip/Grapple/Slip Free를 **영구히 못 씀** |

## 2. 각 Starter의 명시적 약점

범용 캐릭터를 만들지 않기 위해 넷 모두 "쓸 수 없는 선택지"를 갖습니다.

| Starter | 구조적으로 막힌 것 |
|---|---|
| Aerin | heavy armor untrained → Half Plate로 갈아입어도 AC가 오르지 않음. CHA 0이라 Demoralize 계열이 약함 |
| Lyra | medium/heavy untrained → AC 성장 경로가 light 하나뿐. HP 15로 최저 |
| Brom | initiative 2 → 거의 항상 적 다음에 행동. WIS -1, skill 6종만 trained이라 skill 카드 폭이 좁음 |
| Nera | **Athletics untrained(+0)** → Trip·Grapple·Combat Grab이 사실상 실패. STR 0이라 Strike damage 보정이 0. 방패 슬롯이 비어 AC 16 |

Nera의 Athletics 0은 실수가 아니라 설계입니다. #13 라이브러리에서 Athletics 기반 통제
카드군 전체가 그녀에게 닫히고, 그 대가로 **Class DC 19**(다른 셋은 16–17)와 유일한 회복
카드군을 갖습니다.

## 3. 왜 Tactician이 신규 장비 없이 성립하는가

이슈는 "4번째 Starter가 신규 equipment 없이는 성립하지 않는다면 현재 baseline으로 성립하는
Tactician/Support 컨셉을 선택"하라고 했습니다. Nera는 **기존 정의만** 씁니다.

| 필요한 것 | 어떻게 충족했는가 |
|---|---|
| 후열 압박 | `composite-shortbow` (baseline, 60ft) |
| 낮은 방어 | `leather-armor` (baseline) + 방패 슬롯 공란 |
| 회복 축 | `card.heal`, `card.soothe`, `card.lay-on-hands`, `card.battle-medicine` — 전부 #13 production card |
| Class DC 축 | `card.iron-presence` — #13이 Class DC 전용 축으로 만든 카드 |
| 발 슬롯 | **의도적으로 비움** |

발 슬롯을 비운 것은 #19가 채울 자리를 남긴 것입니다. #17의 `medics-kit`(Battle Medicine
제공)이 정확히 그 reward이며, #14가 그것을 starter로 가져가면 #17의 reward 분류가 깨집니다.

`card.battle-medicine`은 `skill-rank medicine trained` requirement를 갖는데 Nera는 expert라
충족합니다. 1P 단독 플레이에서는 ally가 없어 legal target이 없지만, Strike·Stride·
`card.lay-on-hands`(creature targeting은 자신을 포함)가 남아 행동이 막히지 않습니다.

## 4. Prepared capacity를 다 채우지 않은 이유

넷 모두 **최소 1칸을 비워** 둡니다. `createStartingCollection()`은 starter equipment와
starter preparedCards만 collection에 넣으므로, 시작 시점에는 교체할 카드 자체가 없습니다.
빈 칸은 #19 reward가 collection에 카드를 추가한 뒤에야 의미가 생깁니다.

| Starter | capacity | 사용 | 남김 |
|---|---:|---:|---:|
| Aerin | 3 | 2 | 1 |
| Lyra | 3 | 2 | 1 |
| Brom | 2 | 1 | 1 |
| Nera | 4 | 3 | 1 |

capacity 자체를 role에 맞춰 다르게 줬습니다. Nera는 raw power가 가장 낮은 대신 선택지가
가장 많고, Brom은 반대입니다.

## 5. Deck 하한

`createCombat()`은 시작 시 6장을 나눠 줍니다. 덱이 6장보다 작으면 첫 손패가 모자라므로
**모든 Starter의 덱이 최소 6장**이 되도록 base grant 수량을 맞췄습니다 (실제 7–10장).
이 하한은 회귀 테스트로 고정되어 있습니다.

## 6. Party Builder

`playable` trait을 가진 Actor가 후보입니다. 이제 4명이 표시되고, party slot은 그대로 3개라
1P/2P/3P 조합이 모두 legal합니다. 기본 draft는 정렬 순서상 여전히 Aerin·Lyra·Brom입니다.

Party Builder의 역할 라벨은 archetype을 content에 태깅하지 않고 **파생 신호**로 판정합니다.
support 판정은 "시작 카드 중 `restore-hp` effect를 가진 것이 있는가"로, AI가 support action을
찾을 때 쓰는 것과 같은 검사입니다. Nera만 해당하며 `Field support`로 표시됩니다.

회복 판정을 속도·내구 판정보다 먼저 두었습니다. Nera는 initiative 9에 경장갑이라 그렇게
하지 않으면 `Mobile skirmisher`로 잘못 분류됩니다.

## 7. Starter kit이 드러낸 HUD 결함

Aerin의 시작 덱에 `Intimidating Strike`가 들어가자 1024×768에서 battlefield 레이아웃이
깨졌습니다. 원인은 카드 이름 길이였습니다.

```text
.tactical-card { grid-template-rows: auto minmax(2.6rem, 1fr) auto; min-height: 7.4rem; }
```

첫 행이 `auto`라 긴 이름이 두 줄로 감기면 카드가 커지고, hand dock이 **126.9px → 145.9px**로
자랍니다. 보드는 dock을 피해 줄어드는데 그 사이의 `board-prompt`가 따라 올라가면서 보드
하단과 5px 겹쳤습니다.

카드 높이를 `height: 7.4rem`으로 고정하고 설명 행이 남는 공간을 흡수하도록 바꿨습니다.
이제 카드 높이가 이름 길이와 무관하므로 #19가 어떤 이름의 카드를 추가해도 HUD가 흔들리지
않습니다. 이름을 줄이거나 자르는 대신 레이아웃을 고친 이유는, 카드 이름이 게임에서 읽혀야
하는 정보이기 때문입니다.

같이 고친 것: `waitForRoadTurn()`이 reaction 모달 가시성을 확인한 뒤 클릭하기까지의 사이에
authoritative server가 창을 닫으면 그대로 timeout이 났습니다. 사라진 버튼은 실패가 아니라
이미 해소된 반응이므로 클릭 실패를 허용하도록 바꿨습니다.

## 8. 범위 밖

- 신규 EquipmentDefinition 없음 (#17 소유)
- 신규 Action/Card 없음 (#13 소유)
- Adventure reward 연결 없음 (#19 소유)
- starting card candidate pool 없음 — 현재 `createStartingCollection()` 계약에 존재하지 않는
  개념이라 만들지 않았습니다
- class progression / spell slot / Focus Point 없음

Tutorial 완주와 reward 이후 build choice는 #18/#19/#21에서 검증합니다.
