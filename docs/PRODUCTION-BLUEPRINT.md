# CardGuild Production Blueprint

**신규 Card / Equipment / playable Character / Creature / Encounter / Adventure를 추가하려면 이
문서 하나면 됩니다.** `docs/m7-*.md`와 과거 issue는 설계 근거 기록이며, routine authoring의
선행 조건이 아닙니다.

이 문서는 요약본이 아니라 **현재 코드·schema·validator·production gate·asset pipeline이 실제로
강제하는 계약**을 사람이 읽는 형태로 옮긴 것입니다. 숫자와 규칙에는 전부 machine owner 경로를
함께 적었습니다 — 문서가 코드보다 오래됐다고 의심되면 그 경로가 정답입니다.

```text
작성 시점 baseline   cardguild.m7@0.3.0 / schema v8 / fnv1a64:887ee163d92faa57
지금 값 확인         npm run content:check && npm run content:production-check
```

위 두 값은 **스냅샷**입니다. version과 fingerprint는 gameplay data가 바뀔 때마다 움직이므로,
현재 값이 필요하면 문서가 아니라 위 command 출력을 보세요.

---

## 0. Authority hierarchy

```text
1. JSON Schema / TypeScript DTO / semantic validator / runtime resolver   = machine contract
2. tools/content/m7-production-policy.ts                                  = 현재 M7 release envelope
3. art/source/generation-plan.json + tools/assets/{build,check}-assets.ts  = asset contract
4. docs/PRODUCTION-BLUEPRINT.md (이 문서)                                  = 사람이 쓰는 단일 guide
5. docs/m7-*.md / 과거 issue                                              = 근거·역사, 필수 아님
```

Markdown은 CI가 파싱하지 않습니다. 이 문서는 human SSOT이지 validator의 대체물이 아닙니다.
1–3이 이 문서와 어긋나면 **1–3이 옳고 이 문서가 버그**입니다.

### 두 가지 "가능하다"를 구분합니다

| 질문 | 답을 주는 곳 |
|---|---|
| runtime이 표현할 수 있는가? | schema + DTO + resolver (§3) |
| 지금 production에 그냥 추가해도 되는가? | release envelope (§1.3) |

이 둘을 섞지 않는 것이 이 문서의 핵심 계약입니다. 표현 가능해도 envelope 밖이면
**policy/product 결정**이지 routine authoring이 아닙니다.

---

## 1. Repository map

### 1.1 파일 역할

```text
AUTHORED GAMEPLAY          ← 여기에 콘텐츠를 씁니다
  content/m7/manifest.json traits.json conditions.json actions.json cards.json
                 equipment.json actors.json scenarios.json adventures.json

MACHINE CONTRACT           ← 무엇이 합법인지 정의합니다
  content/schema/content-pack.schema.json   구조 (Draft 2020-12, schemaVersion 8)
  src/content/content-types.ts              authoring DTO
  src/content/validate-content.ts           schema 실행
  src/content/validate-semantics.ts         참조·배치·파생값 규칙 (63가지 오류 코드)
  src/game/types.ts                         runtime union (resolution/effect/targeting …)
  src/game/statistics.ts src/game/offense.ts  파생 수치 resolver
  src/loadout/loadout.ts                    collection/loadout/deck 규칙
  src/game/ai.ts                            creature AI 계약

COMPILE / IDENTITY
  src/content/compile-content.ts   compile + getContentIdentity
  src/content/fingerprint.ts       canonical fingerprint(fnv1a64)
  src/content/load-m7-content.ts   content/m7 → compiled pack
  src/content/production-content.ts  PRODUCTION_CONTENT (client/server 공통 진입점)

RELEASE QA (gameplay이 아님, src/는 import 금지)
  tools/content/m7-production-policy.ts     현재 release envelope + reserve 목록
  tools/content/check-production-content.ts release gate
  tools/playtest/**                         seeded 자동 플레이 하네스

AUTHORED ART
  art/STYLE.md                     프롬프트·팔레트·투영 기준 (모든 prompt가 참조해야 함)
  art/source/generation-plan.json  source PNG → asset frame → presentation mapping (SSOT)
                                   build 시작 시 validatePlan()이 이 파일을 먼저 검증합니다
  art/source/**/*.png              원본 이미지

GENERATED — 직접 수정 금지
  art/processed/**                 정규화 프레임, QC, pipeline-meta.json
  presentation/m3/asset-manifest.json  asset-sources.json  tilemaps.json
  public/assets/m3-atlas.webp  public/assets/m3-atlas.json
  dist/  dist-server/
```

> **`presentation/m3` / `m3-atlas`는 legacy 이름이지만 현재 M7이 실제로 쓰는 산출물입니다.**
> M3 fixture 자산이 아닙니다. 이름 때문에 "옛날 것"이라 판단하고 지우거나 무시하면 런타임이
> 그림을 잃습니다. rename은 별도 마이그레이션 과제입니다.

### 1.2 authoritative path

```text
content/m7/*.json → load-m7-content.ts → PRODUCTION_CONTENT
                                          ├─ client UI / battle rendering
                                          ├─ authoritative server (src/server)
                                          ├─ asset build (tilemaps, visual coverage)
                                          └─ production gate / playtest
```

`content/m6`(cardguild.m6@0.9.0)와 `content/m3`(cardguild.m4@0.6.0)은 **규칙 회귀 fixture**입니다.
신규 production 콘텐츠를 그쪽에 넣지 않습니다. generic `content:check`만 적용되고 M7 volume
정책은 적용되지 않습니다.

production 코드는 barrel(`src/content/index.ts`)이 아니라 `production-content.ts`를 직접
import합니다. barrel은 모든 milestone loader를 re-export하므로 fixture pack이 배포 번들에
딸려 들어갑니다. 테스트는 barrel을 써도 됩니다.

### 1.3 현재 release envelope

| Category | 현재 | M7 contract | machine owner |
|---|---:|---|---|
| playable Character | 4 | 정확히 4 | `M7_PRODUCTION_POLICY.volume.starters` |
| Player Card | 32 authored / 26 player-reachable | 24–32 / reachable ≥ 26 | `volume.playerCards`, `reachableMinimum.playerCards` |
| Creature | 18 authored / 14 배치됨 | 15–20 / used ≥ 14 | `volume.enemies`, `reachableMinimum.enemies` |
| Scenario | 10 authored / 8 사용됨 | 8–12 / used ≥ 8 | `volume.scenarios`, `reachableMinimum.scenarios` |
| Equipment | 25 authored / 21 player-reachable | 20–30 / reachable ≥ 21 | `volume.equipment`, `reachableMinimum.equipment` |
| production Adventure | 1 | 정확히 1 | `check-production-content.ts` `PRODUCTION_ADVENTURE_NOT_SINGULAR` |
| Adventure encounters | 8 | 6–8 | `volume.adventureEncounters` |
| tutorial prefix | 4 | 3–4, 연속 prefix | `volume.tutorialPrefix`, `tutorialEncounterIds` |
| reserve | 16 | 각 항목에 reason + `#issue` | `reserveCards/Equipment/Actors/Scenarios` |

전부 `tools/content/m7-production-policy.ts` 한 파일에 있습니다. 현재 값은
`npm run content:production-check` 출력이 그대로 보여 줍니다.

**여유 공간**: Equipment +5, Creature +2, Scenario +2, Card 0, Adventure encounter 0.

### 1.4 routine addition이 아닌 것

| 요구 | 왜 routine이 아닌가 | 필요한 것 |
|---|---|---|
| **33번째 Card** | authored 상한이 32. 정책을 조용히 올리면 gate가 `PRODUCTION_VOLUME`으로 실패 | 기존 Card 교체/삭제, 또는 envelope 상향에 대한 명시적 release 결정 |
| **5번째 playable Character** | 정확히 4 정책 + Party Builder/seat/asset/starter 계약이 4에 맞춰짐 | product 결정 + policy 변경 + asset + regression |
| **두 번째 production Adventure** | `PRODUCTION_CONTENT`가 단일 authoritative adventure를 고르고 gate가 pack에 Adventure 1개만 허용 | selector/정책/UI 설계 결정 |

envelope을 넘기고 싶다면 policy 파일을 먼저 고치고, **그 변경 자체를 리뷰 대상으로 올립니다.**
gate를 우회하는 flag는 없습니다.

---

## 2. Identity / naming / versioning

- **ID는 category 안에서만 유일**합니다. Action과 Trait이 같은 문자열을 써도 됩니다
  (`DUPLICATE_ID`는 같은 category 안에서만 발생).
- 관례: `card.*`, `hero.*`, `enemy.*`, `encounter.*`, `adventure.*`, Equipment/Action/Trait/
  Condition은 접두사 없는 kebab-case (`spiked-shield`, `hex-bolt`, `frightened`).
- **ID를 바꾸는 것은 새 정의를 만들고 옛 것을 지우는 것과 같습니다.** fingerprint가 바뀌고
  기존 replay/저장 상태는 거부됩니다(`CombatState`가 pack id/version/fingerprint를 들고 있음).
- `manifest.json`: `schemaVersion` 8 고정, `id` `cardguild.m7`, `rulesetId`
  `cardguild.pf2e-remaster.v1`.
- **gameplay authored data를 바꾸면 `version`을 올립니다**(예: 0.2.0 → 0.3.0). 문서/asset만
  바뀌면 올리지 않습니다. 값은 `content/m7/manifest.json` **한 곳에만** 있습니다 — 테스트와
  runtime identity는 전부 거기서 파생되므로 다른 파일을 함께 고칠 일이 없어야 합니다.
  어딘가에 version 문자열을 다시 적으면 그 순간부터 routine content 변경이 남의 테스트를
  깨뜨립니다.
- JSON shape을 호환 불가하게 바꾸면 `schemaVersion`을 올리고 명시적 migration을 추가합니다.
  기존 schema를 덮어써 조용히 재해석하지 않습니다.
- **fingerprint는 authoring 대상이 아닙니다.** `fingerprintContentPack()`이 정규화된 pack
  전체에서 계산합니다(정의 배열 순서, object key 순서, tile 입력 순서에 영향받지 않음).
- **presentation asset은 gameplay fingerprint에 들어가지 않습니다.** 아이콘을 다시 그려도
  fingerprint는 그대로입니다. 반대로 `partySize` range 하나만 바꿔도 바뀝니다.

---

## 3. 공유 primitive 빠른 참조

새 Card 하나를 만들려면 Action·Trait·Condition 계약을 함께 알아야 하므로 여기에 모았습니다.
정확한 필드는 `content/schema/content-pack.schema.json`과 `src/game/types.ts`가 소유합니다.

### 3.1 Card

```jsonc
{ "id": "card.trip", "name": "Trip", "actionId": "trip", "traits": [{ "id": "attack" }, { "id": "trip" }] }
```

**Card는 규칙을 소유하지 않습니다.** `actionId` 참조 + deck/provenance wrapper일 뿐이고,
숫자·판정·효과는 전부 Action에 있습니다. Card 전용 executor나 `SpellCardDefinition` 같은
종류별 타입은 없습니다. `spell` / `focus` / `feat`은 Trait metadata이며 실행 분기 key가
아닙니다.

### 3.2 Action

```text
timing        { kind: "turn", actions: 1|2|3 } | { kind: "reaction" }
targeting     none | self | ally | creature | enemy | tile | object | effect
range         { kind: "weapon-reach" } | { kind: "feet", value: 5의 양의 배수 }
requirements  weapon-mode(melee|ranged) | equipped-slot(weapon|armor|shield|feet)
              | skill-rank(skill, minimum rank)
mapAttackCount 1|2|3   (attack trait이 있을 때만)
resolution    move | strike | check | direct
```

| resolution | 무엇인가 | 필수 필드 |
|---|---|---|
| `move` | 판정 없는 이동 | `movementMode`(land/fly), `step`, `triggersReactions` |
| `strike` | resolved Strike vs 대상 AC | `damageMultiplier`, `outcomes`(4 degree), `extraWeaponDice?` |
| `check` | 선언한 statistic vs 선언한 DC | `check{roller, statistic, dc}`, `outcomes`(4 degree) |
| `direct` | 판정 없이 effect 실행 | `effects[]` |

`check.statistic`은 `skill(+attributeOverride?)` / `save` / `perception` **이름만** 씁니다.
`check.dc`는 `fixed` / `armor-class(owner)` / `statistic-dc(owner, statistic)` /
`class-dc(owner)` 중 하나입니다. **최종 modifier나 최종 DC를 Card/Action에 적지 않습니다.**

effect primitive (전부, `owner`는 `actor` | `target`):

```text
apply-condition(owner, condition, value?)   remove-condition(owner, condition)
damage(owner, dice, flatModifier, damageType, multiplier?)
restore-hp(owner, dice, flatModifier, multiplier?)
lock-action(actionId)   create-sustained-effect(effectName)   sustain-effect
raise-shield            interact
```

`owner: "target"`인 primitive는 대상을 가리키는 targeting에서만 쓸 수 있습니다
(`EFFECT_REQUIRES_TARGET`). degree outcome map은 4개 degree를 모두 선언해야 합니다
(`INCOMPLETE_DEGREE_OUTCOMES`).

**JSON에 script / 함수 이름 / JS 표현식 / 수식 문자열을 넣지 않습니다.** 새 동작은 위
primitive 조합으로만 표현하고, 조합이 불가능하면 §13으로 갑니다.

### 3.3 Trait

```jsonc
{ "id": "shield", "name": "Shield", "cardGrants": [], "actionGrants": [{ "actionId": "raise-shield", "contextGroup": "shield" }] }
{ "id": "trip",   "name": "Trip",   "cardGrants": [{ "cardDefinitionId": "card.trip", "count": 2 }], "actionGrants": [] }
```

- Trait은 **Card provider / Context Action provider / stat modifier 보유자**입니다.
- Equipment·Condition이 카드나 컨텍스트 행동을 주는 유일한 경로가 이 pipeline입니다.
  개별 ID 분기는 없습니다.
- `contextGroup`은 `escape | interact | shield | sustain`.
- Equipment의 effective trait set = `equipment.traits` ∪ `weaponProfile.traits` (ID 중복 제거).
  Strike resolver·Card provider·Context Action provider·modifier stack이 **같은 set**을 봅니다.
- 콘텐츠에서 쓰는 모든 Trait ID는 `traits.json`에 먼저 존재해야 합니다(`UNKNOWN_TRAIT`).

### 3.4 Condition

```jsonc
{ "id": "frightened", "name": "Frightened", "traits": [...],
  "statModifiers": [{ "selector": { "kind": "all" }, "type": "status", "value": -1, "label": "Frightened" }],
  "valuePolicy": { "min": 0, "max": 4, "merge": "max", "modifierScale": "multiply-by-value", "endTurnDelta": -1 } }
```

- `valuePolicy`가 있으면 **값 있는 Condition**입니다. 병합은 `max`, modifier는 값에 비례,
  `endTurnDelta: -1`이면 소유자 턴 종료마다 1 감소하고 0에서 사라집니다.
- `expiry: "actor-turn-start"`는 소유자의 다음 턴 시작에 사라집니다(방어 버프용).
- `valuePolicy`가 없는 Condition에 `value`를 주면 `CONDITION_VALUE_NOT_SUPPORTED`.

### 3.5 stat modifier

```text
selector  all | perception | ac | attack | damage | class-dc | save(id) | skill(id)
type      circumstance | item | status | untyped
```

- typed(`circumstance`/`item`/`status`)마다 **가장 큰 bonus 하나와 가장 나쁜 penalty 하나가
  각각** 적용됩니다. 같은 type의 `+2`와 `-1`은 둘 다 살아 있습니다. untyped penalty는 모두
  누적됩니다(`selectedTypedIndices()` in `src/game/statistics.ts`).
- **PF2e Remaster에는 untyped bonus가 없습니다.** `untyped`는 음수(penalty)만 허용되고
  양수는 schema와 `UNTYPED_MODIFIER_MUST_BE_PENALTY` 양쪽에서 거부됩니다.
- Armor의 `acItemBonus`와 raised Shield의 `shieldBonus`는 `statModifiers`로 중복 선언하지
  않습니다. runtime이 각각 item / circumstance 기여로 같은 stack에 넣습니다.

---

## 4. Golden path — Card

> **Files to edit** `content/m7/actions.json`(필요 시), `content/m7/cards.json`,
> 획득 경로에 따라 `content/m7/actors.json` 또는 `adventures.json`,
> `art/source/generation-plan.json` + `art/source/ui/*.png`,
> 노출하지 않는다면 `tools/content/m7-production-policy.ts`
> **Do not edit** `presentation/m3/**`, `public/assets/**`, `art/processed/**`
> **Required test** `src/game/card-library.test.ts`(새 mechanic이면), `npm run test:unit`
> **Required asset** UI icon 1개 (예외 없음 — §11)
> **최소 검증** `npm run assets && npm run check` (전체 DoD는 §12)

### 4.1 절차

1. **Envelope 확인.** 현재 32/32입니다. 새 Card는 기존 Card를 빼지 않는 한 policy 결정입니다
   (§1.4). 교체라면 삭제 대상이 어디에서 참조되는지 먼저 확인합니다 — starter prepared,
   baseCardGrants, trait cardGrants, reward choices, reserve 목록.
2. **기존 Action으로 표현되는가?** `content/m7/actions.json`에 이미 있는 45개를 먼저 봅니다.
   같은 Action을 다른 이름/그림으로 파는 Card는 dead duplicate입니다.
3. 표현되지 않으면 **generic Action을 추가**합니다. §3.2의 primitive만 씁니다. Action은
   특정 Card 전용이 아니라 재사용 가능한 이름이어야 합니다.
4. 필요한 Trait / Condition을 정의하거나 참조합니다(§3.3, §3.4).
5. `cards.json`에 `{id, name, actionId, traits}`를 추가합니다.
6. **획득 경로를 결정합니다** — 이것을 빼먹으면 gate가 orphan으로 실패합니다.
   - starter가 준비: `actors.json` → `starterLoadout.preparedCards`
     (`preparedCardCapacity`를 넘기면 `PREPARED_CAPACITY_EXCEEDED`)
   - starter 기본 지급: `actors.json` → `baseCardGrants`
   - Equipment provider: Trait `cardGrants` (§5)
   - Adventure 보상: `adventures.json` → `rewards[].choices`
   - 의도적 미노출: `m7-production-policy.ts`의 `reserveCards`에 reason + `#issue`와 함께
     (§10)
7. `art/source/generation-plan.json`의 `presentation.cardVisuals`에 매핑을 추가하고 icon
   source를 넣습니다(§11).
8. `npm run assets && npm run check`.
9. 새 mechanic이면 `src/game/card-library.test.ts`에 회귀를 추가합니다.
10. gameplay data가 바뀌었으므로 `manifest.json`의 `version`을 올립니다(§2).

### 4.2 Golden example — `card.force-barrage`

```jsonc
// actions.json — 판정 없이 자동으로 맞는 1 action 원거리 피해
{
  "id": "force-barrage", "name": "Force Barrage", "description": "...",
  "timing": { "kind": "turn", "actions": 1 },
  "traits": [{ "id": "spell" }, { "id": "concentrate" }],
  "targeting": "enemy",
  "range": { "kind": "feet", "value": 30 },
  "resolution": {
    "kind": "direct",
    "effects": [{ "kind": "damage", "owner": "target", "dice": { "count": 1, "sides": 4 },
                  "flatModifier": 1, "damageType": "force" }]
  }
}

// cards.json — wrapper. 숫자도 판정도 없습니다.
{ "id": "card.force-barrage", "name": "Force Barrage", "actionId": "force-barrage",
  "traits": [{ "id": "concentrate" }, { "id": "spell" }] }

// adventures.json — 실제 획득 경로
{ "kind": "card", "definitionId": "card.force-barrage" }
```

### 4.3 하지 말아야 할 것

```jsonc
// ✗ resolver가 계산하는 값을 Card/Action에 박아 넣기
{ "attackModifier": 8, "dc": 17, "damageBonus": 3 }
// ✓ 무엇을 쓰는지만 선언
{ "check": { "roller": "actor", "statistic": { "kind": "skill", "skill": "athletics" },
             "dc": { "kind": "statistic-dc", "owner": "target",
                     "statistic": { "kind": "save", "save": "reflex" } } } }
```

Character의 최종 공격 수치, 최종 DC, flat weapon damage modifier는 authoring 대상이
아닙니다(§6). Creature의 fixed strike는 예외입니다(§7).

---

## 5. Golden path — Equipment

> **Files to edit** `content/m7/equipment.json`, provider가 필요하면 `traits.json`,
> 획득 경로에 따라 `actors.json`(starter) 또는 `adventures.json`(reward),
> `art/source/generation-plan.json` + icon source
> **Do not edit** generated asset (§1.1)
> **Required test** `src/content/m7-equipment.test.ts`, `src/loadout/loadout.test.ts`
> **Required asset** UI icon 1개
> **최소 검증** `npm run assets && npm run check` (전체 DoD는 §12)

### 5.1 slot 계약

```text
slot   weapon | armor | shield | feet        (이 순서가 결정론적 장비 순서)
weaponProfile  weapon slot만        (없으면 WEAPON_PROFILE_REQUIRED / 다른 slot이면 MISMATCH)
armorProfile   armor slot만         (category, acItemBonus, dexCap)
shieldBonus    shield slot만
statModifiers  모든 slot 가능
traits         provider pipeline (§3.3)
```

`weaponProfile`은 **무엇을 쓰는지**만 선언합니다: `name / category(unarmed|simple|martial|
advanced) / attackMode(melee|ranged) / rangeFeet / damage{count,sides,damageType} / traits`.
최종 `attackModifier`나 Attribute를 복제한 flat `damage.modifier`는 schema가 거부합니다.

- Character 공격 = `attack Attribute + weapon category proficiency + typed modifier + MAP`
- Character 피해 = `weapon dice + 합법적인 Attribute 기여 + damage modifier`
  (melee/`thrown`은 STR 전량, `propulsive`는 양수 STR의 절반·음수면 전량, 그 외 ranged는 0)
- attack Attribute: melee = STR, ranged = DEX, `finesse` melee는 둘 중 **높은 쪽을 결정적으로**
- MAP은 `resolveMapPenalty()` 한 곳: `agile`은 `0/-4/-8`, 그 외 `0/-5/-10`

Armor의 `acItemBonus`는 **Character AC 공식의 항**이라 Character에게만 적용됩니다. Creature의
authored AC는 완결된 top-down 값이라 장비로 다시 올라가지 않습니다(§7).

### 5.2 "의미 있는 item"의 기준

resolver가 실제로 보는 차이가 있어야 합니다. 다음 중 최소 하나:

- statistic trade-off (`dexCap`, typed bonus/penalty, AC ↔ 공격 등)
- provider (Trait를 통한 Card/Context Action 공급)
- 같은 등급의 sidegrade (사거리 ↔ 화력 ↔ 기동)
- build direction 완성 조각 (§5.3)

이름과 숫자만 다른 복제품은 만들지 않습니다. `npm run playtest` 결과에서 아무도 장착하지 않는
item은 dead duplicate 신호입니다.

### 5.3 reward 화면에 나오는 것 ≠ 조립 가능한 build

**하나의 reward offer는 하나만 줍니다.** 같은 offer 안의 두 item은 한 run에서 동시에 가질 수
없습니다. 여러 item이 필요한 build direction은 **서로 다른 offer**에 흩어져 있어야 합니다.

```text
Goblin Chief : throwing-axes / greatsword / flick-mace / dueling-rapier   → 1개
Wolf Run     : medics-kit / warding-charm / hexers-focus / scout-leather  → 1개
Archer Perch : tower-shield / buckler / striders-boots / spiked-shield    → 1개
```

`src/content/m7-vertical-slice.test.ts`가 이것을 **offer마다 최대 하나를 배정하는 매칭**으로
검증합니다. 단순히 "어딘가 등장한다"로 세면 조립 불가능한 build를 가능하다고 착각합니다.

### 5.4 ownership / collection

- 시작 collection = 파티원들의 `starterLoadout` 장비 + 준비 카드 (`createStartingCollection`)
- 보상은 collection에 사본 1개를 더합니다.
- **파티 전체에서 장착·준비된 사본 수가 소유 수를 넘을 수 없습니다**
  (`EQUIPMENT_COPIES_EXCEEDED`, `CARD_COPIES_EXCEEDED`). 두 명이 같은 검을 들려면 사본이 2개
  있어야 합니다.
- slot이 맞지 않으면 `SLOT_MISMATCH`, 준비 카드가 capacity를 넘으면
  `PREPARED_CAPACITY_EXCEEDED`.
- 검증 주체는 `validatePartyLoadout()` 하나이고 Loadout UI·Adventure runtime·production
  gate가 모두 그것을 부릅니다.

### 5.5 Golden example — provider가 있는 `spiked-shield`

```jsonc
// equipment.json
{ "id": "spiked-shield", "name": "Spiked Shield", "slot": "shield",
  "traits": [{ "id": "shield" }, { "id": "shield-spike" }],
  "statModifiers": [], "shieldBonus": 2 }

// traits.json — 카드를 주는 것은 item이 아니라 trait입니다
{ "id": "shield-spike", "name": "Shield Spike",
  "cardGrants": [{ "cardDefinitionId": "card.shield-press", "count": 2 }], "actionGrants": [] }
```

이 방패를 장착한 파티원의 deck에 `card.shield-press` 2장이 자동으로 들어갑니다
(`deriveTacticalDeck`, source `equipment-trait`). 즉 **Equipment를 노출하면 그 provider Card도
함께 도달 가능**해집니다(§10).

---

## 6. Golden path — playable Character

> **Files to edit** `content/m7/actors.json`, 필요 시 `equipment.json` / `cards.json`
> **Do not edit** 파생 수치(아래 금지 목록), generated asset
> **Required test** `src/content/m7-starters.test.ts`
> **Required asset** front/back 두 면 standee (§11)
> **최소 검증** `npm run assets && npm run check` (전체 DoD는 §12)
> **주의** 현재 정확히 4명 정책 — 5번째는 routine 작업이 아닙니다(§1.4)

### 6.1 authored

```text
statProfile.kind = "character"
  level
  attributes           str dex con int wis cha   (6개 전부)
  perception           proficiency rank
  saves                fortitude reflex will     (3개 전부)
  skills               16개 General Skill 전부   (Lore 없음)
  defense              ancestryHp, classHpPerLevel, armorProficiencies(unarmored/light/medium/heavy)
  offense              keyAttribute, weaponProficiencies(unarmed/simple/martial/advanced),
                       classDcProficiency, unarmedStrike(characterWeaponProfile)
speedFeet   traits(playable 포함)   initialConditions
loadoutProfile.preparedCardCapacity
starterLoadout.equipment / .preparedCards
innateActionIds   baseCardGrants
```

`playable` trait을 가진 Actor는 반드시 character profile이어야 합니다
(`PLAYABLE_REQUIRES_CHARACTER_STATS`). `unarmedStrike.category`는 `unarmed`여야 합니다
(`UNARMED_STRIKE_CATEGORY_MISMATCH`).

### 6.2 authoring 금지 — 전부 파생값

```text
최종 Max HP        = ancestryHp + level × (classHpPerLevel + CON)      deriveMaxHp()
최종 AC            = 10 + armor dexCap으로 제한된 DEX + 착용 category proficiency + typed
                                                                       resolveArmorClass()
Save/Skill/Perception = Attribute + proficiency bonus + typed          resolveStatisticModifier()
Save/Skill DC      = 10 + 위 modifier                                   resolveStatisticDC()
Initiative         = Perception(또는 선택된 Skill) modifier              resolveInitiative()
Strike attack      = attack Attribute + weapon proficiency + typed + MAP resolveStrike()
Strike damage      = weapon dice + 합법적 Attribute 기여                  resolveStrike()
Class DC           = 10 + keyAttribute + classDcProficiency + typed      resolveClassDC()
```

proficiency bonus = `untrained 0`, 그 외 `level + 2/4/6/8`(trained/expert/master/legendary),
`proficiencyBonus()` 소유. Save는 `fortitude→CON, reflex→DEX, will→WIS`, Skill의 기본
Attribute는 `SKILL_ATTRIBUTE` 표(`athletics→STR`, `arcana→INT` …)가 소유합니다.

schema가 `ac`/`maxHp`/`attackModifier`/`classDc` 같은 필드를 character profile에서 아예 거부하고,
`m7-starters.test.ts`가 authored JSON 문자열에 그 키가 없는지도 확인합니다.

### 6.3 값 확인 방법

수동 계산 대신 resolver를 부릅니다.

```ts
import { deriveLoadoutSnapshot } from "../loadout";
const snapshot = deriveLoadoutSnapshot(actor, actor.starterLoadout, pack.combatContent, "preview");
snapshot.statistics; // maxHp, ac, classDc, reflex{modifier,dc}, athletics, initiative
snapshot.strike;     // ResolvedStrikeProfile (attackModifier/mapPenalty/damage/traits)
snapshot.deck;       // base + prepared + equipment-trait 기여
snapshot.contextActionIds;
```

### 6.4 Golden example — derived boundary

```jsonc
// hero.brom (발췌) — 숫자는 입력이고, 결과는 resolver가 만듭니다
"attributes": { "str": 3, "dex": 0, "con": 4, "int": 0, "wis": -1, "cha": 1 },
"defense": { "ancestryHp": 10, "classHpPerLevel": 12,
             "armorProficiencies": { "unarmored": "trained", "light": "trained",
                                     "medium": "trained", "heavy": "expert" } },
"offense": { "keyAttribute": "str", "classDcProficiency": "trained",
             "weaponProficiencies": { "unarmed": "trained", "simple": "trained",
                                      "martial": "trained", "advanced": "untrained" },
             "unarmedStrike": { "name": "Fist", "category": "unarmed", "attackMode": "melee",
                                "rangeFeet": 5, "damage": { "count": 1, "sides": 4,
                                "damageType": "bludgeoning" }, "traits": [...] } }
// → Max HP 10 + 1×(12+4) = 26. JSON 어디에도 26은 없습니다.
```

`advanced: untrained`는 **장착 금지가 아닙니다.** 장착도 공격도 되지만 proficiency bonus가
0이라 명중이 크게 떨어집니다. "쓸 수 없다"와 "쓰면 손해다"를 구분해 적으세요.

---

## 7. Golden path — Creature

> **Files to edit** `content/m7/actors.json`, 필요 시 `actions.json`(innate), `scenarios.json`(배치)
> **Do not edit** `src/game/ai.ts`의 행동 목록, generated asset
> **Required test** `src/game/creature-ai.test.ts`(roster 계약이 여기 있습니다)
> **Required asset** front/back 두 면 standee
> **최소 검증** `npm run assets && npm run check` (전체 DoD는 §12)
> **Envelope** 18/20 — 현재 2마리 여유

### 7.0 절차

1. **Envelope 확인** — 18/20이라 2마리 여유가 있습니다(§1.3).
2. `actors.json`에 creature profile을 추가합니다(§7.1). `playable` trait을 붙이지 않습니다.
3. 특별한 능력이 필요하면 **generic Action**을 `actions.json`에 추가하고 `innateActionIds`에
   **우선순위 순서대로** 적습니다(§7.2). AI가 겨냥할 수 있는 targeting인지 확인하세요.
4. **어느 Scenario에 세울지 정합니다.** 배치하지 않으면 orphan이므로 reserve에 이유와 함께
   넣어야 합니다(§10). 배치는 `scenarios.json`의 `placements`이고, party size별 등장은
   `partySize` range로 표현합니다(§8.2).
5. front/back standee source와 `generation-plan.json` 항목을 추가합니다(§11).
6. `npm run assets && npm run check`. balance에 닿았다면 `npm run playtest`로 전후를 비교합니다.

### 7.1 Creature는 Character 공식을 쓰지 않습니다

```text
statProfile.kind = "creature"
  ac  maxHp                       ← top-down 완성값 (파생 아님)
  strike { name, attackModifier, rangeFeet, damage{count,sides,modifier,damageType}, traits }
  perception                      ← 숫자
  saves { fortitude, reflex, will } ← 숫자
  skills { 필요한 것만 }            ← 16개 강제 없음
speedFeet   traits   innateActionIds   baseCardGrants   starterLoadout(보통 비어 있음)
```

Creature는 authored AC/HP를 그대로 씁니다. 장비를 입혀도 AC가 다시 오르지 않습니다.
Character의 16 Skill / defense / offense profile을 요구하지 않습니다.

### 7.2 AI 계약

`src/game/ai.ts`의 `chooseAiCommand()`는 **generic deterministic** 선택기입니다.

```text
1. 갇힌 상태 해제 (stand / escape-grab)
2. innateActionIds를 선언한 순서대로, 한 턴에 각각 한 번
3. 기본 Strike (Fixed Strike의 사거리를 그대로 사용)
4. 가장 가까운 hero 쪽으로 Stride (실제로 거리가 줄어들 때만)
5. End Turn
```

- **선언 순서가 그 creature의 AI 우선순위 전부입니다.** 별도 priority schema가 없습니다.
- 같은 innate를 한 턴에 반복하지 않습니다. 그래야 authored Strike가 등장하고 순서가 의미를
  갖습니다(`creature-ai.test.ts`가 고정).
- **새 innate action ID를 `ai.ts`에 하드코딩하지 않습니다.** `ai.ts`의 id 목록은 누구나 쓸 수
  있는 basic/recovery action뿐입니다. 새 능력은 authoring으로만 작동해야 합니다.
- AI가 겨냥할 수 있는 targeting: `self / none / enemy / ally / creature`. `ally`/`creature`는
  **회복 효과가 있을 때만** 사용합니다(버프 선택 정책이 없음). tile/object/effect targeting은
  innate로 주지 마세요 — 조용히 무시됩니다.
- creature별 behavior script/DSL은 금지입니다. 표현할 수 없으면 §13.

`check-production-content.ts`가 Adventure에 배치된 모든 enemy에 대해 Fixed Strike 또는 innate가
있는지, innate id가 실재하고 겨냥 가능한지 확인합니다(`PRODUCTION_AI_*`).

### 7.3 Golden example — `enemy.goblin-chief`

```jsonc
{ "id": "enemy.goblin-chief", "name": "Goblin Chief",
  "statProfile": { "kind": "creature", "stats": {
    "ac": 18, "maxHp": 28,
    "strike": { "name": "Chief's Glaive", "attackModifier": 8, "rangeFeet": 10,
                "damage": { "count": 1, "sides": 10, "modifier": 3, "damageType": "slashing" },
                "traits": [] },
    "perception": 6, "saves": { "fortitude": 8, "reflex": 5, "will": 6 },
    "skills": { "athletics": 8, "intimidation": 8 } } },
  "speedFeet": 25, "traits": [{ "id": "actor" }, { "id": "goblin" }],
  "innateActionIds": ["knockdown", "demoralize"],   // 순서 = 우선순위
  "baseCardGrants": [], "initialConditions": [],
  "loadoutProfile": { "preparedCardCapacity": 0 },
  "starterLoadout": { "equipment": {}, "preparedCards": [] } }
```

한 턴: `knockdown`(2 action strike) → `demoralize`(1 action) → 남으면 Strike/Stride.

---

## 8. Golden path — Encounter (Scenario)

> **Files to edit** `content/m7/scenarios.json`, 배치할 creature가 새것이면 `actors.json`
> **Do not edit** `presentation/m3/tilemaps.json` (map에서 자동 생성됩니다)
> **Required test** `src/content/m7-encounters.test.ts`
> **Required asset** 새 terrain/object 종류를 쓸 때만 (§11)
> **최소 검증** `npm run assets && npm run check` (전체 DoD는 §12)
> **Envelope** 10/12 — 2개 여유. Adventure에 넣으려면 §9

### 8.1 구조

```text
ScenarioSource
  id  name
  objective      { kind: "defeat-all-enemies", description }   ← 현재 유일한 kind
  placements[]   { instanceId, actorDefinitionId, team:"enemies", position, facing, partySize? }
  partySpawnSlots[] { seat: 1|2|3, position, facing }
  map            { width, height, tiles[], objects[] }
```

- **hero를 placements에 넣지 않습니다.** `team`은 schema에서 `"enemies"` 고정이고 validator도
  `STATIC_HERO_PLACEMENT`로 잡습니다. 파티는 seat별 spawn slot으로 들어옵니다.
- spawn seat는 1–3 각각 한 번, 위치도 서로 달라야 합니다
  (`DUPLICATE_PARTY_SPAWN_SEAT`, `DUPLICATE_PARTY_SPAWN_POSITION`).
- 모든 spawn/placement는 map 안이어야 하고, 존재하는 tile 위여야 하며, `blocked`/`impassable`
  tile 위에 설 수 없습니다(`*_TILE_MISSING`, `*_TILE_BLOCKED`, `TILE_OUT_OF_BOUNDS`).
- tile은 `id`/`position`/`traits`(최소 1개)를 가지며 위치와 ID가 유일해야 합니다. map object는
  `interaction`(현재 `open-gate` 하나)과 `used`(authoring 시 `false`)를 선언하고, 대상 tile이
  존재해야 합니다(`UNKNOWN_TARGET_TILE`).

### 8.2 party-size scaling

```text
partySize 없음            → 1P/2P/3P 모두 생성
partySize {min:2,max:3}   → 2P/3P에서만
partySize {min:1,max:1}   → 1P에서만
```

판정은 `placementAppliesToPartySize()` **하나가 소유**하고 세 소비 지점이 모두 그것을 씁니다:
runtime(`buildAdventureEncounter`), compile preview(1P 구성으로 compile), validator.

- **동시에 존재하지 않는 두 placement는 같은 tile을 공유할 수 있습니다.** 겹치는 크기에서만
  충돌입니다(`ACTOR_POSITION_CONFLICT`, `PARTY_SPAWN_STATIC_CONFLICT`).
- 각 party size마다 enemy가 최소 1이어야 합니다(`NO_ENEMY_FOR_PARTY_SIZE`).
- `min > max`는 `INVALID_PLACEMENT_PARTY_SIZE`.
- Adventure에 들어가는 Scenario는 `partySize.max`만큼 spawn slot을 제공해야 합니다
  (`INSUFFICIENT_PARTY_SPAWNS`, `MISSING_PARTY_SPAWN_SEAT`).

### 8.3 Golden example — 크기에 따라 **다른 적**을 세우기

`encounter.road-ambush`는 머릿수를 늘리는 대신 creature를 교체합니다. 두 placement가 배타적
range를 갖고 같은 tile을 공유합니다.

```jsonc
"placements": [
  { "instanceId": "goblin-lackey", "actorDefinitionId": "enemy.goblin-lackey",
    "team": "enemies", "position": { "x": 2, "y": 1 }, "facing": "west",
    "partySize": { "min": 1, "max": 1 } },
  { "instanceId": "goblin-skirmisher", "actorDefinitionId": "enemy.goblin-skirmisher",
    "team": "enemies", "position": { "x": 2, "y": 1 }, "facing": "west",
    "partySize": { "min": 2, "max": 3 } }
]
```

### 8.4 map은 gameplay source, tilemap은 산출물

`scenarios.json`의 `map`이 gameplay 진실입니다. `presentation/m3/tilemaps.json`은
`npm run assets`가 production pack의 모든 Scenario에서 생성합니다. **Scenario를 추가하면 asset
build를 다시 돌려야** tilemap이 생깁니다. tilemaps.json을 손으로 편집하지 않습니다.

새 objective family(호위·생존·탈출 등)는 routine encounter authoring이 아닙니다 — schema가
`defeat-all-enemies`만 허용하므로 §13의 Rule Extension입니다.

---

## 9. Golden path — Adventure / Reward

> **Files to edit** `content/m7/adventures.json`
> **Do not edit** 두 번째 production Adventure를 만드는 일 (§1.4)
> **Required test** `src/content/m7-vertical-slice.test.ts`, `src/content/m7-tutorial.test.ts`,
> `tests/network/adventure-progression.integration.test.ts`
> **최소 검증** `npm run check && npm run test:network && npm run test:smoke` (전체 DoD는 §12)

### 9.1 구조

```text
Adventure
  id  name  description
  partySize { min: 1, max: 3 }
  encounterIds[]   ← 선형 순서. 중복 불가(DUPLICATE_ADVENTURE_ENCOUNTER)
  rewards[]        ← { id, afterEncounterId, choices[] }
```

- `afterEncounterId`는 그 Adventure의 encounter여야 하고(`REWARD_OUTSIDE_ADVENTURE`), 한
  encounter에 보상은 하나입니다(`DUPLICATE_ENCOUNTER_REWARD`).
- `choices`는 `{kind:"card"|"equipment", definitionId}`이며 존재하는 정의여야 합니다.
- 보상은 collection 소유권을 늘릴 뿐이고, 실제로 쓰려면 **between-encounters에서 장착/준비**해야
  합니다(`set-member-loadout`). 이 경로가 곧 다음 전투의 deck/stat입니다.

### 9.1.1 보상 → loadout → 다음 전투는 어디서 검증되는가

새 보상을 넣었다면 이 다섯 층이 그것을 지납니다. 하나라도 실패하면 보상이 화면에만 있고 전투에
도달하지 못한다는 뜻입니다.

| 층 | 파일 | 무엇을 확인하는가 |
|---|---|---|
| 소유권 규칙 | `src/loadout/loadout.test.ts` | 사본 수, slot, prepared capacity, 장착/해제 시 소유권 이동 |
| Adventure runtime | `src/adventure/adventure.test.ts` | 보상 획득 → 소유권 → loadout 변경 → **다음 CombatState의 deck/stat/provenance 일치** |
| onboarding 계약 | `src/content/m7-tutorial.test.ts` | prefix 보상이 다음 Encounter에서 실제로 준비 가능한지 |
| 실제 서버 경로 | `tests/network/adventure-progression.integration.test.ts` | 보상을 실제 세션에서 받고 착용한 뒤 완주 |
| 실제 브라우저 | `tests/runtime.smoke.spec.ts` | Reward 화면 → Manage Loadout → 다음 Encounter의 손패/능력치 |

선택지가 실제로 다른 플레이를 만드는지(dead/dominant choice)는 `npm run playtest`가 봅니다.

### 9.2 tutorial prefix

`M7_PRODUCTION_POLICY.tutorialEncounterIds`는 `encounterIds`의 **앞에서부터 연속된 prefix**이며
순서까지 같아야 합니다(`TUTORIAL_PREFIX_MISMATCH`). 현재 4개입니다. 순서를 바꾸거나 앞에
encounter를 끼워 넣으면 policy도 같은 PR에서 고쳐야 합니다.

`m7-tutorial.test.ts`가 onboarding 구간의 보상을 **card 전용**으로 고정합니다 — baseline 장비
9종은 전부 누군가의 시작 장비라 보상으로 주면 dead choice이기 때문입니다.

### 9.3 보상 설계 규칙

- **한 offer = 한 개 획득.** 여러 item이 필요한 build는 서로 다른 offer에 흩어져야 합니다(§5.3).
- 이미 착용 중인 장비를 보상으로 주지 않습니다(dead choice).
- 카드 보상은 받는 사람의 `preparedCardCapacity`에 여유가 있어야 실제로 쓰입니다. 현재 각
  Starter는 여유 슬롯이 1칸이므로, 카드 보상을 늘리면 **후반 보상이 갈 곳을 잃습니다**
  (`docs/m7-playtest-report.md` §6-1).
- 선택지가 실제로 다른 결과를 만드는지는 `npm run playtest`로 확인합니다(§12).

### 9.4 Golden example — `adventure.goblin-trouble`

```jsonc
{ "id": "adventure.goblin-trouble", "partySize": { "min": 1, "max": 3 },
  "encounterIds": ["encounter.road-ambush", "encounter.spear-line", "encounter.ruined-gate",
                   "encounter.goblin-chief",           // ← tutorial prefix 4개는 여기까지
                   "encounter.bone-cellar", "encounter.wolf-run",
                   "encounter.archer-perch", "encounter.cult-sanctum"],
  "rewards": [
    { "id": "reward.road-ambush", "afterEncounterId": "encounter.road-ambush",
      "choices": [ { "kind": "card", "definitionId": "card.brace-behind-cover" },
                   { "kind": "card", "definitionId": "card.careful-advance" },
                   { "kind": "card", "definitionId": "card.force-barrage" } ] },
    { "id": "reward.goblin-chief", "afterEncounterId": "encounter.goblin-chief",
      "choices": [ /* equipment 4종 중 1개 */ ] }
  ] }
```

**범위 밖**: 두 번째 production Adventure, 분기 그래프, quest state, 새 objective,
tutorial scripting DSL. 전부 architecture/product 결정입니다.

---

## 10. Reachability / reserve

production gate(`npm run content:production-check`)는 authoritative Adventure에서 출발해
그래프를 따라갑니다.

```text
Adventure → encounterIds → placements → actor definition
Adventure rewards → card / equipment (starter가 실제로 쓸 수 있는지 validatePartyLoadout으로 확인)
Actor starterLoadout / baseCardGrants → deriveTacticalDeck → equipment trait provider → card
```

네 가지 상태만 있습니다.

| 상태 | 결과 |
|---|---|
| reachable + reserve 아님 | 정상 |
| unreachable + explicit reserve (reason + `#issue`) | 정상 |
| unreachable + reserve 아님 | **`PRODUCTION_ORPHAN` 실패** |
| reachable + reserve | **`RESERVE_STALE` 실패** — 목록이 이유보다 오래 살지 못하게 합니다 |

reserve entry는 조용한 면제가 아니라 검증되는 주장입니다: 실재하는 ID(`RESERVE_UNKNOWN_ID`),
목록 안팎에서 한 번만(`RESERVE_DUPLICATE`), 이유 문자열(`RESERVE_MISSING_REASON`), 이를 정리할
issue(`RESERVE_MISSING_FOLLOW_UP`), tutorial prefix와 충돌 없음(`RESERVE_TUTORIAL_CONFLICT`).

**두 종류의 reachability를 구분합니다.**

| 집합 | 세는 것 | 쓰는 곳 |
|---|---|---|
| used | release가 사용하는 정의 (enemy가 착용한 장비 포함) | orphan / stale / visual coverage |
| player-ownable | 플레이어가 가질 수 있는 것 (starter kit + Adventure 보상) | `reachableMinimum` floor |

새 정의를 바로 reserve에 넣는 것은 자동 통과가 아닙니다. authored 총량은 `volume` 상한에
걸리고, 목록 자체가 리뷰 대상입니다. 이미 도달 가능한 것을 reserve로 내리면
`reachableMinimum` floor에 걸립니다.

**policy는 QA 설정이지 gameplay가 아닙니다.** `src/` 어느 파일도 `m7-production-policy`를
import할 수 없습니다(`POLICY_LEAKED_INTO_RUNTIME`).

---

## 11. Golden path — Asset

> **Files to edit** `art/source/**/*.png`, `art/source/generation-plan.json`
> **Do not edit** `art/processed/**`, `presentation/m3/**`, `public/assets/**`
> **최소 검증** `npm run assets` (build + check, 전체 DoD는 §12)

### 11.1 무엇이 필요한가

| 정의 | 필요한 asset | plan mode |
|---|---|---|
| playable Character / Creature | front + back 두 면이 한 장에 나란히 있는 sheet | `two-sided-actor` + `definitionId` |
| Card | UI icon | `ui-icon` + `presentation.cardVisuals` 매핑 |
| Equipment | UI icon | `ui-icon` + `presentation.equipmentVisuals` 매핑 |
| 새 terrain trait | 정사각 top-down terrain master | `square-terrain` + `presentation.terrainVisuals` |
| 새 point prop (상자·레버·통) | 한 칸 위에 서는 소품 | `grounded-object` + `presentation.objectVisuals` |
| 새 tile-bound structure (벽·문) | 한 칸을 통째로 차지하는 구조물 | `tile-structure` + `presentation.objectVisuals` |

**source 해상도와 출력 canvas는 다릅니다.** source PNG는 크게 그리고(현재 actor sheet 관례는
1024×1536, front|back 2칸), plan의 `grid: {rows, cols}`가 그 장을 프레임으로 자르며,
`canvas`가 **정규화된 출력 크기**입니다.

```jsonc
{ "input": "art/source/actors/aerin-front-back.png", "mode": "two-sided-actor",
  "definitionId": "hero.aerin",                       // ← 이 값이 actorVisuals 키가 됩니다
  "grid": { "rows": 1, "cols": 2 },
  "canvas": { "width": 256, "height": 384 },          // 정규화 출력 (actor 규격)
  "frames": [ { "assetId": "actor.hero.aerin.front", "side": "front", "kind": "actor",
                "anchor": { "x": 0.5, "y": 1 }, "displaySize": { "height": 152 } },
              { "assetId": "actor.hero.aerin.back",  "side": "back",  "kind": "actor",
                "anchor": { "x": 0.5, "y": 1 }, "displaySize": { "height": 152 } } ],
  "prompt": "Reference art/STYLE.md, ..." }
```

세 층을 구분하세요. 앞의 둘은 기계가 잡고, 마지막은 사람이 지켜야 합니다.

| 층 | 무엇을 강제하는가 | 소유자 |
|---|---|---|
| **plan 검증** (`assets:build` 시작 시) | plan version 3, 배경 `transparent`, atlas 크기 2의 거듭제곱·padding 1–2, `frames.length == rows × cols`, assetId 유일, anchor `0..1`, **`two-sided-actor`의 side 순서가 정확히 `front → back`**, `definitionId` 존재, **모든 prompt가 `art/STYLE.md`를 참조** | `validatePlan()` in `tools/assets/build-assets.ts` |
| **산출물 검증** (`assets:check`) | processed canvas(actor 256×384, UI 256×256, object 폭 256\|384, terrain footprint 128×128), 알파 청결(모서리 배경·마젠타 잔여), manifest와 atlas의 frame·anchor 일치, atlas가 정사각·2의 거듭제곱, **Card/Equipment visual이 production 정의와 정확히 일치**, actor visual 양면 존재, tilemap 레이어 길이·팔레트 참조, **structure 계약(§11.4)과 gate 짝 일치** | `tools/assets/check-assets.ts` |
| **convention** (기계가 잡지 않음) | prop·actor anchor `(0.5, 1)`(발밑 접점), UI·terrain anchor `(0.5, 0.5)`, 좌우 동일 feet line·동일 정체성, 투영·팔레트·조명 기준 | `art/STYLE.md` |

마지막 층이 위험합니다 — actor anchor를 `(0.5, 0.4)`로 적으면 범위 검사(0..1)는 통과하고
화면에서 발이 뜹니다. 새 source를 넣을 때는 비슷한 기존 plan 항목을 복사해 시작하세요.

`art/STYLE.md`는 참조 의무가 있는 기준 문서입니다 — 투시/아이소메트릭/3D 렌더/바닥 정렬
캐릭터는 source에서 금지이고, 배경은 투명이어야 합니다. build가 가장자리 잔여를 정리하지만
`assets:check`가 모서리 배경과 마젠타 오염을 다시 봅니다.

### 11.2 reserve라고 아이콘을 빼면 안 됩니다

`assets:check`는 manifest의 `equipmentVisuals` / `cardVisuals` 키 집합이 **production pack의
정의 전체와 정확히 일치**하는지 봅니다. 하나라도 빠지거나 남으면 실패합니다. 즉 도달 불가능한
reserve Card/Equipment도 아이콘이 있어야 합니다. Actor visual은 production gate가
**Adventure에 등장하는 actor + 4 Starter**에 대해 요구합니다.

### 11.3 pipeline

```bash
npm run assets        # = assets:build && assets:check
```

`assets:build`가 하는 일: source PNG를 프레임으로 자르고 정규화(`art/processed/**`), 4096²
WebP atlas와 `public/assets/m3-atlas.{webp,json}` 생성, `presentation/m3/asset-manifest.json`
과 `asset-sources.json` 작성, **production pack의 Scenario에서 `tilemaps.json` 생성**, QC 출력.

`assets:check`가 보는 것: atlas가 정사각·2의 거듭제곱인지, frame 기하와 anchor가 manifest와
atlas에서 일치하는지, 알파가 깨끗한지(모서리 배경·마젠타 잔여), actor 256×384 / UI 256×256
캔버스, 양면 actor visual, tilemap 레이어 길이와 팔레트 참조, 그리고 §11.2의 정확 일치.

### 11.4 Tile-Bound Structure (벽·문) 만들기

벽과 문은 **한 칸을 차지하는 구조물**이고, 상자·레버 같은 point prop과 규격이 다릅니다.
point prop은 authored height로 그려지고 폭이 따라오지만, structure는 **폭이 정확히 한 칸**이고
높이가 그림을 따라옵니다. 낮은 벽과 높은 벽은 실루엣만 다르고 폭은 같습니다.

```jsonc
{ "input": "art/source/objects/wall.png", "mode": "tile-structure",
  "grid": { "rows": 1, "cols": 1 },
  "canvas": { "width": 256, "height": 112 },          // 폭은 항상 256, 높이는 구조물마다
  "frames": [ { "assetId": "object.wall", "kind": "object",
                "anchor": { "x": 0.5, "y": 1 },
                "displaySize": { "width": 128 },       // runtime 폭 = terrain cell 1칸
                "footprint": { "width": 128, "height": 128 } } ],
  "prompt": "Reference art/STYLE.md, ..." }
```

`displaySize.height`를 적으면 `assets:check`가 거부합니다 — 높이는 그림이 정합니다.

#### prompt recipe

```text
2D high detailed Japanese anime style
fixed front-facing upright tile-bound structure
exactly one terrain-cell wide
drawing touches the left and right edges of the frame
clear horizontal bottom contact baseline on the bottom edge
transparent background
no ground plane, no baked floor shadow
no perspective, no isometric diamond, no camera convergence
upper-left key light
crisp thick dark outline, narrow light paper border
readable silhouette
no character, no text, no UI
```

변형은 실루엣 높이로만 표현합니다.

```text
low wall   -> broad one-cell-width silhouette, intentionally low elevation
high wall  -> same one-cell-width silhouette, clearly taller elevation
gate       -> one-cell-wide fixed gate frame, posts inside the structure width
```

**gate open은 새로 그리지 않습니다.** 승인된 closed gate를 reference로 주고 frame·posts·
baseline·canvas·bounds를 그대로 두게 한 뒤 문짝 상태만 바꿉니다. `assets:check`가 두 상태의
canvas와 ink 경계가 같은지 봅니다.

#### QC 체크리스트

- [ ] 배경 투명, 바닥·그림자·투시 baked 없음
- [ ] 그림이 프레임 좌우 끝에 닿고 아래 끝에 서 있음
- [ ] anchor `(0.5, 1)`, `displayWidth` 128, `footprint` 128×128, `displayHeight` 없음
- [ ] 낮은/높은 변형은 높이로만 구분
- [ ] gate open/closed의 bounds·baseline 동일
- [ ] `npm run assets`
- [ ] 1024×768 전투 화면에서 near/far row 모두 칸 폭과 정렬 (`data-structure-fit` 비율 1.0)

#### 작업 순서

```text
1. gameplay trait는 Scenario author가 §8에서 따로 고릅니다 (blocked / gate / impassable)
2. art/source/objects/... source 생성
3. generation-plan에 tile-structure frame 등록
4. npm run assets
5. 전투 화면에서 정렬 확인
```

**asset 생성과 gameplay 의미 부여는 같은 단계가 아닙니다.** 구조물 그림은 통행 가능 여부를
정하지 않습니다 — `blocked`는 land·fly 모두 막고, `impassable`은 land만 막으며 fly는 기존
resolver대로 지나갑니다. 벽을 높게 그려도 규칙은 그대로입니다.

---

## 12. Validation / Definition of Done

각 golden path의 **최소 검증**은 그 변경을 되돌려 볼 수 있는 최소 명령이고, 아래는 PR을 올릴 때
지나야 하는 **production DoD**입니다.

```bash
npm run assets        # asset을 건드렸다면 (build + check)
npm run check         # content:check → content:production-check → assets:check
                      #   → typecheck ×4 → lint → test:unit
npm run build         # client + server 번들
npm run test:network  # 실제 HTTP/WebSocket 세션으로 Adventure 완주
npm run test:smoke    # 실제 브라우저(Playwright)로 보드·보상·loadout 경로
```

| command | 무엇을 소유하는가 |
|---|---|
| `content:check` | **모든** pack의 구조/참조/컴파일/fingerprint (m3·m6 fixture 포함) |
| `content:production-check` | 현재 M7 release policy: volume, reachability/reserve, tutorial prefix, starter loadout, 1P/2P/3P 구조적 조립, AI 정적 참조, visual coverage |
| `assets:check` | 생성 asset 무결성 + Card/Equipment visual 정확 일치 |
| `test:unit` | mechanics + content 회귀 (`src/**/*.test.ts`) |
| `test:network` | server/session/progression 실제 경로 |
| `test:smoke` | 브라우저/presentation/loadout 실제 경로 |

`npm run playtest -- --seeds N`은 gate가 아니라 조사 도구입니다. **encounter 배치·creature 수치·
보상 구성·starter 능력치처럼 balance에 닿는 변경을 했다면** 같은 seed로 전후를 비교하세요.
출력 형식과 해석 한계는 `docs/m7-playtest-report.md`에 있습니다.

### Definition of Done 체크리스트

- [ ] 새 정의가 도달 가능하거나 explicit reserve에 이유와 함께 있다
- [ ] 아이콘/standee source와 `generation-plan.json` 매핑이 있다
- [ ] `npm run assets`로 생성물 갱신 (asset을 건드렸다면)
- [ ] `npm run check` 통과
- [ ] gameplay data가 바뀌었으면 `manifest.json`의 `version`을 올렸다
- [ ] balance에 닿았으면 같은 seed playtest 전후 비교를 남겼다
- [ ] 이 문서가 소유한 계약을 바꿨다면 **같은 PR에서 이 문서도 고쳤다**(§14)

---

## 13. Extension decision tree

```text
새 콘텐츠 요구
   │
   ├─ 현재 schema + generic Action/Trait/Condition/resolver로 표현 가능한가?
   │     ├─ YES → content-only authoring (§4–§9)
   │     └─ NO
   │          ├─ 기존 domain 안의 작고 재사용 가능한 generic primitive인가?
   │          │     예: 새 effect primitive, 새 statistic selector, 새 objective kind
   │          │     → Rule Extension issue로 분리. 콘텐츠 PR에서 몰래 넣지 않습니다.
   │          └─ NO → subsystem milestone으로 DEFER
   │                  예: usage-limit, 지속 자원, 분기 Adventure, quest state
   │
   ├─ 표현 가능하더라도 현재 release envelope 안인가? (§1.3)
   │     ├─ YES → routine production change
   │     └─ NO  → policy/product 결정. threshold를 조용히 올리지 않습니다.
   │
   └─ visual이 필요한 production 정의인가?
         → asset source + generation plan까지 끝나야 Done (§11)
```

### 절대 금지

- content ID별 `if` / `switch` (엔진이 특정 카드·creature 이름을 아는 것)
- Card 전용 executor, Creature 전용 AI script/DSL
- validator 우회 flag, gate를 건너뛰는 환경 변수
- JSON 안의 script / 함수 이름 / 수식 문자열
- 예제나 테스트를 통과시키려고 release envelope threshold를 올리는 것

**왜 hack 대신 Rule Extension인가**: 이 저장소의 전투는 `buildResolvedActionPlan()` →
`executeResolvedAction()` 하나를 지나고, preview와 실행이 같은 plan을 씁니다. 한 카드만 특별
취급하면 preview·실행·replay·AI·네트워크 재검증이 각자 다른 규칙을 갖게 되고, 결정론과 replay
identity가 깨집니다. generic primitive로 올리면 그날 이후 모든 콘텐츠가 그것을 씁니다.

---

## 14. Maintenance contract

다음 계약의 owner를 바꾸는 PR은 **같은 PR에서 이 문서를 갱신**합니다.

```text
content schema / ContentPackSource DTO
Action / Trait / Condition authoring capability
Character 파생 / Creature fixed stat 계약
Equipment / loadout / collection 계약
Scenario / party-size / objective 계약
Adventure / reward 계약
production release policy / reserve semantics
asset generation / check workflow
표준 validation / CI gate
```

이 문서의 가변 수치는 전부 §1.3 표에 machine owner 경로와 함께 모아 두었습니다. 새 수치를
본문에 적을 때도 같은 규칙을 따르세요 — **숫자 옆에 그 숫자를 강제하는 파일**을 적습니다.

---

## 15. 처음 읽는 사람을 위한 빠른 답

| 질문 | 답이 있는 곳 |
|---|---|
| 의미 있는 Equipment를 어떻게 추가하는가 | §5 (§5.2 기준, §5.3 offer 배타성, §5.4 소유권) |
| Creature를 추가해 1P/2P/3P로 배치하는가 | §7 + §8.2 |
| 기존 primitive만으로 Card + Action을 추가하는가 | §4 (§3.2 primitive 목록) |
| Character에서 authored와 derived의 경계는 | §6.1 / §6.2 |
| 보상이 다음 전투에 반영되는지 어디서 확인하는가 | §9.1, §12 (`test:network`, `test:smoke`, `playtest`) |
| 33번째 Card / 5번째 Character / 두 번째 Adventure가 왜 routine이 아닌가 | §1.3 / §1.4 |
| visual source는 어디에 넣고 어떤 파일은 건드리면 안 되는가 | §11 / §1.1 |
| 현재 primitive로 표현 안 될 때 왜 hack 대신 Rule Extension인가 | §13 |

### 더 읽을 것 (선택)

routine authoring에는 필요 없습니다. 왜 지금 이 수치인지 알고 싶을 때만 보세요.

```text
docs/m7-card-capability.md    #13 카드 라이브러리 설계와 AoN 대조
docs/m7-starter-builds.md     #14 Starter 4명 설계
docs/m7-creature-roster.md    #15 creature role 설계
docs/m7-encounter-matrix.md   #16 encounter × party-size 설계
docs/m7-equipment-matrix.md   #17 장비 trade-off 설계
docs/m7-vertical-slice.md     #19 Adventure 조립 기록
docs/m7-production-gate.md    #20 release gate 설계
docs/m7-playtest-report.md    #21 자동 플레이 측정과 balance 근거
content/README.md             pack 디렉터리 landing page
```
