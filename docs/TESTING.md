# CardGuild 테스트 체계

테스트는 **무엇을 붙잡고 있는가**로 나뉩니다. 계층이 다르면 실패가 가리키는 곳이 다르고,
고치는 방법도 다릅니다.

| 계층 | 붙잡는 것 | 실행 환경 | 케이스 | 비용 |
|---|---|---|---:|---|
| Unit / Node | 순수 규칙·변환·컴포넌트 계약 | Node, 외부 자원은 fake | 549 | ~8초 |
| Unit / Browser | 실제 DOM·PixiJS 컴포넌트에 상태와 콜백을 주입 | Chromium + Vite만 | 27 | ~1분 |
| Integration | 실제 SQLite·HTTP·WebSocket과 source 서버 장애 주입 | Node, 파일 DB와 자식 프로세스 | 88 | ~4분 |
| E2E | 실제 앱 진입부터 로그인·캠페인·협동 플레이까지 | Chromium + 개발 서버 묶음 | 30 | ~1.5분 |
| Recovery | 배포 artifact와 파일 DB의 실제 재시작·강제 종료 | `dist-server` + `dist` | 4 | ~30초 |

```bash
npm run test:unit         # Unit / Node
npm run test:browser-unit # Unit / Browser 단독 (전용 Vite 포트, 서버·DB 없음)
npm run test:network      # Integration
npm run test:e2e          # E2E
npm run test:smoke        # Unit/Browser + E2E (기본 Playwright 설정의 두 project)
npm run test:recovery     # Recovery (build 후 배포 artifact 실행)
npm test                  # 위를 순서대로 전부
```

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

**Recovery** — 배포 산출물이 대상입니다. 테스트마다 전용 포트·임시 DB·전용 프로세스를 갖고,
재시작 전후로 같은 origin·포트·DB를 유지합니다. worker는 1입니다.

같은 기능을 여러 계층이 검사하는 것은 중복이 아닙니다. Continue는 Unit에서 순서를,
Integration에서 CAS를, Recovery에서 진짜 재시작을 붙잡습니다 — 셋 중 하나가 깨지면 나머지
둘이 어디가 깨졌는지 말해줍니다.

## 자원 격리

- Integration은 파일을 **직렬로** 실행합니다. 포트를 잡고 자식 프로세스를 띄우고 DB 파일을
  여는 suite 둘이 동시에 돌면, 제품 버그처럼 보이는 flaky 실패가 됩니다.
- Integration과 Recovery는 테스트마다 임시 디렉터리의 DB를 만들고 정리합니다. 개발·운영 DB는
  쓰지 않습니다.
- Unit / Browser 단독 실행은 전용 Vite 포트(4183)를 씁니다. 남아 있는 co-op 서버와 부딪히지
  않고, API 서버·DB·계정 seed를 시작하지 않습니다.
- 기본 묶음(`test:smoke`)은 기존 seeded co-op 서버 하나를 두 project가 함께 씁니다. Browser
  Unit은 그 서버의 API를 호출하지 않으므로 결과는 단독 실행과 같습니다. 두 설정은 **같은
  project 정의**(`playwright.browser-unit.project.ts`)를 공유합니다.

## support와 fixtures

| 위치 | 무엇 |
|---|---|
| `tests/support/network` | `SocketClient`, HTTP 로그인·계정 준비 |
| `tests/support/campaign` | 합법 행동만 고르는 hero 정책과 스냅샷 기반 구동 loop |
| `tests/support/recovery` | fault 자식 서버, 배포 서버 실행 helper |
| `tests/support/browser` | 로그인·Facing·전술 조작, 컴포넌트 harness |
| `tests/fixtures/content` | 규칙 fixture(`cardguild.test.*`) — [README](../tests/fixtures/content/README.md) |
| `tests/fixtures` | 브라우저 상태 builder, campaign save builder |

`SocketClient`는 하나뿐입니다. 예전에는 네 벌이 있었고 이미 갈라져 있었습니다 — 하나는 메시지를
5초, 다른 하나는 15초 기다렸고, 하나는 전송 오류를 삼키고 다른 하나는 삼키지 않았으며, 옛
프로토콜로 hello를 보낼 수 있는 것은 하나뿐이었습니다. 이웃보다 약한 검사를 조용히 하는 suite가
바로 통합이 막으려는 실패입니다.

## 타입 검사 경계

```bash
npm run typecheck         # 앱 + tests/fixtures (Node 타입 없음)
npm run typecheck:game    # GameCore만, DOM 없음
npm run typecheck:server  # 서버 경계, DOM 없음
npm run typecheck:tests   # tests 전체 (Node 타입 있음)
```

`tests/fixtures`가 두 곳에 들어가는 것은 의도입니다. `typecheck`에는 Node 타입이 없으므로,
fixture가 `node:fs`에 손을 뻗으면 거기서 실패합니다. fixture는 브라우저와 공유하는 데이터이고,
그 사실을 지켜주는 것이 이 겹침입니다.

production 코드가 `tests/`를 import하는 것은 ESLint가 막습니다.
