# CardGuild 테스트 체계

테스트는 **무엇을 붙잡고 있는가**로 나뉩니다. 계층이 다르면 실패가 가리키는 곳이 다르고,
고치는 방법도 다릅니다.

| 계층 | 붙잡는 것 | 실행 환경 | 케이스 | 비용 |
|---|---|---|---:|---|
| Unit / Node | 순수 규칙·변환·컴포넌트 계약 | Node, 외부 자원은 fake | 549 | ~8초 |
| Unit / Browser | 실제 DOM·PixiJS 컴포넌트에 상태와 콜백을 주입 | Chromium + Vite만 | 31 | ~1.2분 |
| Integration | 실제 SQLite·HTTP·WebSocket과 source 서버 장애 주입 | Node, 파일 DB와 자식 프로세스 | 100 | ~1.1분 |
| E2E | 실제 앱 진입부터 로그인·캠페인·협동 플레이까지 | Chromium + 개발 서버 묶음 | 25 | ~1.1분 |
| Recovery | 배포 artifact와 파일 DB의 실제 재시작·강제 종료 | `dist-server` + `dist` | 4 | ~30초 |

`npm test`가 다섯 계층을 위 순서대로 전부 돌립니다. 앞 계층이 실패하면 뒤는 실행되지
않습니다. Recovery는 배포 산출물을 쓰므로 **`npm run build`가 먼저** 끝나 있어야 합니다 —
없으면 다시 만들지 않고 그 사실을 말하며 실패합니다.

계층 하나만 돌릴 때는 underlying CLI를 직접 부릅니다. 조립용 alias는 없습니다.

```bash
npx vitest run                                                  # Unit / Node
npx playwright test --config playwright.browser-unit.config.ts  # Unit / Browser
npx vitest run --config vitest.integration.config.ts            # Integration
npx playwright test                                             # E2E
npx playwright test --config playwright.recovery.config.ts      # Recovery (build 선행)
```

## gate

```bash
npm run check   # 정적 검증: content·production policy·자산 검사, TypeScript 5종, ESLint
npm run build   # 배포 산출물: dist(client), dist-server(server bundle)
npm test        # 동적 검증: 위 다섯 계층
```

세 명령은 겹치지 않습니다. `check`는 파일을 만들지 않고 테스트를 돌리지 않으며, `build`는
검사하지 않고, `test`는 빌드하지 않습니다. 그래서 전체 gate에서 TypeScript도 client build도
정확히 한 번씩만 돕니다. CI가 실행하는 것도 이 셋뿐입니다.

`check`의 자산 검사는 **추적된 산출물을 검증**할 뿐 다시 만들지 않습니다. 자산 입력이나
생성 대상 콘텐츠를 바꿨다면 `npx tsx tools/assets/build-assets.ts`를 직접 돌리고 생성물을 함께
커밋하세요. gate가 자산을 조용히 고쳐 놓는 일은 없습니다.

## 디렉터리

```text
src/**/*.test.ts     Unit / Node — 검증 대상 코드 옆에 둔다
tests/unit/browser/  Unit / Browser
tests/integration/   Integration
tests/e2e/           E2E
tests/recovery/      Recovery
tests/support/       실행·통신·화면 조작 helper
tests/fixtures/      테스트 데이터와 상태 builder
```

## 계층을 가르는 기준

**Unit / Node** — 외부 자원이 없거나 fake입니다. DB 없이 fake connection과 fake durability로
도는 `SessionHost`, 저장 projection, campaign durability가 여기 있습니다. 이들은 순서와 경계를
검증하지 실제 저장을 검증하지 않습니다.

**Integration** — 실제 저장·전송 구현이 대상입니다. 메모리 SQLite도 여기입니다: 파일이 아닐
뿐 검증되는 것은 진짜 SQL 구현입니다. source에서 띄운 서버에 장애를 주입하는
`restart-matrix`와 COMMIT 전후 fault도 여기입니다 — 대상이 배포 artifact가 아니라 코드이기
때문입니다.

**Unit / Browser** — 컴포넌트 하나를 실제 DOM과 PixiJS 위에 올리고 상태와 콜백을 주입합니다.
**인증도 HTTP도 WebSocket도 없습니다.** harness가 `main.ts`를 대체하므로 앱은 시작되지
않습니다. 컴포넌트 테스트가 서버 때문에 실패하기 시작한다면 그것은 컴포넌트 테스트가
아닙니다.

**E2E** — 실제 앱을 실제 사용자처럼 씁니다. 화면이나 게임 상태를 직접 주입하지 않습니다.
같은 UI 세부 동작을 두 계층이 permutation만 바꿔 되풀이하지는 않습니다: 카메라 제스처, 뷰포트
회전, HUD 안쪽 board fit처럼 기하와 입력만 걸린 것은 Browser Unit이 여러 조합으로 검사하고,
E2E에는 실제 배선을 붙잡는 대표 사례 하나만 둡니다. 1024x768 최소 해상도의 board/HUD fit,
전송되는 intent의 정확한 모양, 3P 협동·로그인·campaign 소유·재접속처럼 서버 authority가
본질인 흐름은 E2E에 남습니다.

**Recovery** — 배포 산출물이 대상입니다. 테스트마다 전용 포트·임시 DB·전용 프로세스를 갖고,
재시작 전후로 같은 origin·포트·DB를 유지합니다. worker는 1입니다.

같은 기능을 여러 계층이 검사하는 것은 중복이 아닙니다. Continue는 Unit에서 순서를,
Integration에서 CAS를, Recovery에서 진짜 재시작을 붙잡습니다 — 셋 중 하나가 깨지면 나머지
둘이 어디가 깨졌는지 말해줍니다.

## 기다리는 방법

브라우저 테스트는 **관측되는 상태**를 기다립니다. `data-board-corners`,
`data-state-hash`, `data-session-revision`, `data-actor-feet`, `data-safe-area`, 그리고 화면과
컨트롤의 상태가 그 신호입니다. 고정 sleep은 빠른 러너에서 낭비이고 느린 러너에서 flaky인데,
`expect.poll`은 둘 다 아닙니다 — 준비되면 바로 가고, 안 되면 기다립니다.

**기다리는 대상은 원인이 아니라 최종 invariant입니다.** resize 뒤에 canvas가 새 폭을 받은
것만 보고 넘어가면, board는 이미 커졌는데 standee는 아직 옛 배율인 프레임을 읽을 수
있습니다 — CI #127이 정확히 그 프레임을 잡아 sprite를 1칸이 아니라 1.91칸으로 쟀습니다.
그래서 이제 검사할 값 자체(cell 대비 sprite 비율, 발이 서 있는 칸)가 제자리에 올 때까지
기다립니다.

같은 이유로 `settledBoard()`는 "멈췄다"가 "아직 시작하지 않았다"로 읽히지 않게 합니다.
연속 판독 사이에 실제 animation frame을 하나 끼워 넣고, 호출자가 이전 판독을 넘기면 변화가
실제로 나타난 것을 먼저 확인합니다. 옛 board를 두 번 읽은 것은 새 board가 안정된 것이
아닙니다.

남아 있는 고정 시간은 두 곳뿐이고 둘 다 **없음을 증명하는** 자리입니다: 취소된 touch hold가
그 뒤로도 패널을 열지 않는다는 것, 폐기된 credential이 재접속을 다시 시도하지 않는다는 것.
없음은 관측할 상태가 없으므로 타이머보다 오래 살아남는 수밖에 없습니다.

성공한 테스트는 그림을 만들지 않습니다. screenshot은 `only-on-failure`이고, trace는 꺼져
있습니다 — `retain-on-failure`는 실패한 것만 남기지만 **모든** 테스트의 screencast를 먼저
찍고, 여기서 재보니 두 브라우저 suite 벽시계의 약 30%였습니다. 실패를 재현할 때는
`--trace on`을 직접 붙입니다. UI 리뷰 캡쳐는 `playwright.capture.config.ts`가 따로 소유합니다.

## 자원 격리

- Integration은 파일을 **직렬로** 실행합니다. 포트를 잡고 자식 프로세스를 띄우고 DB 파일을
  여는 suite 둘이 동시에 돌면, 제품 버그처럼 보이는 flaky 실패가 됩니다.
- Integration과 Recovery는 테스트마다 임시 디렉터리의 DB를 만들고 정리합니다. 개발·운영 DB는
  쓰지 않습니다.
- Unit / Browser는 전용 Vite 포트(4183)를 `--strictPort`로 쓰고 서버를 재사용하지 않습니다.
  API 서버·DB·계정 seed를 시작하지 않으며, 남아 있는 co-op 서버가 그 포트에서 대신 응답할
  길도 없습니다. 없어야 할 것이 없다는 사실이 이 계층의 계약이라, 그것만은 빌려 쓰지
  않습니다.
- E2E는 `npm run dev` 묶음을 씁니다. 로컬에서는 이미 떠 있는 서버를 재사용하지만 CI에서는
  재사용하지 않습니다 — CI에는 재사용할 것이 없고, 그 포트의 낯선 서버를 받아들이면 이
  체크아웃이 아닌 무언가를 테스트하게 됩니다.

#### 측정 기록 — 브라우저와 staging (2026-09-10)

기준 SHA `f37e22d`, `feat/misc-test`, Node 24.18.1 / Linux, 로컬 실행. 같은 세션에서
stash 전후로 번갈아 잰 값입니다.

| | 전 | 후 |
|---|---:|---:|
| Unit / Browser | 57.5초 / 27개 | 72초 / 31개 |
| E2E | 84초 / 30개 | 66초 / 25개 |
| Integration | 84.4초 / 100개 | 66.2초 / 100개 |
| `restart-matrix` | 50.3초 | 37.1초 |

Browser Unit이 늘어난 것은 옮겨 왔기 때문입니다. 카메라 제스처와 iPad 회전 4개는 예전에
로그인하고 캠페인을 만들고 encounter에 들어간 뒤에야 기하 질문을 던졌습니다. 지금은 서버 없이
컴포넌트만 올리고 묻습니다. 브라우저 두 계층을 합치면 141.5초 → 138초로 거의 같고, 줄어든
것은 **무엇을 켜 두고 물어야 하는가**입니다.

`restart-matrix`는 checkpoint에서 시작합니다. 네 번째·여덟 번째 승리의 crash는 매번 Adventure
처음부터 그 자리까지 다시 플레이했습니다 — 같은 encounter를 세 번 이겼습니다. 이제 정상
플레이가 한 번 만든 durable save를 파일로 복사해 각 crash의 출발점으로 씁니다. 조립한 상태가
아니라 **진짜 플레이가 남긴 저장**이고, production save 경로를 우회하지 않습니다. 실제
SIGKILL·fault marker·COMMIT 전후 의미·0회/1회 계약은 그대로입니다. 처음부터 끝까지 도는
전체 Adventure 검증은 `adventure-progression`이 계속 따로 갖고 있습니다.

## support와 fixtures

| 위치 | 무엇 |
|---|---|
| `tests/support/network` | `SocketClient`, HTTP 로그인·계정 준비, 대기 계약 검증용 임시 소켓 서버 |
| `tests/support/campaign` | 합법 행동만 고르는 hero 정책과 스냅샷 기반 구동 loop |
| `tests/support/recovery` | fault 자식 서버, 배포 서버 실행 helper |
| `tests/support/browser` | 로그인·Facing·전술 조작, 컴포넌트 harness |
| `tests/fixtures/content` | 규칙 fixture(`cardguild.test.*`) — [README](../tests/fixtures/content/README.md) |
| `tests/fixtures` | 브라우저 상태 builder, campaign save builder |

### 종료를 기다림과 구분하기

`SocketClient`의 대기는 세 가지로 끝나고, 셋은 서로 다른 뜻입니다. 메시지가 오면 성공,
timeout이 끝나면 **서버는 살아 있는데 답이 없다**는 실패, 연결이 닫히면 **그 답은 영영 오지
않는다**입니다. 이미 도착한 메시지는 연결이 닫혀도 이깁니다 — 받은 것을 안 받은 것으로 만들지는
않습니다.

셋을 구분하지 못하면 crash 테스트가 timeout을 다 기다린 뒤에야 같은 답을 얻습니다. 그리고
반대 방향으로 틀리면 더 나쁩니다: 거절이나 침묵을 죽음으로 읽으면 **crash 없이도 crash
테스트가 통과합니다.** 그래서 `drive()`는 `SocketClosedError`만 죽음으로 처리하고, ACK 거절과
timeout은 그대로 실패시킵니다.

계약은 `tests/integration/socket-client.test.ts`가 실제 임시 WebSocket 서버로 고정합니다 —
이벤트 순서를 테스트가 직접 정하고, timeout 검증에만 fake timer를 씁니다.

#### 측정 기록 — 대기 계약 (2026-09-10)

기준 SHA `0a012e0`, `feat/misc-test`, Node 24.18.1 / Linux, 로컬 실행.
명령은 `npx vitest run --config vitest.integration.config.ts`입니다.

| | 변경 전 | 변경 후 (3회 중앙값) |
|---|---:|---:|
| `restart-matrix` (9개) | 213.76초 | **50.33초** (범위 47.61–52.14) |
| Integration 전체 | 243.61초 / 88개 | **84.36초 / 100개** |
| 연결 종료 → `drive()` 반환 | 19.95–19.99초 × 8회 | **0–1ms × 8회** |

사례별로는 마지막 승리 crash 68.06초 → 27.13초, 네 번째 승리 52.53초 → 9.70초, 보상 42.39초 →
2.16초입니다. 종료 관측 횟수(8회)는 그대로이고 사라진 것은 그 뒤의 대기뿐입니다. CI에 고정
시간 임계값이나 자동 재시도는 넣지 않았습니다.

`SocketClient`는 하나뿐입니다. 예전에는 네 벌이 있었고 이미 갈라져 있었습니다 — 하나는 메시지를
5초, 다른 하나는 15초 기다렸고, 하나는 전송 오류를 삼키고 다른 하나는 삼키지 않았으며, 옛
프로토콜로 hello를 보낼 수 있는 것은 하나뿐이었습니다. 이웃보다 약한 검사를 조용히 하는 suite가
바로 통합이 막으려는 실패입니다.

## 타입 검사 경계

`npm run check`가 다섯 설정을 모두 검사합니다. 하나만 볼 때는 `npx tsc`를 직접 부릅니다.

| 설정 | 대상 |
|---|---|
| `tsconfig.json` | 앱 + `tests/fixtures` |
| `tsconfig.game.json` | GameCore만, DOM 없음 |
| `tsconfig.tools.json` | `tools/` CLI |
| `tsconfig.server.json` | 서버 경계, DOM 없음 |
| `tsconfig.tests.json` | `tests` 전체 |

`tests/fixtures`가 앱 설정에도 들어가는 것은 의도입니다. fixture와 그것을 먹는 앱 코드가 한
프로그램으로 컴파일되므로 서로 모르게 어긋날 수 없습니다.

다만 이것이 fixture를 Node로부터 막아주지는 **않습니다**. `types`는 어떤 `@types` 패키지를
자동으로 넣을지만 정하고, `@types/node`는 의존성을 타고 들어옵니다 — 지금 `tsconfig.json`
아래에서도 `node:fs`와 `process`는 통과합니다. fixture를 브라우저에서 쓸 수 있게 두는 것은
관습이지 검사되는 경계가 아닙니다. 경계로 만드는 일은 별도 과제입니다.

production 코드가 `tests/`를 import하는 것은 ESLint가 막습니다.
