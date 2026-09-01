# CardGuild Content Pack Authoring

`content/`는 전투 콘텐츠의 authoring source입니다. `src/game`은 JSON 파일이나
검증 도구를 직접 읽지 않고, `src/content`가 검증·컴파일한 plain object만 받습니다.

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
Pack: cardguild.m5
Source: content/m5/equipment.json
Definition: halberd
Path: [0].traits[1].id
UNKNOWN_TRAIT: Trait "tirp" is not defined.
```

## 작성 규칙

- ID는 category 안에서 고유해야 합니다. Action과 Trait처럼 서로 다른 category는
  같은 ID를 사용할 수 있습니다.
- Content에서 사용하는 모든 Trait ID를 `traits.json`에 먼저 등록합니다.
- Card, provider, Actor와 effect가 참조하는 ID는 같은 pack 안에 존재해야 합니다.
- Equipment는 `weapon`, `shield`, `feet` 중 정확한 `slot`을 선언합니다. slot은 편성
  metadata이며 효과는 계속 Statistic/Trait provider로 정의합니다.
- Actor는 `loadoutProfile.preparedCardCapacity`와 `starterLoadout`을 선언합니다.
  `baseCardGrants`는 Collection copy를 소비하는 prepared card와 분리합니다.
- Scenario의 `placements`에는 enemy/NPC/static actor만 작성하고 party hero는 넣지 않습니다.
  `partySpawnSlots`는 seat 1–3을 각각 한 번씩 선언합니다. 배열 순서가 아니라 `seat`가
  runtime 배치를 결정합니다.
- Spawn slot은 map bounds 안의 통행 가능한 서로 다른 위치여야 하며 static placement와
  겹칠 수 없습니다. 모든 Adventure Encounter는 `partySize.max`만큼 slot을 제공합니다.
- Adventure `partySize`는 현재 `{ "min": 1, "max": 3 }` contract입니다. 실제 roster의
  PartyMember ID와 authoritative starter loadout을 runtime에서 spawn slot에 merge합니다.
- `playable` Trait을 가진 Actor만 M5 Party Builder 후보입니다. 현재 authoritative pack은
  `content/m5`의 `cardguild.m5@0.5.0`이고, `content/m3`의 M4 pack은 회귀 fixture로 보존합니다.
- JSON에는 script, 함수명, JavaScript expression을 넣지 않습니다. 새로운 동작은
  GameCore에 알려진 discriminated effect primitive로만 표현합니다.
- `remove-condition`은 지정한 Condition ID를 즉시 제거합니다. 판정이 필요한
  회복은 `recovery-check`와 degree outcome을 사용합니다.

## Version과 fingerprint

- `schemaVersion`은 JSON shape migration에 사용하며 현재 값은 `4`입니다.
- `version`은 authored content revision입니다. 배포할 gameplay data가 바뀌면
  version을 올립니다.
- fingerprint는 canonical content 전체의 `fnv1a64` 값입니다. object key,
  definition 배열, tile 입력 순서에는 영향받지 않지만 gameplay 값이 바뀌면
  달라집니다.
- replay의 pack ID, version, fingerprint가 로드된 pack과 다르면 GameCore는
  command를 실행하기 전에 거절합니다.

Schema shape를 호환되지 않게 바꿀 때는 기존 schema를 덮어써서 조용히 해석하지
말고 `schemaVersion`을 올리고 명시적인 migration 또는 새 loader를 추가합니다.
현재 pre-release repository에는 이전 pack runtime compatibility layer가 없으며 v4가
authoritative contract입니다.
