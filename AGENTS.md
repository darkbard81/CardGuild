# 테스트 방법

## 작업 중 검증

- 수정 중에는 영향받는 테스트 파일과 시나리오만 실행한다. [정책](docs/testing-policy.md)과 [위험 지도](docs/test-risk-map.md)에 따라 실패를 검출할 수 있는 가장 낮은 계층이 assertion을 소유한다.
- UI 선택자·페이지 이동·확정 동작은 짧은 Interaction으로 먼저 확인한다. 이를 위해 여러 전투를 진행하는 Journey를 반복하지 않는다.
- 테스트 실행 중에는 해당 코드나 테스트를 수정하지 않는다. 실행 도중 Vite 재로드나 서로 다른 코드 상태가 섞이지 않게 한다.
- 실패 항목만 재현하고 원인을 수정한 뒤 재검사한다. 원인 확인 없이 전체 검사 반복 또는 timeout 증가를 하지 않는다.

| 계층 | 선택 실행 명령 |
| --- | --- |
| Domain | `npm run test:domain -- tests/domain/<file>.test.ts -t '<case>'` |
| Integration | `npm run test:integration -- tests/integration/contracts/<file>.test.ts -t '<case>'` |
| Interaction | `npm run test:interaction -- tests/interaction/<file>.spec.ts --grep '<case>'` |
| Journey | `npm run test:journey -- tests/journeys/<file>.spec.ts --grep '<case>'` |

파일 전체를 실행하려면 case filter를 생략한다. Integration의 프로세스 재시작과 Journey는 현재 코드의 `npm run build` 결과가 먼저 있어야 한다. `npm test`는 비브라우저 Domain + Integration이다.

## 수정 완료 후 로컬 전체 gate

실행 코드·콘텐츠·설정·테스트 변경을 마친 뒤에는 최종 상태에서 전체 gate를 한 번 완주한다. 전체 gate 기준은 `.github/workflows/ci.yml`과 `package.json`이며 명령 변경 시 이 문서도 맞춘다. main 대상 PR은 전체 gate를, main 이외 브랜치 push는 `.github/workflows/ci-quick.yml`의 `check → test:domain`을 실행한다. main push에는 테스트 workflow를 실행하지 않는다.

- Node.js 24와 npm 11 이상을 사용한다. 새 환경이나 의존성/lockfile 변경 시 `npm ci`로 설치한다.
- Chromium과 시스템 의존성이 없으면 `npx playwright install --with-deps chromium`을 실행한다.
- Interaction은 전용 Vite 포트를 사용하고 기존 서버를 재사용하지 않는다. Integration/Journey는 필요한 사례마다 임시 파일 DB·계정·서버 포트를 격리하고 성공·실패 모두 정리한다.
- `.data/cardguild.dev.sqlite`를 테스트에 사용하거나 기존 개발 데이터를 임의로 삭제하지 않는다.

```sh
CI=true npm run check && CI=true npm run test:all
```

- `check`: 콘텐츠·에셋·TypeScript·ESLint + 클라이언트와 배포 서버 build. 행동 테스트는 실행하지 않는다.
- `test:all`: Domain → Integration → Interaction → Journey를 각각 한 번 실행한다.
- 계층별 검사를 별도 프로세스로 동시에 돌리지 않는다. Integration 파일 직렬 실행과 브라우저 worker 1을 유지한다.
- 전체 gate 실패 시 실패 항목을 좁혀 수정·확인하고 최종 변경 상태에서 위 명령을 다시 완주한다. 이전 실행과 부분 결과를 합쳐 전체 통과로 보고하지 않는다.
- 로컬 전체 통과는 GitHub CI를 대체하지 않는다.
- 실행 동작에 영향 없는 문서만 수정했다면 문서 내용과 `git diff --check`를 확인하고 전체 gate를 불필요하게 실행하지 않는다.

## 대기와 결과 보고

- 임의의 sleep/`waitForTimeout` 대신 DOM 상태·서버 응답·revision·이벤트 등 실제 완료 조건을 기다린다.
- 일정 기간 동작이 발생하지 않음을 검증할 때만 고정 대기를 사용하고 이유를 명시한다. 가능한 계층에서는 가상 시간이나 주입 가능한 시계를 우선한다.
- timeout은 실패 상한이다. 일반 조작과 긴 여정·재시작의 상한을 구분하고 증가로 잘못된 선택자나 누락된 전이를 숨기지 않는다.
- 기본 UI 기준은 1024×768 가로 모드다. 입력 위험에 필요한 touch/resize 사례만 추가한다. touch 에뮬레이션을 실제 iPad 검증이라고 보고하지 않는다.
- 완료 보고에는 실행한 검사, 성공·실패·미실행 범위, 최종 로컬 전체 gate 통과 여부를 구분한다. 수집 결과는 통과 결과가 아니다.
- 실패 진단은 위험 ID·seed·request/revision을 포함한다. trace의 인증값은 공유 전에 `tools/testing/redact-artifacts.py`로 제거한다. 실행·비용·재현 안내는 [TESTING](docs/TESTING.md)에 있다.
