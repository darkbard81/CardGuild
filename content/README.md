# CardGuild Content Pack Authoring

`content/`는 전투 콘텐츠의 authoring source입니다. `src/game`은 JSON 파일이나
검증 도구를 직접 읽지 않고, `src/content`가 검증·컴파일한 plain object만 받습니다.

## Pack 역할

`content/` 아래 각 pack directory는 독립적으로 compile되는 self-contained pack입니다.
Compiler에는 pack inheritance/dependency 개념이 없으므로 어떤 pack도 다른 pack의
정의를 참조하지 않습니다.

```text
content/m7   authoritative production pack (cardguild.m7@0.2.0)
content/m6   M6 규칙 회귀 fixture (cardguild.m6@0.9.0)
content/m3   M4 회귀 fixture (cardguild.m4@0.6.0)
```

**새 Card/Creature/Equipment/Scenario/Adventure는 `content/m7`에만 추가합니다.**
`content/m6`와 `content/m3`은 이미 검증된 규칙 회귀 fixture이므로 content volume을
늘리기 위해 함께 수정하지 않습니다.

Production client와 authoritative server는 pack을 직접 import하지 않고
`src/content/production-content.ts`의 `PRODUCTION_CONTENT` 한 지점만 봅니다.

```text
client UI / battle rendering / WebSocket hello / authoritative server
        ↓
PRODUCTION_CONTENT   (src/content/production-content.ts)
        ↓
load-m7-content.ts   →   content/m7
```

Selector에는 environment switch나 dynamic loading이 없습니다. 이후 milestone에서
production pack을 바꿀 때 이 파일이 import하는 loader만 교체합니다. Milestone loader
(`load-m6-content.ts` 등)는 regression fixture용으로 그대로 남습니다.

Production 코드는 barrel(`src/content/index.ts`)이 아니라
`src/content/production-content.ts`를 직접 import합니다. Barrel은 모든 milestone loader를
re-export하고 각 loader가 module scope에서 pack을 compile하므로, barrel을 거치면 M3/M6
fixture가 배포 bundle에 함께 들어갑니다. 테스트는 barrel을 계속 사용해도 됩니다.

## Pack 구조

각 pack directory는 다음 파일을 모두 가집니다.

```text
manifest.json    schemaVersion, pack ID/version, ruleset ID
traits.json      모든 authored Trait과 Card/Action provider
conditions.json  Condition과 recovery provider Trait
actions.json     GameCore가 이해하는 ActionEffect primitive
cards.json       Action을 참조하는 전술 카드
equipment.json   능력치, 무기 profile, Trait
actors.json      재사용 가능한 ActorDefinition
scenarios.json   Encounter placement, objective, map tiles와 objects
                 static placement와 seat별 partySpawnSlots
adventures.json  linear Encounter 순서, 1–3P partySize와 fixed reward offer
```

Schema는 `schema/content-pack.schema.json`의 JSON Schema Draft 2020-12가
담당합니다. 필드 형식이 맞더라도 ID/reference가 잘못됐거나 map 배치가
충돌하면 semantic validation에서 실패합니다.

```bash
npm run content:check
```

성공 시 pack identity와 fingerprint를 출력합니다. 실패 시 예를 들어 다음처럼
원본 파일, definition, JSON path와 원인을 출력합니다.

```text
Pack: cardguild.m7
Source: content/m7/equipment.json
Definition: halberd
Path: [0].traits[1].id
UNKNOWN_TRAIT: Trait "tirp" is not defined.
```

## Release gate

`content:check`와 `content:production-check`는 서로 다른 질문을 합니다.

```text
npm run content:check              모든 milestone pack이 유효한 pack인가
npm run content:production-check   PRODUCTION_CONTENT가 지금 출시 가능한가
```

Generic validator에 `starter == 4`, `enemy >= 15` 같은 M7 volume을 넣으면 M3/M6 회귀
fixture까지 production 기준에 묶입니다. 그래서 release policy는 authoritative pack
하나에만 적용되며 `tools/content/m7-production-policy.ts`에 있습니다. CI는 이 파일을
source of truth로 읽고, `docs/`의 matrix 문서는 사람이 보는 design rationale로 남습니다.

Production check가 보는 것은 pack의 일반적 유효성이 아니라 **현재 release contract**입니다.

- volume — starter 4, card 24–32, enemy 15–20, scenario 8–12, equipment 20–30,
  Adventure encounter 6–8, tutorial prefix 3–4
- reachability — authoritative Adventure에서 출발해 encounter → placement → actor,
  reward → collection, starter loadout → equipment trait → card까지 따라가 도달하지
  못하는 정의를 찾습니다
- tutorial prefix — `tutorialEncounterIds`가 Adventure `encounterIds`의 **앞에서부터
  연속된 prefix**이며 순서까지 같은지
- 1P/2P/3P coverage — 실제 runtime(`createAdventureSession` → `buildAdventureEncounter`
  → `createCombat`)으로 모든 encounter를 조립해 seat/threat/중복 배치를 확인합니다
- required visual — reachable actor/equipment/card가 asset manifest에 있는지
  (asset 자체의 유효성은 계속 `assets:check`가 소유합니다)

Reserve는 orphan 검사를 면제하는 allowlist가 아닙니다. 각 항목은 실재하는 정의를
가리켜야 하고, 이유와 이를 정리할 issue를 함께 적어야 하며, **여전히 도달 불가능해야**
합니다. Adventure가 쓰기 시작한 정의가 reserve에 남아 있으면 `RESERVE_STALE`로
실패하므로 목록이 이유보다 오래 살아남지 못합니다.

`reachableMinimum`은 **이미 도달 가능한 정의를 reserve로 내려 release surface를 줄이는
것**을 막습니다. 새로 authoring한 정의를 곧바로 reserve에 넣는 경우는 reachable 수량을
건드리지 않으므로 `volume` 상한과 목록 자체의 review가 제한합니다. reserve 비율에 대한
별도 budget은 두지 않았습니다.

reachability에는 두 집합이 있습니다. orphan 검사와 visual coverage는 release가
**사용하는** 것(enemy가 착용한 item 포함)을 묻고, `reachableMinimum`은 플레이어가
**소유할 수 있는** 것(starter의 kit과 Adventure reward)만 셉니다. 현재 M7 enemy는
equipment도 baseCardGrant도 없어 두 집합이 같습니다.

Policy는 gameplay가 아니라 QA configuration이므로 `src/` 아래 어떤 파일도 import할 수
없습니다. import하면 `POLICY_LEAKED_INTO_RUNTIME`으로 gate가 실패합니다.

## 작성 규칙

- ID는 category 안에서 고유해야 합니다. Action과 Trait처럼 서로 다른 category는
  같은 ID를 사용할 수 있습니다.
- Content에서 사용하는 모든 Trait ID를 `traits.json`에 먼저 등록합니다.
- Card, provider, Actor와 effect가 참조하는 ID는 같은 pack 안에 존재해야 합니다.
- Equipment는 `weapon`, `armor`, `shield`, `feet` 중 정확한 `slot`을 선언합니다. slot은
  편성 metadata이며 효과는 계속 Statistic/Trait provider로 정의합니다.
- Actor는 `loadoutProfile.preparedCardCapacity`와 `starterLoadout`을 선언합니다.
  `baseCardGrants`는 Collection copy를 소비하는 prepared card와 분리합니다.
- Playable Actor는 `statProfile.kind = "character"`로 Level, 6 Attribute modifier,
  Perception/3 Save/16 General Skill proficiency rank를 저장합니다. 최종 Reflex,
  Athletics, Initiative modifier는 authoring하지 않습니다.
- Creature/Enemy는 `statProfile.kind = "creature"`로 최종 AC, Max HP, Save, Skill,
  Perception과 `strike`(최종 `attackModifier`, `rangeFeet`, flat `damage.modifier`,
  `traits`)를 간결하게 authoring할 수 있습니다. 두 profile 모두 runtime의 공통 statistic
  resolver를 사용합니다.
- Actor는 최종 `hp`, `maxHp`, `baseAc`를 authoring하지 않습니다. Playable Character의
  Max HP는 `defense.ancestryHp + level × (defense.classHpPerLevel + CON)`에서,
  AC는 `10 + capped DEX + armor proficiency + typed modifier`에서 파생됩니다.
  Creature는 `statProfile.stats`의 `ac`/`maxHp`를 그대로 사용합니다.
- Character `defense`는 `ancestryHp`, `classHpPerLevel`, 4개 `armorProficiencies`
  (`unarmored`/`light`/`medium`/`heavy`) rank를 선언합니다.
- Character `offense`는 `keyAttribute`, 4개 `weaponProficiencies`
  (`unarmed`/`simple`/`martial`/`advanced`) rank, `classDcProficiency`, 그리고
  `unarmedStrike`를 선언합니다. Class DC는 별도 숫자로 저장하지 않고
  `10 + key Attribute + classDcProficiency + typed modifier`에서 파생됩니다.
  Class DC와 Save/Skill DC는 서로 다른 statistic이며 하나로 합치지 않습니다.
- Playable weapon은 **무엇을 쓰는지**만 정의합니다. `weaponProfile`은 `name`,
  `category`, `attackMode`, `rangeFeet`, `damage`(`count`/`sides`/`damageType`),
  `traits`를 선언하며 최종 `attackModifier`나 Attribute를 복제한 flat
  `damage.modifier`는 schema에서 거부됩니다. Strike attack은
  `attack Attribute + weapon category proficiency + typed modifier + MAP`에서,
  damage는 `weapon dice + 합법적인 Attribute contribution + damage modifier`에서
  파생됩니다.
- Attack Attribute는 melee가 STR, ranged와 thrown이 DEX입니다. `finesse` melee는
  STR/DEX 중 resolved attack modifier가 높은 쪽을 결정적으로 선택하고 breakdown에
  실제 선택된 Attribute를 남깁니다. Damage는 melee와 `thrown`이 STR 전량,
  `propulsive`가 양수 STR의 절반(음수면 전량), 그 외 ranged는 0입니다.
- Weapon trait은 boolean field를 늘리지 않고 기존 Equipment/Trait pipeline을 씁니다.
  Equipment의 effective trait set은 `equipment.traits`와 `weaponProfile.traits`의
  합집합(ID 중복 제거)이고, Strike resolver·Card provider·Context Action provider·
  Statistic modifier stack이 **모두 같은 set**을 봅니다. 따라서 같은 trait ID를 어느 쪽에
  적더라도 Resolved Strike와 Trait provider의 결과가 갈라지지 않습니다.
- `agile` weapon으로 하는 Strike만 MAP이 `0 / -4 / -8`로 완화되고, 나머지와
  Athletics Trip 같은 Attack-trait Skill Action은 `0 / -5 / -10`을 씁니다.
  MAP 단계는 여전히 Attack trait 사용 횟수로 셉니다. Reactive Strike는 자기 turn 밖에서
  일어나므로 MAP이 적용되지 않습니다.
- Weapon damage roll은 penalty가 아무리 커도 최소 1입니다. Critical과 action
  multiplier는 그 최소값을 만든 뒤에 곱합니다. Resistance는 damage roll 이후 단계라
  이 최소값과 별개입니다.
- 실제 시작 무기는 Equipment + `starterLoadout.weapon`으로 소유합니다. weapon slot이
  비면 Character의 `offense.unarmedStrike`를 씁니다. Character ID별 fallback
  special-case는 없습니다.
- Equipment slot은 `weapon`/`armor`/`shield`/`feet`이고 이 순서가 deterministic한
  equipment 순서입니다. `weapon` slot equipment만 `weaponProfile`을 선언하며,
  선언이 없거나 다른 slot이 선언하면 거부됩니다. `armor` slot equipment만 `armorProfile`(`category`,
  `acItemBonus`, `dexCap`)을 선언하며, 다른 slot이 선언하면 거부됩니다. Armor를 입지
  않은 Character는 별도 item 없이 `unarmored` proficiency와 cap 없는 DEX로 resolve됩니다.
- `shieldBonus`는 `shield` slot equipment만 선언할 수 있습니다. Raise Shield는 착용한
  shield slot equipment의 값만 AC circumstance contribution으로 제공합니다.
- Armor의 `acItemBonus`는 Character AC 공식의 한 항이므로 Character에게만 적용됩니다.
  Creature의 authored AC는 완결된 top-down 값이라 장비 armor로 다시 올라가지 않습니다.
- Armor의 `acItemBonus`와 raised Shield의 `shieldBonus`는 authoring에서 중복 선언하지
  않습니다. Runtime이 각각 AC item / circumstance contribution으로 같은 modifier
  stack에 넣습니다.
- Equipment, Condition, Trait의 `statModifiers`는 statistic selector와
  `circumstance`/`item`/`status`/`untyped` type을 선언합니다. 같은 typed bonus/penalty는
  각각 가장 큰 값만 적용되고 모든 untyped penalty는 누적됩니다.
- PF2e Remaster에는 untyped bonus가 없습니다. `type = "untyped"`인 modifier는 penalty
  (`value < 0`)만 authoring할 수 있고, 양수 untyped는 schema와 semantic validation
  (`UNTYPED_MODIFIER_MUST_BE_PENALTY`) 양쪽에서 거부됩니다. Runtime context modifier도
  같은 invariant를 fail-fast로 강제합니다.
- Scenario의 `placements`에는 enemy/NPC/static actor만 작성하고 party hero는 넣지 않습니다.
  `partySpawnSlots`는 seat 1–3을 각각 한 번씩 선언합니다. 배열 순서가 아니라 `seat`가
  runtime 배치를 결정합니다.
- Spawn slot은 map bounds 안의 통행 가능한 서로 다른 위치여야 하며 static placement와
  겹칠 수 없습니다. 모든 Adventure Encounter는 `partySize.max`만큼 slot을 제공합니다.
- Adventure `partySize`는 현재 `{ "min": 1, "max": 3 }` contract입니다. 실제 roster의
  PartyMember ID와 authoritative starter loadout을 runtime에서 spawn slot에 merge합니다.
- `playable` Trait을 가진 Actor만 Party Builder 후보입니다. 현재 authoritative production
  pack은 `content/m7`의 `cardguild.m7@0.2.0`이고, `content/m6`의 M6 pack과 `content/m3`의
  M4 pack은 규칙 회귀 fixture로 보존합니다.
- JSON에는 script, 함수명, JavaScript expression을 넣지 않습니다. 새로운 동작은
  GameCore에 알려진 discriminated effect primitive로만 표현합니다.

## Action resolution

- `ActionDefinition`이 gameplay 규칙을 소유하고 `CardDefinition`은 `actionId` 참조와
  deck/provenance만 담당합니다. `SpellCardDefinition` 같은 카드 종류별 타입은 없습니다.
  `spell`/`focus`/`feat` 분류는 Trait metadata로만 남고 실행 분기 key가 되지 않습니다.
- Action은 `resolution`으로 판정 방식과 효과를 함께 선언합니다. 네 가지뿐입니다.
  - `move` — 판정 없음. 기존 path/reaction continuation을 씁니다.
  - `strike` — #9 `ResolvedStrikeProfile` vs 대상 AC(#8). `damageMultiplier`와
    4개 degree outcome을 가집니다.
  - `check` — `check.roller`(`actor`/`target`), `check.statistic`, `check.dc`와
    4개 degree outcome을 가집니다.
  - `direct` — 판정 없이 effect primitive를 authored 순서대로 실행합니다.
- `check.statistic`은 `skill`/`save`/`perception` 중 하나를 **이름으로** 가리킵니다.
  최종 `+N`을 카드나 액션에 적지 않습니다. `attributeOverride`는 Character에 이미 저장된
  Attribute modifier 중 어느 것을 이 판정에 쓸지 고르는 것뿐이며 proficiency rank를
  바꾸거나 Attribute를 새로 만들지 않습니다.
- `check.dc`는 `fixed` / `armor-class`(#8) / `statistic-dc`(#7) / `class-dc`(#9) 중
  하나이고 `owner`로 actor·target을 지정합니다. `spellAttackModifier`나 `spellDc` 같은
  별도 Character statistic은 추가하지 않습니다.
- degree outcome과 `direct.effects`는 같은 effect primitive 목록을 씁니다.
  `apply-condition` / `remove-condition` / `lock-action` / `damage` /
  `create-sustained-effect` / `sustain-effect` / `raise-shield` / `interact`.
  `owner`가 `target`인 primitive는 `targeting: "enemy"` Action에서만 쓸 수 있습니다.
- `range`는 Action이 무엇을 하는지와 분리됩니다. `weapon-reach`는 `strike`
  resolution이나 `attack` trait을 가진 Action에서만 허용되고, `feet`은 5의 양의 배수여야
  합니다. 선언이 없으면 5ft입니다.
- MAP은 카드 수치가 아니라 resolver context입니다. `attack` trait이 있으면 #9 MAP
  resolver가 적용하고, 자기 turn 밖의 Reaction에는 적용되지 않습니다.

## Version과 fingerprint

- `schemaVersion`은 JSON shape migration에 사용하며 현재 값은 `8`입니다.
- `version`은 authored content revision입니다. 배포할 gameplay data가 바뀌면
  version을 올립니다.
- fingerprint는 canonical content 전체의 `fnv1a64` 값입니다. object key,
  definition 배열, tile 입력 순서에는 영향받지 않지만 gameplay 값이 바뀌면
  달라집니다.
- replay의 pack ID, version, fingerprint가 로드된 pack과 다르면 GameCore는
  command를 실행하기 전에 거절합니다.

Schema shape를 호환되지 않게 바꿀 때는 기존 schema를 덮어써서 조용히 해석하지
말고 `schemaVersion`을 올리고 명시적인 migration 또는 새 loader를 추가합니다.
현재 pre-release repository에는 이전 pack runtime compatibility layer가 없으며 v6가
authoritative contract입니다.
