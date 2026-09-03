# M7 Creature Roster & AI Coverage

> **설계 근거 기록입니다.** 콘텐츠를 추가·수정하는 절차와 현재 계약은
> [`docs/PRODUCTION-BLUEPRINT.md`](PRODUCTION-BLUEPRINT.md)에 있습니다. 이 문서는 왜 지금
> 이 수치와 구성인지 알고 싶을 때만 읽으면 됩니다.

M7-4(#15)의 creature role matrix이자 AI 소비 경계 기록입니다.

Creature는 Character 공식을 재사용하지 않고 `statProfile.kind = "creature"`의 top-down
fixed-stat 계약을 유지합니다. Creature level / XP budget은 M7 runtime schema에 넣지 않고,
AoN은 stat 복제가 아니라 **role과 threat calibration 참고**로만 사용합니다.

- Choosing Creatures — https://2e.aonprd.com/Rules.aspx?ID=2718
- Encounter XP Budget — https://2e.aonprd.com/Rules.aspx?ID=2717

실제 Encounter 배치와 도달 가능성은 #16/#20이 검증합니다. #15는 **creature가 존재하고 AI가
그 authored action을 실제로 사용하는 것**까지 책임집니다.

---

## 1. Roster (18종)

Stat band는 기존 goblin 3종(AC 16–18 / HP 18–34)을 기준으로 잡았습니다.

| Creature ID | Visual family | Role | AC / HP / Speed | Strike | Innate (ordered) | AI behavior expectation | AoN role note | Backflow |
|---|---|---|---|---|---|---|---|---|
| `enemy.goblin-lackey` | goblin | Lackey | 14 / 10 / 25 | Rusty Dagger +5, 5ft, 1d4+1 P | — | Strike 아니면 접근. 수로 압박 | Goblin Warrior 하위 | — |
| `enemy.skeleton-rabble` | undead | Lackey | 15 / 12 / 25 | Chipped Sword +5, 5ft, 1d6+1 S | — | 동일 | Skeleton Guard 하위 | — |
| `enemy.wolf-yearling` | beast | Lackey | 15 / 11 / 35 | Bite +5, 5ft, 1d6+1 P | — | 빠른 접근으로 전선을 흐트러뜨림 | Wolf 하위 | — |
| `enemy.cult-initiate` | cultist | Lackey (caster) | 15 / 12 / 25 | Ritual Knife +4, 5ft, 1d4+1 P | `hex-bolt` | 30ft에서 basic-save 피해, 근접하면 Strike | Cultist | — |
| `enemy.goblin-skirmisher` *(기존)* | goblin | Skirmisher | 16 / 18 / 25 | Goblin Blade +6, 5ft, 1d6+2 S | — | 접근 후 Strike | Goblin Warrior | — |
| `enemy.dire-wolf` | beast | Skirmisher | 17 / 22 / 40 | Savage Bite +8, 5ft, 1d8+3 P | `terrifying-howl`, `trip` | 30ft에서 겁주고, 붙으면 Trip으로 넘어뜨림 | Wolf / Dire Wolf | — |
| `enemy.cave-spider` | beast | Skirmisher | 16 / 14 / 30 | Fang +6, 5ft, 1d4+2 P | `web-spit` | 거미줄로 묶고 물어뜯음 | Giant Spider 하위 | — |
| `enemy.goblin-brute` *(기존)* | goblin | Brute | 17 / 24 / 20 | Heavy Club +7, 5ft, 1d8+3 B | `knockdown` | 붙으면 Knockdown 우선 | Goblin Commando | — |
| `enemy.bone-hulk` | undead | Brute | 17 / 32 / 20 | Bone Maul +8, 5ft, 1d10+4 B | `knockdown` | 느리지만 HP·피해가 높음 | Skeletal Giant 하위 | — |
| `enemy.giant-spider` | beast | Brute | 17 / 26 / 25 | Venom Fang +7, 5ft, 1d8+3 P | `grapple`, `web-spit` | 붙잡아 고정한 뒤 물어뜯음. 사거리 밖이면 거미줄 | Giant Spider | poison rider는 D8 |
| `enemy.goblin-spearman` | goblin | Soldier (reach) | 17 / 20 / 25 | Long Spear +6, **10ft**, 1d8+2 P | `trip` | 10ft에서 Trip으로 전선 통제 | Goblin Commando | — |
| `enemy.skeleton-guard` | undead | Soldier (reach) | 18 / 22 / 20 | Guard Halberd +7, **10ft**, 1d10+3 S | `trip`, `knockdown` | Trip 실패 시 Knockdown | Skeleton Guard | — |
| `enemy.goblin-slinger` | goblin | Ranged | 15 / 14 / 25 | Sling Stone +6, **30ft**, 1d6+2 B | — | 접근하지 않고 Strike | Goblin Warrior (ranged) | — |
| `enemy.skeleton-archer` | undead | Ranged | 16 / 16 / 25 | Bone Bow +7, **60ft**, 1d6+2 P | — | 보드 반대편에서도 Strike | Skeleton Archer | — |
| `enemy.cult-firebrand` | cultist | Ranged (control) | 16 / 18 / 25 | Ember Brand +5, **20ft**, 1d6+2 fire | `hex-bolt`, `terrifying-howl` | 피해 우선, 사거리 밖이면 공포 | Cultist caster | — |
| `enemy.goblin-chief` *(기존)* | goblin | Elite | 18 / 34 / 25 | Chief's Glaive +9, **10ft**, 1d10+4 S | `knockdown`, `demoralize` | 붙으면 Knockdown, 멀면 Demoralize | Goblin Chief | — |
| `enemy.bone-priest` | undead | Elite (support) | 17 / 24 / 25 | Void Touch +6, 5ft, 1d6+2 void | `mend-bone`, `hex-bolt` | 다친 아군 우선 회복, 없으면 주술 | Undead cleric | — |
| `enemy.cult-hierophant` | cultist | Elite (support) | 18 / 30 / 25 | Ritual Staff +7, 5ft, 1d8+3 B | `soothing-litany`, `terrifying-howl`, `hex-bolt` | 회복 → 공포 → 피해 순 | Cult leader | — |

### Role mix

| Role | 수 | Creature |
|---|---|---|
| Lackey / swarm | 4 | goblin-lackey, skeleton-rabble, wolf-yearling, cult-initiate |
| Skirmisher / mobile | 3 | goblin-skirmisher, dire-wolf, cave-spider |
| Brute / high-HP | 3 | goblin-brute, bone-hulk, giant-spider |
| Soldier / reach-control | 2 | goblin-spearman, skeleton-guard |
| Ranged | 3 | goblin-slinger, skeleton-archer, cult-firebrand |
| Elite / leader / support | 3 | goblin-chief, bone-priest, cult-hierophant |

### Mechanical variant 사유

같은 role 안에서도 아래 축이 실제 encounter decision을 다르게 만듭니다. AC/HP만 다른
palette swap은 없습니다.

| 비교 | 실제 차이 |
|---|---|
| goblin-lackey / skeleton-rabble / wolf-yearling | speed 25 / 25 / **35**, save 편중(Reflex↔Fortitude), damage die 1d4↔1d6 |
| goblin-slinger / skeleton-archer | 사거리 **30ft ↔ 60ft**. archer는 이 맵에서 접근이 아예 필요 없음 |
| goblin-spearman / skeleton-guard | 둘 다 10ft reach지만 guard는 AC 18에 `trip` 실패 시 `knockdown` 2차 선택지를 가짐 |
| cave-spider / giant-spider | 같은 `web-spit`이지만 spider는 `grapple`을 먼저 시도해 근접 고정으로 역할이 바뀜 |
| bone-priest / cult-hierophant | 회복량(1d8 ↔ 1d10+2)과 action cost(1 ↔ 2), hierophant는 공포까지 3단 선호 |

---

## 2. Innate actions

모두 #13에서 승인된 capability만 사용하며 새 primitive를 만들지 않았습니다.

| Action | 재사용/신규 | Resolution | 사용 creature |
|---|---|---|---|
| `knockdown` | 기존 | Strike + Prone outcome | goblin-brute, goblin-chief, bone-hulk, skeleton-guard |
| `trip` | 기존 | Athletics vs Reflex DC → Prone | dire-wolf, goblin-spearman, skeleton-guard |
| `grapple` | 기존 | Athletics vs Fortitude DC → Grabbed | giant-spider |
| `demoralize` | 기존 | Intimidation vs Will DC → Frightened | goblin-chief |
| `mend-bone` | 신규 | Direct `restore-hp` 1d8, ally 30ft | bone-priest |
| `soothing-litany` | 신규 | Direct `restore-hp` 1d10+2, ally 30ft | cult-hierophant |
| `terrifying-howl` | 신규 | 대상 Will vs actor Intimidation DC → Frightened 1/2/3 | dire-wolf, cult-firebrand, cult-hierophant |
| `web-spit` | 신규 | 대상 Reflex vs actor Athletics DC → Grabbed | cave-spider, giant-spider |
| `hex-bolt` | 신규 | 대상 Reflex **basic save** → 1d6 fire | cult-initiate, cult-firebrand, bone-priest, cult-hierophant |

신규 5종(`mend-bone`, `soothing-litany`, `terrifying-howl`, `web-spit`, `hex-bolt`)은 전부
기존 `check` / `direct` resolution과 `apply-condition` / `damage` / `restore-hp` primitive만
씁니다.

---

## 3. AI 소비 경계

`chooseAiCommand()`는 authoritative query만 소비하고 modifier/DC/range/requirement를
재계산하지 않습니다.

```text
listLegalActions()  →  무엇이 지금 가능한가
listLegalTargets()  →  누구를 고를 수 있는가
(둘 다 내부적으로 buildResolvedActionPlan()을 통과한 결과)
```

### 선택 순서

```text
1. Context recovery      stand / escape-grab
2. Ordered innate        innateActionIds 순서대로
3. Basic Strike          Fixed Strike의 사거리가 곧 도달 범위
4. Stride                거리가 실제로 줄어드는 칸만
5. End Turn
```

### AI가 아는 action ID

AI가 이름으로 아는 것은 **universal basic/context action** 4개뿐입니다.

```text
stand, escape-grab   상태 해소
strike, stride       모든 Actor의 기본 fallback
```

production innate action ID는 **하나도 하드코딩하지 않습니다.** 새 creature ability를
추가할 때 `src/game/ai.ts`를 수정할 필요가 없습니다.

### innateActionIds = AI preference

별도 `aiPriority` schema를 만들지 않고 authoring 순서를 그대로 씁니다. 이 순서는 gameplay
rule이 아니라 deterministic preference입니다.

```text
goblin-chief: ["knockdown", "demoralize"]
  붙어 있으면 → knockdown
  10ft 밖 30ft 안 → knockdown이 legal하지 않으므로 demoralize
```

### Targeting별 정책

| targeting | AI 정책 |
|---|---|
| `self` / `none` | 그대로 사용 |
| `enemy` | `listLegalTargets()`의 첫 legal target (id 정렬이라 deterministic) |
| `ally` / `creature` | **`restore-hp`를 포함한 action만** 사용. 같은 팀 + `hp < maxHp`인 대상만 후보. 결손 비율 → id 순 |
| `tile` / `object` / `effect` | 정책 없음 → 건너뜀 |

`creature` targeting은 적도 legal target이지만 AI는 팀 검사를 따로 하므로 **적을 회복시키지
않습니다.**

행동 선택과 조준은 **resolution kind로 분기하지 않습니다** — control / damage / healing이
모두 targeting 하나로 갈립니다. `actionEffects()`가 effect 목록을 꺼내기 위해
`resolution.kind`를 읽지만(`direct`는 `effects`, `check`/`strike`는 `outcomes`, `move`는 없음)
이는 shape 접근일 뿐이고 그 결과로 AI의 선택이 달라지지 않습니다.

### 의도적으로 하지 않은 것

- `restore-hp`가 없는 ally/creature buff는 AI가 쓰지 않습니다. buff 간 선택은 utility
  scoring이 필요하고 그건 M7-4 범위 밖입니다. 그런 concept의 creature는 enemy-target
  control / ranged Strike / healing-support 범위로 조정했습니다.
- AI 전용 cooldown이나 per-turn usage state를 만들지 않았습니다. 반복 사용이 문제인
  action은 기존 legality/lock/condition semantics로 제한되거나 #21 tuning 대상입니다.

---

## 4. Backflow

새 subsystem이 필요해 이번에 구현하지 않은 creature concept은 없습니다. 아래는 roster를
설계하며 의식적으로 피한 방향이며 전부 #13의 Backflow family를 재사용합니다.

| 피한 concept | 필요 capability | Backflow |
|---|---|---|
| 독을 남기는 거미 | persistent damage / poison | #13 D8 |
| 밀쳐내는 대형 언데드 | forced movement | #13 D1 |
| 돌진 후 공격하는 늑대 | compound activity | #13 D2 |
| 시야에서 사라지는 암살자 | detection state | #13 D6 |
| 광역 화염 주문 시전자 | area / multi-target | #13 D5 |
| 아군 전체 버프 지휘관 | aura + ally-buff utility scoring | #13 D5 + AI scoring |

`enemy.giant-spider`는 원본의 poison rider를 생략한 ADAPTED입니다. 나머지는 authored
capability만으로 role이 성립합니다.

---

## 5. Visual families

4개 family로 묶어 asset production cost를 제어합니다.

| Family | Creature 수 | 비고 |
|---|---|---|
| goblin | 6 | 기존 3종 스프라이트 + 신규 3종 |
| undead | 5 | 신규 |
| beast | 4 | 신규 |
| cultist | 3 | 신규 |

신규 15종은 family variant로 묶지 않고 **각자 고유 스프라이트**를 갖습니다. 같은 family 안에서도
role이 실루엣으로 구분되어야 전투 화면에서 위협도를 읽을 수 있기 때문입니다 (예: `wolf-yearling`
↔ `dire-wolf`는 체구와 자세가, `cave-spider` ↔ `giant-spider`는 갑각 두께가 다릅니다).

각 creature는 `presentation/m3/asset-manifest.json`의 `actorVisuals`에 front/back을
등록합니다. `AssetCatalog.actorVisual()`이 미등록 액터에 대해 throw하므로 등록되지 않은
creature는 encounter에 배치되는 즉시 런타임 오류가 됩니다.

### Atlas 크기 변경

액터가 6종 → 21종이 되면서 2048² atlas가 넘쳤습니다 (`Atlas 2048x2048 is too small`).
`art/source/generation-plan.json`의 `atlas.size`를 **4096**으로 올렸습니다.

| | before | after |
|---|---|---|
| atlas frames | 28 | 58 |
| two-sided actors | 6 | 21 |
| `public/assets/m3-atlas.webp` | 1.75 MB | 3.61 MB |

atlas는 lossless WebP입니다. 액터 canvas(256×384)를 줄이면 2048²를 유지할 수 있지만 기존
hero 스프라이트의 해상도까지 함께 떨어지므로 atlas를 키우는 쪽을 택했습니다. 용량이 문제가
되면 lossless 해제가 다음 후보입니다.
