# CardGuild Content Packs

`content/`는 전투 콘텐츠의 authoring source입니다. `src/game`은 JSON이나 검증 도구를 직접 읽지
않고, `src/content`가 검증·컴파일한 plain object만 받습니다.

> **콘텐츠를 추가하려면 [`docs/PRODUCTION-BLUEPRINT.md`](../docs/PRODUCTION-BLUEPRINT.md)를
> 읽으세요.** Card / Equipment / Character / Creature / Encounter / Adventure의 golden path,
> 현재 release envelope, asset 절차, 검증 절차가 전부 그 문서 하나에 있습니다. 이 파일은
> 디렉터리 안내입니다.

## Pack 역할

각 pack directory는 독립적으로 compile되는 self-contained pack입니다. pack 상속이나 의존성
개념이 없으므로 어떤 pack도 다른 pack의 정의를 참조하지 않습니다.

```text
content/m7   authoritative production pack (cardguild.m7)  ← 신규 콘텐츠는 여기에만
```

`content/`에는 배포되는 pack 하나만 있습니다. 현재 authored revision은
`content/m7/manifest.json`이 소유하며 `check-content`가 identity와 fingerprint를
출력합니다. 이 문서는 그 값을 복제하지 않습니다.

**규칙 테스트의 최소 입력은 `tests/support`에 있습니다.** 테스트는 작은 typed builder와
공개 도메인 명령을 사용하며, 실제 여정은 production content를 사용합니다. 기존 회귀 pack은
제거했습니다. 계약과 assertion 소유권은 [위험 지도](../docs/test-risk-map.md)에 있습니다.

Production client와 authoritative server는 pack을 직접 import하지 않고
`src/content/production-content.ts`의 `PRODUCTION_CONTENT` 한 지점만 봅니다.

```text
client UI / battle rendering / WebSocket hello / authoritative server / asset build
        ↓
PRODUCTION_CONTENT   (src/content/production-content.ts)
        ↓
load-m7-content.ts   →   content/m7
```

Selector에는 environment switch나 dynamic loading이 없습니다. 이후 milestone에서 production
pack을 바꿀 때 이 파일이 import하는 loader만 교체합니다.

Production 코드는 barrel(`src/content/index.ts`)이 아니라 `production-content.ts`를 직접
import합니다. barrel에는 이제 fixture가 없지만, 이 한 지점을 통해서만 pack을 보는 규칙 자체는
그대로입니다. fixture를 production 코드에서 import하는 것은 ESLint가 막습니다.

## Pack 구조

각 pack directory는 다음 파일을 모두 가집니다.

```text
manifest.json    schemaVersion(현재 11), pack ID/version, ruleset ID
traits.json      모든 authored Trait(source/category/description 포함)과 Card/Action provider
conditions.json  Condition과 recovery provider Trait
actions.json     GameCore가 이해하는 effect primitive 조합
cards.json       Action을 참조하는 전술 카드
equipment.json   slot, 능력치, 무기/방어구 profile, Trait
ancestries.json  ancestry Trait ID → HP / speed / fixed boosts 2개
classes.json     class Trait ID → HP / key Attribute / starting proficiency / milestones
actors.json      ActorSource: Character Build·성장 이력 또는 Creature fixed stats
scenarios.json   Encounter placement, objective, map tiles/objects, seat별 partySpawnSlots
adventures.json  linear Encounter 순서, 1–3P partySize, 고정 reward offer, Encounter별 EXP
```

무엇이 합법인지는 `schema/content-pack.schema.json`(JSON Schema Draft 2020-12)과
`src/content/validate-semantics.ts`가 소유합니다. 필드 형식이 맞아도 ID/reference가 잘못됐거나
배치가 충돌하면 semantic validation에서 실패합니다.

## 검증

```bash
npx tsx tools/content/check-content.ts            # 모든 pack: schema, reference, compile, fingerprint
npx tsx tools/content/check-production-content.ts # PRODUCTION_CONTENT의 현재 M7 release policy
```

`content:check` 성공 시 pack identity와 fingerprint를 출력합니다. 실패하면 원본 파일,
definition, JSON path와 원인을 함께 출력합니다.

```text
Pack: cardguild.m7
Source: content/m7/equipment.json
Definition: halberd
Path: [0].traits[1].id
UNKNOWN_TRAIT: Trait "tirp" is not defined.
```

두 command의 차이와 나머지 gate는 `docs/PRODUCTION-BLUEPRINT.md` §12에 있습니다.

## Version과 fingerprint

- `schemaVersion`은 JSON shape migration에 씁니다. 현재 값은 **11**이며, 호환되지 않는 shape
  변경은 버전을 올리고 호환 정책을 명시합니다. M11-2는 Save v1 자동 migration을 등록하지 않습니다.
- `version`은 authored content revision입니다. 배포할 gameplay data가 바뀌면 올립니다.
- fingerprint는 canonical content 전체의 `fnv1a64` 값입니다. object key, definition 배열, tile
  입력 순서에는 영향받지 않지만 gameplay 값이 바뀌면 달라집니다. 직접 authoring하지 않습니다.
- replay의 pack ID/version/fingerprint가 로드된 pack과 다르면 GameCore는 command를 실행하기
  전에 거절합니다.


## Character Build와 성장

Character source는 `traits`에 ancestry/class를 정확히 하나씩 지정하고,
`statProfile: { kind: "character", build: { freeBoosts, trainedSkills }, level, advancements }`를 작성합니다.
Character의 최종 Attribute/Skill/Save/Armor/Weapon/Class DC와 `speedFeet`는 직접 작성하지 않습니다.
NPC에도 같은 규칙을 적용하고, authored level까지 필요한 성장 이력을 빠짐없이 작성합니다.
Creature는 `statProfile: { kind: "creature", stats: ... }`와 `speedFeet`를 그대로 작성합니다.

`src/character`의 pure resolver가 Build와 runtime progression을 합성합니다. EXP는 선택을 자동으로
채우지 않으며, pending 성장이 있으면 다음 전투가 막힙니다. Adventure의 Level-Up에서 현재
조종자가 가장 이른 성장부터 확정합니다. 저장 COMMIT 이후에만 선택이 실제 상태가 됩니다.

현재 production 클래스는 Player Core의 Bard/Cleric/Druid/Fighter/Ranger/Rogue/Witch/Wizard와
예외로 허용된 Champion, 총 9종입니다. 원전 선택 분기는 클래스별 고정 preset입니다.
[생성 규칙·preset·마이그레이션 표와 플레이테스트 비교](../docs/m11-2-character-progression-foundation.md)를 참조하세요.

이 release는 schema 11 / pack 0.6.0 / AdventureState 4 / Save 2 / protocol 8을 사용합니다.
SessionCoreState 3과 CombatState 4는 유지합니다. Save 1은 `SAVE_SCHEMA_UNSUPPORTED`,
이전 gameplay content는 `SAVE_CONTENT_MISMATCH`로 거절하며 저장 row를 덮어쓰거나 삭제하지 않습니다.
