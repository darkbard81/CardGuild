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
actors.json      전투 Actor setup
scenario.json    Actor ID 목록, map tiles와 objects
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
Pack: cardguild.m0
Source: content/m0/equipment.json
Definition: halberd
Path: [0].traits[1].id
UNKNOWN_TRAIT: Trait "tirp" is not defined.
```

## 작성 규칙

- ID는 category 안에서 고유해야 합니다. Action과 Trait처럼 서로 다른 category는
  같은 ID를 사용할 수 있습니다.
- Content에서 사용하는 모든 Trait ID를 `traits.json`에 먼저 등록합니다.
- Card, provider, Actor와 effect가 참조하는 ID는 같은 pack 안에 존재해야 합니다.
- 한 Actor에 같은 Equipment definition ID를 두 번 넣지 않습니다. 장비 instance가
  필요해지는 M3 전까지 duplicate equipment reference는 오류입니다.
- JSON에는 script, 함수명, JavaScript expression을 넣지 않습니다. 새로운 동작은
  GameCore에 알려진 discriminated effect primitive로만 표현합니다.
- `remove-condition`은 지정한 Condition ID를 즉시 제거합니다. 판정이 필요한
  회복은 `recovery-check`와 degree outcome을 사용합니다.

## Version과 fingerprint

- `schemaVersion`은 JSON shape migration에 사용하며 현재 값은 `1`입니다.
- `version`은 authored content revision입니다. 배포할 gameplay data가 바뀌면
  version을 올립니다.
- fingerprint는 canonical content 전체의 `fnv1a64` 값입니다. object key,
  definition 배열, tile 입력 순서에는 영향받지 않지만 gameplay 값이 바뀌면
  달라집니다.
- replay의 pack ID, version, fingerprint가 로드된 pack과 다르면 GameCore는
  command를 실행하기 전에 거절합니다.

Schema shape를 호환되지 않게 바꿀 때는 기존 schema를 덮어써서 조용히 해석하지
말고 `schemaVersion`을 올리고 명시적인 migration 또는 새 loader를 추가합니다.
