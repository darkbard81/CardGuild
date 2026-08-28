# Issue #2 Review Disposition

Review comment:
https://github.com/darkbard81/CardGuild/issues/2#issuecomment-5450181277

Reviewed commit: `3f522abec00f695971cc5486580caa7db0dae7f2`

## 수정

### Validation diagnostics에 pack ID 출력

판정: 합당함. M1의 `ContentValidationIssue`는 `packId`를 보존했지만 최종
`formatContentValidationIssue()`가 이를 출력하지 않아 Issue #2의 diagnostics
contract를 완전히 충족하지 못했다.

조치:

- formatter 출력에 `Pack`, `Source`, optional `Definition`, `Path`, code/reason을
  명시적으로 포함한다.
- manifest를 해석할 수 없는 parse 단계는 `Pack: unknown`으로 표시한다.
- structural issue와 semantic issue 각각에 formatter 회귀 테스트를 둔다.

## 보류

### Scenario/Actor placement 모델

판정: 합당한 후속 설계 항목이나 M1 blocker는 아님.

현재 M1은 단일 M0 scenario migration을 목표로 하므로 `actors.json`의
`ActorSetup.position`과 단일 `scenario.json`이 요구 범위를 충족한다. 여러
Encounter에서 같은 Actor 정의를 재사용하는 M2 시작 시 다음을 함께 설계한다.

- 재사용 가능한 Actor definition과 encounter-side spawn/placement 분리
- scenarios registry 또는 `scenarios[]` authoring shape
- scenario별 position/facing 및 필요한 override 범위
- 기존 schemaVersion 1 pack migration 정책

이 변경을 M1 schema에 미리 넣으면 M2의 Adventure/Encounter 모델이 확정되기 전에
authoring contract를 추측하게 되므로 M2로 보류한다.

### Runtime dispatch의 ContentIdentity 강제

판정: 합당한 후속 안전성 항목이나 M1 blocker는 아님.

M1 replay는 loaded/replay identity를 command 실행 전에 검증한다. 현재 local runtime은
M0 compiled pack 하나를 controller가 소유하므로 caller가 임의 content를 선택하는
session 경계가 없다. M4 server-authoritative co-op에서는 다음을 구현한다.

- authoritative session이 `CombatDefinition`과 `ContentIdentity`를 소유
- client/host handshake에서 pack ID/version/fingerprint 비교
- dispatch API에서 caller-supplied content 대신 session-bound content 사용
- identity mismatch command를 state mutation 전에 거절

네트워크 session/ownership이 없는 M1에서 dispatch signature만 부분 변경하는 대신
M4 authoritative boundary와 함께 구현하도록 보류한다.

## 조치 없음

### GitHub Actions status 부재

리뷰 환경 메모이며 구현 결함 판정이 아니다. Issue #2가 GitHub Actions workflow를
명시적으로 범위 밖으로 두고 있으므로 로컬 deterministic command contract와 전체
검증 결과를 유지하고 별도 CI 변경은 하지 않는다.
