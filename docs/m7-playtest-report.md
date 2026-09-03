# M7 Production Playtest & Balance Report

M7-10(#21)의 playtest 기록입니다. 새 Rule Engine capability를 만드는 단계가 아니라, 이미 만든
production content를 **실제로 플레이해 보고** authored 수치·배치·보상만 최소한으로 고친 뒤
Release Candidate를 확정하는 단계입니다.

```text
Build          010ee77 + 리뷰 반영 커밋 (feat/m7-content-pack-bootstrap)
Pack           cardguild.m7@0.3.0
Fingerprint    fnv1a64:887ee163d92faa57
Adventure      adventure.goblin-trouble (8 encounters, tutorial prefix 4)
Harness        npm run playtest -- --seeds 12
               432 run, 실제 실행된 encounter 2,567건 (패배 시 run이 끝나므로 최대 3,456 slot 중)
```

fingerprint가 재현의 기준입니다. 리뷰 반영 커밋은 reward 두 개의 **중간 선택지**를 서로 바꾸고
(§3.5) 검증/보고를 고쳤을 뿐이라, `first`/`last` route가 고르는 항목이 달라지지 않아 아래
432 run 수치는 `010ee77`과 동일합니다(완주 151/432).

---

## 1. 어떻게 플레이했는가

`tools/playtest/`가 production 경로를 그대로 돌립니다.

```text
createAdventureSession → buildAdventureEncounter → createCombat → dispatchCombatCommand
enemies: src/game/ai.ts chooseAiCommand   (출하되는 그 AI)
heroes : tools/playtest/hero-policy.ts    (측정 장치. src/는 이것을 import하지 않습니다)
```

seed와 party 구성만 주면 전부 재현됩니다. 새 telemetry system이나 balance solver는 만들지
않았고, hero 쪽 판단은 전부 production query(`listLegalActions`, `listLegalTargets`,
`previewAction`)로만 합니다.

### hero policy (측정의 바닥값)

행동 순서: 기립/탈출 → 60% 미만 아군 치료 → 인접 레버 작동 → 적 대상 최고 점수 행동 →
방패 올리기 → 접근 → 턴 종료. 점수는 `previewAction`의 hit chance·damage range와 authored
outcome effect에서 나오며, 2-action 행동은 2가 아니라 **1.5 action**으로 계산합니다(그 행동이
밀어내는 것은 새 Strike가 아니라 MAP이 걸린 두 번째 Strike이기 때문입니다).

이 policy는 **유능한 플레이어가 아니라 하한선**입니다. 보고서의 수치는 "이 정도 플레이로도
되는가"를 말하고, 그보다 잘 두는 사람에게는 더 쉽습니다. 아래 한계는 결과 해석에 그대로
반영해야 합니다.

| 하지 않는 것 | 결과 |
|---|---|
| 이동 카드 사용(`careful-advance`, `hover-step`, `fly`) | 기본 Stride만 씀 |
| 후퇴·kiting·엄폐 활용 | 원거리 적에게 접근하는 동안 그대로 맞음 |
| 지속 효과(`spirit-beacon`)와 아군 버프(`spirit-edge`) | 사용 정책 없음 |
| prepared card 교체 | 새 보상 카드는 **빈 슬롯이 있을 때만** 준비됨 |

`legal했는가`는 content의 성질이고 `얼마나 썼는가`는 이 policy의 성질입니다. dead card 판정은
전자를 기준으로 읽어야 합니다.

### Matrix

9개 party × (reward route 2 × loadout direction 2) = 36 spec, seed 1–12 → **432 run**.

| 축 | 값 |
|---|---|
| 1P | Aerin(vanguard) / Lyra(skirmisher) / Brom(guardian) / Nera(support) |
| 2P | Aerin+Lyra, Aerin+Nera, Brom+Lyra |
| 3P | Aerin+Lyra+Nera, Brom+Nera+Lyra |
| reward route | `first`(항상 첫 선택지) / `last`(항상 마지막 선택지) |
| loadout | `authored`(시작 장비 고정) / `adapt`(보상을 실제로 장착·준비) |

---

## 2. 결과 — 같은 seed A/B

A는 `62d44a9`(#21 이전) 콘텐츠와 AI, B는 이 작업 이후입니다. **harness와 seed는 동일**합니다.

| | A (before) | B (after) |
|---|---:|---:|
| 완주 | 64 / 432 (14.8%) | **151 / 432 (34.9%)** |
| 1P | 0 / 192 | **18 / 192** |
| 2P | 17 / 144 | **77 / 144** |
| 3P | 47 / 96 | **56 / 96** |
| encounter 평균 라운드 | 6.23 | 5.42 |
| stall(라운드 상한 도달) | 2 | **0** |
| AI no-command | 0 | 0 |
| 거절된 command | 0 | 0 |

### Encounter별 (B, 최종)

`loss`는 그 encounter에서 파티가 전멸한 run 수입니다.

| Encounter | 1P loss / runs | 1P HP손실 | 2P loss / runs | 2P HP손실 | 3P loss / runs | 3P HP손실 |
|---|---:|---:|---:|---:|---:|---:|
| road-ambush (T1) | 0 / 192 | 14.4% | 0 / 144 | 7.8% | 0 / 96 | 4.6% |
| spear-line (T2) | 20 / 192 | 27.2% | 6 / 144 | 21.7% | 0 / 96 | 11.3% |
| ruined-gate (T3) | 42 / 172 | 52.2% | 14 / 138 | 41.5% | 7 / 96 | 23.1% |
| goblin-chief (T4) | 73 / 130 | 76.0% | 2 / 124 | 21.1% | 2 / 89 | 19.2% |
| bone-cellar | 7 / 57 | 18.1% | 9 / 122 | 27.9% | 0 / 87 | 19.1% |
| wolf-run | 8 / 50 | 27.8% | 4 / 113 | 27.3% | 1 / 87 | 19.9% |
| archer-perch | 2 / 42 | 36.3% | 22 / 109 | 50.7% | 12 / 86 | 37.8% |
| cult-sanctum (finale) | 22 / 40 | 74.9% | 10 / 87 | 45.8% | 18 / 74 | 42.0% |

A에서 같은 표의 최악 셀은 `ruined-gate` 1P **116/150 전멸**, `goblin-chief` 1P **34/34**,
`archer-perch` 2P **55/79**, 그리고 `spear-line`은 **모든 party size에서 HP 손실 0.0%** 였습니다.

### Starter별 1P (B)

| Starter | 완주 | 주로 멈춘 곳 |
|---|---:|---|
| Aerin (vanguard) | 11 / 48 | goblin-chief 20, cult-sanctum 9 |
| Brom (guardian) | 5 / 48 | goblin-chief 23, cult-sanctum 11 |
| Lyra (skirmisher) | 2 / 48 | goblin-chief 22, ruined-gate 11 |
| Nera (support) | 0 / 48 | ruined-gate 24, spear-line 14 |

A에서는 넷 다 0/48이었고 T1 `road-ambush`에서만 40번 전멸했습니다. **hard lock(진행 불가능)은
A/B 어디에도 없습니다** — 전부 전투 패배이고, 재시도로 진행됩니다. 완주 예시(1P Aerin, seed 6,
`first`/`authored`): road-ambush 3R/0% → spear-line 2R/0% → ruined-gate 3R/38% →
goblin-chief 4R/24% → bone-cellar 7R/24% → wolf-run 3R/0% → archer-perch 2R/19% →
cult-sanctum 2R/38% → **victory**.

---

## 3. 고친 것 (#21 tuning order 순서대로)

### 3.1 AI priority production bug — tuning order 8

`goblin-spearman`이 **매 턴 3 action을 전부 Trip에 썼습니다**. -5, -10 MAP까지 같은 innate를
반복하고 authored Strike는 한 번도 나오지 않아, `spear-line`은 모든 party size에서 HP 손실
0.0%인 무해한 treadmill이었습니다(A 표 참조). `skeleton-guard`의 두 번째 innate(`knockdown`)도
같은 이유로 전투에 등장하지 못했습니다.

수정은 generic 규칙 하나입니다 — **innate action은 한 턴에 한 번**. creature별 script나 DSL,
새 state는 없습니다. 이미 CombatState에 있는 `commandLog`에서 이번 턴 기록을 읽습니다.

```text
Goblin Spearman의 한 턴:  trip → strike → strike → end-turn   (이전: trip → trip → trip)
```

#15 `creature-ai.test.ts`가 이 회귀를 소유합니다(테스트 추가).

### 3.2 Encounter party-size composition — tuning order 1

세 encounter가 **party size에 따라 전혀 조정되지 않아** 1P가 사실상 불가능했습니다.

| Encounter | 변경 | 근거 |
|---|---|---|
| `road-ambush` | 1P는 `goblin-lackey`, 2P+는 `goblin-skirmisher` (같은 타일, 배타 range) | T1에서 1P 전멸 40/192 |
| `ruined-gate` | `goblin-brute` → 2P+ | 1P 전멸 116/150 |
| `goblin-chief` | `goblin-brute` → 3P only | 1P 34/34, 2P 52/131 전멸 |
| `bone-cellar` | `skeleton-rabble-a` → 2P+ | 1P 전멸 12/22 |
| `wolf-run` | `wolf-yearling-a` → 2P+ | 1P 8/8 전멸 |
| `archer-perch` | `bone-priest` → 2P+, `skeleton-archer-b` → 3P only | 1P 8/8, 2P 55/79 전멸 |
| `cult-sanctum` | `cult-firebrand` → 2P+, `cult-initiate-a` → 3P only, `cult-initiate-b` → 3P only | 1P/2P 전멸률 100%/2-of-3 |

`road-ambush`는 #16이 만든 applicability가 **머릿수를 더하는 것 말고도 쓸 수 있다**는 것을
보여줍니다. range가 겹치지 않는 두 placement가 같은 타일을 공유하므로, 혼자 온 파티는 Lackey를
만나고 파티는 Skirmisher를 만납니다.

### 3.3 Creature fixed stats — tuning order 3

| 대상 | 변경 | 근거 |
|---|---|---|
| `goblin-chief` | maxHp 34 → 28, 공격 +9 → +8, 피해 1d10+4 → 1d10+3 | 배치를 1마리까지 줄여도 1P 전멸 85%. finale보다 위협이 높아 escalation도 역전돼 있었음 |
| `goblin-lackey` | maxHp 10 → 16 | T1이 **한 방에 끝나** 3-action 턴을 가르칠 시간이 없었음 (A/B: 1P 평균 2.27R → 3.10R, 전멸 0 유지) |

### 3.4 Starter 수치 — tuning order 6

`hero.lyra` ancestryHp 6 → 8 (maxHp 15 → 17). Goblin Skirmisher의 크리티컬 최대 피해가 16이라
**만피에서 한 방에 죽는 유일한 Starter**였습니다.

### 3.5 Reward 선택지 — tuning order 7

여섯 개 offer에 각각 **네 번째 선택지**를 더했습니다. 어떤 offer도 강해지지 않고 넓어지기만
합니다.

| Offer | 추가 | 열리는 것 |
|---|---|---|
| road-ambush | `card.force-barrage` | 근접 전용 파티의 원거리 한 수 |
| spear-line | `card.fear` | 통제 축 세 번째 |
| ruined-gate | `card.vicious-swing` | 무기 압박 축 |
| goblin-chief | `dueling-rapier` | **defensive duelist** 방향 + `card.dueling-parry` provider |
| wolf-run | `scout-leather` | **dex controller** 방향 |
| archer-perch | `spiked-shield` | `card.shield-press` provider |

### 선택지를 더하는 것만으로는 방향이 열리지 않는다

**보상은 진열대가 아니라 하나를 고르는 자리입니다.** 같은 offer 안의 두 item은 한 run에서 동시에
가질 수 없으므로, "전부 어딘가에 등장한다"와 "한 run에서 모을 수 있다"는 다른 문제입니다. 처음 이
검증을 union으로 짜서 다섯 방향이 열렸다고 적었지만, 실제 제약을 넣으면 두 방향이 막혀 있었습니다.

```text
DEX controller     flick-mace + scout-leather + striders-boots
                   → scout-leather와 striders-boots가 둘 다 Wolf Run offer
Defensive duelist  dueling-rapier + buckler + warding-charm
                   → buckler와 warding-charm이 둘 다 Archer Perch offer
```

그래서 두 offer의 **중간 선택지를 서로 바꿨습니다** — `striders-boots`는 Archer Perch로,
`warding-charm`은 Wolf Run으로. offer의 개수도 강도도 그대로이고, `first`/`last` route가 고르는
항목(각 offer의 처음과 마지막)도 그대로입니다. 이제 다섯 방향 모두 **서로 다른 offer에서 하나씩**
모을 수 있습니다.

| Direction | 어느 offer에서 | 가능? |
|---|---|---|
| heavy breaker | greatsword(Chief) + tower-shield(Perch) | ✅ |
| party support | medics-kit(Wolf) | ✅ |
| spell skirmisher | throwing-axes(Chief) + hexers-focus(Wolf) | ✅ |
| dex controller | flick-mace(Chief) + scout-leather(Wolf) + striders-boots(Perch) | ✅ (교환 후) |
| defensive duelist | dueling-rapier(Chief) + buckler(Perch) + warding-charm(Wolf) | ✅ (교환 후) |

`m7-vertical-slice.test.ts`는 이제 union이 아니라 **offer마다 최대 하나를 배정하는 매칭**으로
feasibility를 계산합니다. 교환을 되돌리면 그 테스트는 3개만 보고하며 실패합니다.

### 3.6 되돌린 것

`ruined-gate`의 web 타일을 통로에서 옆으로 옮겨 봤습니다(터레인이 통행세가 아니라 선택이 되도록).
같은 seed A/B에서 **2P 전멸 8 → 18로 악화**했습니다 — 그 web은 파티만큼이나 문을 통과하는 적을
붙잡고 있었습니다. 되돌렸고, 그대로 둡니다.

---

## 4. AI Review

432 run · 17,500 creature turn 기준입니다.

- **no-legal-plan / no-command: 0건.** 거절된 command도 0건.
- authored role이 전투에 드러납니다: `bone-priest` mend-bone 371회(아군 회복),
  `cult-hierophant` soothing-litany 518 / terrifying-howl 1,346, `dire-wolf` trip 1,099,
  `goblin-brute` knockdown 1,098, `skeleton-guard` trip 1,893 + knockdown 1,499.
- 3.1 수정 전에는 `skeleton-guard`의 knockdown이 0회, `goblin-spearman`의 strike가 0회였습니다.
- support creature가 support를 씁니다: 적 회복 371회, 적 measure로 frightened 7,533 / prone
  4,002 / grabbed 1,968회 적용.
- 무행동 턴은 `goblin-brute` 243, `goblin-skirmisher` 202건인데 전부 `ruined-gate`에서
  **문이 열리기 전** 갇힌 턴입니다. 문을 여는 것이 그 encounter의 과제이므로 defect가 아닙니다.
- ranged creature가 불필요하게 접근하지 않습니다 — `skeleton-archer`는 60ft Strike를 그대로 씁니다.

AI를 더 영리하게 만들지 않았습니다. 3.1은 **authored role이 보이지 않는 버그**를 고친 것입니다.

---

## 5. Content health

### Card

| 상태 | 카드 |
|---|---|
| 실제로 플레이됨 (상위) | combat-grab 4,280 · iron-presence 3,611 · demoralize 3,376 · heal 1,072 · brace-behind-cover 889 · soothe 688 · force-barrage 615 · battle-medicine 341 · fear 215 · lay-on-hands 173 · reactive-strike 153 · **shield-press 111** · grapple 99 · trip 90 · **dueling-parry 59** |
| 손에는 왔지만 policy가 쓰지 않음 | careful-advance, fly, hover-step (이동 카드), intimidating-strike, knockdown (2-action Strike, 점수가 기본 Strike와 1점 이내), slip-free (context escape-grab이 먼저), spirit-beacon (지속 효과 정책 없음) |
| 이번 run에서 손에 오지 않음 | aimed-shot, arcane-ward, daze, ember-lash, frostbite, harm, spirit-edge, spirit-lance, telekinetic-projectile, vicious-swing |

마지막 줄은 세 종류가 섞여 있습니다.

- `spirit-lance`(171회 획득)와 `vicious-swing`(172회)은 **보상으로는 실제로 선택됐지만 준비되지
  못했습니다.** Starter마다 prepared 여유 슬롯이 하나뿐이라 **첫 카드 보상 이후의 카드 보상은
  1P에서 갈 곳이 없습니다.** content 문제이자 harness 한계입니다(§6-1).
- `arcane-ward`는 Ruined Gate offer의 **중간 선택지**입니다. 이 matrix의 route는 `first`와
  `last` 둘뿐이라 중간 선택지는 애초에 선택되지 않습니다 — 도달 불가능한 것이 아니라
  **이번 matrix가 시험하지 않은** 선택지입니다. equipment 쪽에서는 `striders-boots`·
  `warding-charm`·`greatsword`·`flick-mace`·`buckler`·`hexers-focus`가 같은 위치에 있습니다.
- `aimed-shot`, `daze`, `ember-lash`, `harm`, `spirit-edge`, `telekinetic-projectile`은
  #20의 explicit reserve로 남습니다. 이유와 후속 issue가 `tools/content/m7-production-policy.ts`에
  기록돼 있습니다.

`shield-press`와 `dueling-parry`는 3.5의 provider 노출로 **처음으로 실전에서 쓰였습니다**.

### Equipment / reward

- 보상 선택은 route에 따라 고르게 나뉩니다: `dueling-rapier` 136, `throwing-axes` 130,
  `medics-kit` 119, `scout-leather` 118, `tower-shield` 101, `spiked-shield` 100. 각 offer의
  중간 선택지는 `first`/`last` route가 건드리지 않으므로 이 수치에 나타나지 않습니다.
- 실제 장착까지 간 보상: `dueling-rapier`(172 encounter-instance), `spiked-shield`(48),
  `medics-kit`(21). `scout-leather`는 118번 획득됐지만 harness의 장비 점수가 leather-armor보다
  높게 보지 않아 한 번도 장착되지 않았습니다 — **보상이 곧 상위 호환은 아니라는** 신호이며,
  DEX controller 방향은 사람이 의도적으로 조립해야 완성됩니다.
- 216개 run이 실제로 `set-member-loadout`을 실행했고, 그중 **38개 완주 run이 장비를 바꾼 뒤에도
  완주**했습니다(1P 7, 2P 22, 3P 9).
- 보상은 다음 전투를 실제로 바꿉니다: `adapt` route는 `authored`와 다른 카드/장비로 싸우고,
  1P에서는 `adapt`가 10/96 대 8/96으로 근소하게 앞섭니다.

### Dominant build 여부

지배적인 Starter나 build는 보이지 않습니다. 1P 완주율은 Aerin 11 > Brom 5 > Lyra 2 > Nera 0으로
벌어지지만, 이것은 **역할 정체성**(전열 > 방어 > 기동 > 지원)이 solo에서 드러난 것이고 2P/3P에서는
Nera가 포함된 조합이 가장 안정적입니다(3P `authored` 34/48). reward route(`first` 대 `last`)의
완주율 차이도 2P 42:35, 3P 30:26으로 한쪽이 지배하지 않습니다.

---

## 6. Follow-up (이번에 고치지 않은 것)

1. **카드 보상과 prepared capacity** — Starter마다 여유 슬롯이 하나뿐이라 세 번의 카드 보상 중
   두 번째·세 번째가 1P에서 준비되지 못합니다. capacity를 늘릴지, 보상 카드를 줄일지, 아니면
   교체 UI로 해결할지는 balance가 아니라 설계 판단입니다.
2. **`goblin-chief` 1P 전멸률 56%** — 배치는 이미 1마리, 수치도 한 번 낮췄습니다. 더 낮추면
   2P/3P(전멸률 각각 1.6%, 2.2%)가 무의미해집니다. solo가 가장 어려운 모드라는 사실을 그대로
   두고 기록합니다.
3. **`cult-sanctum` 1P 55%, `archer-perch` 2P 20%** — finale과 원거리 압박 encounter가 각각
   가장 어려운 셀입니다. hero policy가 엄폐와 후퇴를 쓰지 않는다는 점을 감안해야 합니다.
4. **Nera solo 0/48** — 지원가의 solo 화력이 낮습니다(WIS 기반, 활 1d6, 근접 아군 없음).
   `battle-medicine`·`soothe`는 ally 대상이라 solo에서 사용 불가입니다. 지원가 정체성을 지키면서
   solo를 열려면 self-target 회복이나 화력 옵션이 필요하고, 이는 #13 카드 계약에 손대는 판단입니다.
5. **web 지형 DC 15** — `engine.ts`에 상수로 있어 authored content가 아닙니다. 지형 난이도를
   조정하려면 rule backflow가 필요합니다.
6. **harness 개선 여지** — 이동 카드, 엄폐, 후퇴, prepared card 교체. 지금 수치는 하한선입니다.

---

## 7. Release Candidate

```text
npm run content:check              OK  (m4@0.6.0, m6@0.9.0, m7@0.3.0)
npm run content:production-check   OK  (4 starters, 14 enemies, 26 player cards, 21 player equipment,
                                        reserve 16 — 각 항목에 이유와 후속 issue)
npm run assets:check               OK  (110 frames, 22 two-sided actors, 10 tilemaps)
npm run test:unit                  OK  (CI 기준 25 files / 295 tests)
npm run test:network               OK  (8 tests, production pack으로 실제 WebSocket 세션 완주)
npm run test:smoke                 OK  (11 Playwright tests)
```

M6 회귀 fixture는 generic `content:check`로만 검증되며 M7 volume/reachability 정책과 결합되지
않습니다. deterministic seed / replay / content identity는 유지됩니다 — 같은 seed는 같은 run을
만들고(432 run 재현), fingerprint는 상단과 같은 `fnv1a64:887ee163d92faa57`입니다.

### Exit criterion — 실제 loadout 변화를 포함한 완주

`1P guardian / last reward / adapt loadout`, **seed 2**. 보상을 받는 데서 끝나지 않고 그것을
실제로 **입고 준비한 뒤** 남은 encounter를 지나 finale까지 갑니다.

```text
Brom 시작        weapon guardian-mace / armor half-plate / shield shield / prepared [grapple]

reward 1 road-ambush → card.force-barrage
  set-member-loadout  prepared += card.force-barrage        (spear-line 시작 전)
reward 2 spear-line   → card.fear
reward 3 ruined-gate  → card.vicious-swing
reward 4 goblin-chief → dueling-rapier
reward 5 wolf-run     → scout-leather
reward 6 archer-perch → spiked-shield
  set-member-loadout  shield: shield → spiked-shield        (cult-sanctum 시작 전)

road-ambush 3R/0%  spear-line 8R/46%  ruined-gate 5R/27%  goblin-chief 2R/0%
bone-cellar 5R/0%  wolf-run 6R/0%     archer-perch 6R/31%  cult-sanctum 6R/58% → victory

Brom 종료        weapon guardian-mace / armor half-plate / shield spiked-shield
                 prepared [grapple, card.force-barrage]
```

`card.force-barrage`는 T2부터 일곱 전투를 함께 지났고, `spiked-shield`는 finale을 앞두고 기본
방패를 대체했습니다(그 자체가 `card.shield-press`의 provider입니다). 즉 이 한 run이
**onboarding → reward/loadout 변화 → main progression → elite → boss → victory**를 전부
지납니다. `authored` route의 완주 사례(예: 1P Aerin seed 6)는 같은 경로를 지나되 시작 장비를
그대로 유지하므로, exit statement는 위 `adapt` run을 기준으로 합니다.

1P/2P/3P representative playtest와 Production Gate는 모두 통과합니다.
