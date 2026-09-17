# 테스트 방법

## 작업 중 검증

- 수정 중에는 영향받는 테스트 파일과 시나리오만 실행한다. 관련 단위 테스트, Browser Unit, 짧은 E2E 순으로 문제를 좁힌다.
- UI의 선택자·페이지 이동·확정 동작은 짧은 검사로 먼저 확인한다. 이를 확인하기 위해 여러 전투를 진행하는 긴 E2E를 반복 실행하지 않는다.
- 테스트 실행 중에는 해당 코드나 테스트를 수정하지 않는다. Vite 재로드로 실행 중인 검사가 깨지거나 서로 다른 코드 상태를 검증하지 않게 한다.
- 실패하면 해당 항목만 재현하고 수정한 뒤 재검사한다. 원인 확인 없이 전체 검사를 반복하거나 timeout을 늘리지 않는다.

아래 `<test-file>`은 해당 계층의 테스트 파일 경로로 바꾼다.

| 계층 | 선택 실행 명령 |
| --- | --- |
| Unit / Node | `npx vitest run <test-file>` |
| Unit / Browser | `npx playwright test --config playwright.browser-unit.config.ts <test-file>` |
| Integration | `npx vitest run --config vitest.integration.config.ts <test-file>` |
| E2E | `npx playwright test <test-file>` |
| Recovery | `npx playwright test --config playwright.recovery.config.ts <test-file>` |

단일 시나리오는 Vitest의 `-t` 또는 Playwright의 `--grep`으로 제한한다. Recovery를 선택 실행할 때도 현재 코드의 `npm run build` 결과가 먼저 있어야 한다.

## 수정 완료 후 로컬 CI Full

실행 코드·콘텐츠·설정·테스트 변경을 마친 뒤에는 최종 변경 상태에서 CI Full을 한 번 완주한다. 기준은 `.github/workflows/ci-pr.yml`과 `package.json`이며, 두 파일의 명령이 바뀌면 이 문서도 맞춘다.

환경 준비:

- CI와 같은 Node.js 24 및 프로젝트에서 요구하는 npm 버전을 사용한다.
- 새 환경이나 의존성/lockfile 변경 시 `npm ci`로 설치한다.
- Chromium과 시스템 의존성이 없는 환경에서는 `npx playwright install --with-deps chromium`을 실행한다.
- 검사에 필요한 포트를 확보하고 기존 개발 서버를 재사용하지 않는다. 기존 개발 데이터는 임의로 삭제하지 않는다.
- E2E는 `tools/dev-coop.ts --isolated-test`로 실행마다 임시 DB와 테스트 계정을 생성하고 종료 시 정리한다. 누적된 개발 캠페인 수가 테스트 시간이나 결과에 영향을 주지 않도록 `.data/cardguild.dev.sqlite`를 사용하지 않는다.

프로젝트 루트에서 다음 명령을 순서대로 실행한다.

```sh
CI=true npm run check && CI=true npm run build && CI=true npm test
```

- `check`: 콘텐츠·에셋 검증, TypeScript, ESLint.
- `build`: 클라이언트와 배포 서버 빌드.
- `test`: Unit / Node → Unit / Browser → Integration → E2E → Recovery 순서로 실행한다. Recovery는 앞서 만든 배포 빌드를 사용한다.
- 계층별 검사를 별도 프로세스로 동시에 돌리지 않는다. Integration의 파일 직렬 실행과 Recovery의 worker 1 설정을 유지한다.
- Full에서 실패하면 실패 항목을 좁혀 수정·확인한 뒤, 최종 변경 상태에서 위 Full 명령을 다시 완주한다. 이전 실행과 부분 재실행 결과를 합쳐 최종 Full 통과로 보고하지 않는다.
- 로컬 Full 통과는 GitHub CI를 대체하지 않는다.
- 실행 동작에 영향을 주지 않는 문서만 수정한 경우에는 문서 내용과 `git diff --check`를 확인하며, Full을 불필요하게 실행하지 않는다.

## 대기와 결과 보고

- 임의의 `sleep`이나 `waitForTimeout` 대신 DOM 상태, 서버 응답, revision, 이벤트 등 실제 완료 조건을 기다린다.
- 일정 시간 동안 동작이 발생하지 않음을 검증해야 하는 경우에만 고정 대기를 사용하고 이유를 명시한다. 가능한 계층에서는 가상 시간이나 주입 가능한 시계를 우선한다.
- timeout은 실패 상한이다. 일반 조작과 긴 전투·재시작 시나리오의 상한을 구분하고, timeout 증가로 잘못된 선택자나 누락된 상태 전이를 숨기지 않는다.
- UI의 기본 화면 검증 기준은 1024×768 가로 모드다. 좁은 화면 검사는 레이아웃·반응형 동작에 영향이 있을 때의 보조 회귀 검사로 사용한다.
- 완료 보고에는 실행한 검사, 성공·실패·미실행 범위, 최종 로컬 Full 통과 여부를 구분한다. 테스트 수집 결과를 통과 결과로 취급하지 않는다.
