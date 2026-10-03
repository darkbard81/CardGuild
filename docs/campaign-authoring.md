# 캠페인 제작 도구

목표: 맵·인카운터·다이얼로그·보상을 편집하고, Codex가 데이터와 에셋으로 새 오브젝트를 추가할 수 있게 한다. 실행 중인 캠페인/계정 DB를 수정하는 관리 도구가 아니라 저장소 콘텐츠를 제작하는 개발 도구다.

## 실행과 파일 반영

```sh
npm run dev:campaign
# http://127.0.0.1:4193/campaign-editor.html

npm run campaign -- export /tmp/my-campaign.json
npm run campaign -- check /tmp/my-campaign.json
npm run campaign -- plan /tmp/my-campaign.json
npm run campaign -- apply /tmp/my-campaign.json
CI=true npm run check && CI=true npm run test:all
```

`export`는 기존 파일을 덮어쓰지 않는다. `check`는 JSON 구조, 기존 게임 컴파일러의 콘텐츠 규칙, 대사·이미지·높이·오브젝트 참조를 검사한다. 실제 이미지 파일의 존재·규격은 기존 에셋 검사에서 확인한다. `plan`은 변경할 파일 목록만 출력한다. `apply`는 내보낸 시점의 `baseRevision`을 비교하여 오래된 편집본을 거부하고, 검증이 끝난 파일 집합만 반영한다. 다른 작성자의 lock을 제거하지 않는다. 반영 도중 I/O 오류가 나면 이미 쓴 파일을 복원하며 외부 동시 변경은 덮어쓰지 않는다.

맵의 배포 타일맵도 같은 반영 작업에서 갱신한다. `tools/assets/build-assets.ts`와 CLI가 `src/presentation/build-tilemaps.ts`를 공유하므로 맵만 편집할 때 전체 이미지 아틀라스를 다시 만들 필요가 없다. 새로운 **이미지 원본**을 추가한 경우에는 먼저 `npm run assets:build`로 이미지·manifest를 생성해야 한다.

현재 UI 기능:

- 맵: 좌표 그리드·키보드 선택, 지면·통행 속성, 높이 0~8, 크기 변경, 오브젝트 배치. 크기 변경은 좌표별 높이를 보존하며 배치된 엔티티/연결 타일이 잘리는 변경을 거부한다.
- 인카운터: 이름·목표, 적 정의·좌표·방향·등장 인원, 1~3번 파티 시작 위치, 전멸 또는 지정 목표의 AND 승리 조건. 고급 JSON에서 추가 rules와 오브젝트를 편집할 수 있다.
- 진행 순서: 전장 복제·캠페인 연결, 위·아래 순서 이동, 이름·소개·엔딩 편집. 복제 시 높이·배경·장식과 출발 대사를 함께 복제한다.
- 다이얼로그: 해당 전장의 출발 대사 생성, 화자·표정·본문, 대사 추가·삭제, 실제 ScenePlayer 재생. 전체 프로젝트 JSON으로 길드 안내 등 다른 대사와 binding도 편집할 수 있다.
- 보상: 경험치와 장비·카드·동료 선택 보상. 선택 항목 추가와 전체 보상 JSON 편집.
- 오브젝트: ID·이름·이미지·동작으로 템플릿과 Trait를 함께 추가한 뒤 맵에 배치.
- 보관: JSON import/export, 브라우저 초안 저장·복원, 최근 30회 실행 취소/다시 실행. 검증 실패 시 입력과 이전 유효 초안을 유지한다. 게임의 로그인·세션 저장 키와 분리되어 있다.

## 파일 계약

프로젝트 구조는 `content/schema/campaign-project.schema.json`의 v1이다. `content`는 게임의 `ContentPackSource` 그대로이며 별도의 전투 규칙을 정의하지 않는다. `baseRevision`은 수정하지 않는다. 버전 업그레이드/migration은 아직 제공하지 않는다.

| 프로젝트 항목 | 반영 파일 |
| --- | --- |
| `content` | `content/m7/*.json`의 기존 카테고리 파일 |
| `activeAdventureId` | `content/m7/campaign.json` |
| `dialogue.scenes`, `dialogue.bindings` | `src/scene/campaign-dialogue.json` |
| `presentation.elevations`, `backgrounds`, `objects` | `presentation/m3/terrain-elevations.json`, `encounter-backgrounds.json`, `campaign-objects.json` |
| `presentation.scenery` | `art/source/generation-plan.json`의 `presentation.scenery` |
| 맵에서 파생한 배포 데이터 | `presentation/m3/tilemaps.json` |

현재 게임은 `activeAdventureId`로 선택한 캠페인을 읽는다. **콘텐츠 유효성 검사와 현재 출시 계약은 다르다.** 기존 production policy는 윌로우브룩 캠페인과 두 개의 staged 캠페인을 명시하고 있다. 따라서 신규 캠페인/기본 캠페인 변경의 출시 정책 연결은 아래 남은 작업에 포함된다. 편집기가 그 계약을 몰래 완화하지 않는다.

## Codex의 추가 오브젝트 절차

새 오브젝트를 만들 때 렌더러에 이름별 분기를 추가하지 않는다.

1. 프로젝트 `content.traits`에 고유한 terrain Trait를 정의한다. UI의 오브젝트 추가는 이 단계를 자동 수행한다.
2. `presentation.objects`에 동일한 ID, 한국어 이름, 등록된 `kind: object` 이미지 ID, 지원하는 interaction을 추가한다.
3. UI에서 배치하거나 `placeCampaignObject`로 배치한다. 파괴 오브젝트는 같은 칸에 `blocked`·`obstacle`을 붙이고 `targetTileId`를 정확히 연결한다. 레버는 실제 닫힌 성문 타일을 지정한다.
4. 새 이미지가 필요하면 `art/source/generation-plan.json`에 기존 `grounded-object` 형식의 원본·프레임을 추가하고 `npm run assets:build`를 실행한다. 생성된 이미지 ID를 템플릿 `visual`에 지정한다. 별도 오브젝트 이미지 URL을 임의로 런타임에 주입하지 않는다.
5. 프로젝트 check → plan → apply, 영향받는 검증과 최종 전체 gate를 수행한다.

기존 상자 이미지를 재사용하는 템플릿 예:

```json
{ "id": "supply-crate", "name": "보급 상자", "visual": "object.chest", "interaction": "destroy-obstacle" }
```

지원하는 동작은 현재 게임의 `destroy-obstacle`, `open-gate`다. 새로운 전투 동작은 GameCore의 Rule Extension을 먼저 구현해야 한다. 임의 JavaScript 실행이나 UI에서 별도 게임 규칙 계산은 허용하지 않는다.

## 검증과 남은 완료 조건

완료된 집중 검사: Domain 5개, Integration 4개, Interaction 3개. Domain은 실제 새 Trait/템플릿의 오브젝트 파괴·행동 소비·통행 해제를 포함한다. Integration은 임시 저장소에서 no-op 바이트 보존, 계획/반영, stale 거부, lock 소유권, 파일 반영 실패 시 복구, 새 맵의 배포 타일맵 동시 갱신을 확인한다. Interaction은 1024×768 Chromium에서 편집/오류 복구/복원/내보내기, 대사·보상·복제, 적·목표·시작 위치를 확인한다.

전체 목표는 아직 완료로 판단하지 않는다. 다음을 이어서 구현·검증해야 한다.

- 신규 캠페인 생성·선택을 UI와 출시 정책에 일관되게 연결하고, 기존 윌로우브룩 계약을 보존한다.
- 초안 맵을 실제 BattleView로 미리보기하여 높이·오브젝트·장식·파티 인원별 적 배치를 함께 확인한다.
- 편집 결과를 반영한 캠페인의 실제 출발 대사 → 전투 → 보상 흐름을 격리 환경에서 검증한다.
- 최종 전체 gate와 위 완료 조건의 증거를 바탕으로 최종 완료 여부를 감사한다.
