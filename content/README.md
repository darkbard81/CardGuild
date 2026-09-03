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
content/m7   authoritative production pack (cardguild.m7@0.3.0)  ← 신규 콘텐츠는 여기에만
content/m6   M6 규칙 회귀 fixture (cardguild.m6@0.9.0)
content/m3   M4 회귀 fixture (cardguild.m4@0.6.0)
```

회귀 fixture는 이미 검증된 규칙을 고정하기 위해 존재합니다. content volume을 늘리려고 함께
수정하지 않습니다. M7 release 정책(volume/reachability)은 fixture에 적용되지 않습니다.

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
import합니다. barrel은 모든 milestone loader를 re-export하고 각 loader가 module scope에서
pack을 compile하므로, barrel을 거치면 M3/M6 fixture가 배포 bundle에 함께 들어갑니다. 테스트는
barrel을 계속 사용해도 됩니다.

## Pack 구조

각 pack directory는 다음 파일을 모두 가집니다.

```text
manifest.json    schemaVersion(현재 8), pack ID/version, ruleset ID
traits.json      모든 authored Trait과 Card/Action provider
conditions.json  Condition과 recovery provider Trait
actions.json     GameCore가 이해하는 effect primitive 조합
cards.json       Action을 참조하는 전술 카드
equipment.json   slot, 능력치, 무기/방어구 profile, Trait
actors.json      재사용 가능한 ActorDefinition (playable Character와 Creature)
scenarios.json   Encounter placement, objective, map tiles/objects, seat별 partySpawnSlots
adventures.json  linear Encounter 순서, 1–3P partySize, 고정 reward offer
```

무엇이 합법인지는 `schema/content-pack.schema.json`(JSON Schema Draft 2020-12)과
`src/content/validate-semantics.ts`가 소유합니다. 필드 형식이 맞아도 ID/reference가 잘못됐거나
배치가 충돌하면 semantic validation에서 실패합니다.

## 검증

```bash
npm run content:check             # 모든 pack: schema, reference, compile, fingerprint
npm run content:production-check  # PRODUCTION_CONTENT의 현재 M7 release policy
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

- `schemaVersion`은 JSON shape migration에 씁니다. 현재 값은 **8**이며, 호환되지 않는 shape
  변경은 기존 schema를 덮어써 조용히 재해석하지 말고 값을 올리고 명시적 migration을 추가합니다.
- `version`은 authored content revision입니다. 배포할 gameplay data가 바뀌면 올립니다.
- fingerprint는 canonical content 전체의 `fnv1a64` 값입니다. object key, definition 배열, tile
  입력 순서에는 영향받지 않지만 gameplay 값이 바뀌면 달라집니다. 직접 authoring하지 않습니다.
- replay의 pack ID/version/fingerprint가 로드된 pack과 다르면 GameCore는 command를 실행하기
  전에 거절합니다.
