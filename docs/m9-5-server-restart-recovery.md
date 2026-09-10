# M9-5 — Server Restart Recovery & Multiplayer Continuity

[Parent issue #36](https://github.com/darkbard81/CardGuild/issues/36)의 M9-5 구현 계약과 검증
기록이다. 기준 브랜치는 `M9-Persistence`, 구현 전 기준 커밋은 M9-4를 끝낸 `568df19`이며,
계획은 [issue #41](https://github.com/darkbard81/CardGuild/issues/41)이다.

## 1. 목표와 범위

M9-5는 새 저장 모델을 만들지 않는다. M9-1~M9-4가 만든 저장·복구 구조를 **장애 경계에서
실제로 증명하는** 단계다. 구현 변경은 하나뿐이고, 나머지는 전부 검증이다.

포함:

- 서버 종료의 멱등성과 종료 중 queue·DB 순서 (**유일한 제품 코드 변경**)
- 의미 있는 전이별 COMMIT 전후 `SIGKILL` fault matrix
- 프로세스가 살아 있는 ACK 유실과 동일 요청 재시도
- 배포 빌드(`dist-server/main.js` + `dist/`) 기반 복구 E2E suite와 전용 Playwright 설정

범위 밖(이번 완료 판정에 포함하지 않음): 전원 장애, 스토리지 자체 손실, 다중 서버 운영,
durable request journal, 자동 AI 재시도, Host migration. 기존 **AI 저장 실패 → 세션 종료 →
Host Continue** 정책은 그대로다.

## 2. 유일한 제품 코드 변경 — 멱등한 종료

`RunningCardGuildServer.close()`를 동시에 두 번 호출하면 두 번째가
`Server is not running.`으로 실패했다. `SIGINT`와 `SIGTERM`이 각각 종료 함수를 부를 수
있으므로 실제로 도달 가능한 경로였다.

| 문제 | 수정 |
|---|---|
| 중복 `close()`가 실패 | 하나의 shutdown Promise를 공유한다. 동시 호출·사후 호출 모두 같은 결과를 받는다 |
| 종료 중 신규 작업 유입 | HTTP는 `503 SERVER_CLOSING`, WebSocket upgrade는 `503`, 이미 열린 소켓의 신규 메시지는 폐기 |
| in-flight HTTP 작업 유실 | `httpServer.close()`는 소켓만 기다린다. 핸들러 Promise를 따로 추적해 DB close 전에 기다린다 |
| gateway 큐 유실 | 소켓에서 읽었지만 아직 SessionHost queue에 닿지 않은 메시지는 `store.drain()`에 보이지 않는다. gateway가 미완료 작업을 먼저 배수한다 |
| keep-alive 소켓이 listener를 붙잡음 | `closeIdleConnections()` |
| 종료 실패를 성공으로 숨김 | 모든 호출자에게 전달하고, `main.ts`는 `exitCode = 1` |

종료 순서는 다음으로 고정했다.

```text
closing = true                      신규 HTTP·upgrade·메시지 차단
→ gateway.close()                   읽은 메시지를 SessionHost queue까지 밀어 넣고 소켓 종료
→ httpServer.close() + closeIdleConnections()
→ in-flight HTTP 핸들러 대기
→ store.drain()                     모든 SessionHost queue 배수
→ persistence.close()               정확히 한 번
```

gateway의 미완료 작업은 **socket이 아니라 operation 단위로** 추적한다. socket 기준이면 큐가
아직 돌고 있는 채로 닫힌 연결이 그 큐 전체를 집합에서 빼 가고, 잠시 뒤 시작한 종료가 그 작업을
지나쳐 버린다. 그 작업이 `store.drain()` barrier보다 늦게 SessionHost queue에 닿으면 새 종료
계약이 그대로 깨진다. connection cleanup과 operation 추적은 수명이 다르다.

이 순서는 `server-shutdown.integration.test.ts`의 "waits for a message it already accepted
even when that socket closed first"가 직접 강제한다 — 첫 메시지를 durable write 안에 세워
두고, 두 번째 메시지를 gateway 큐에 남긴 채 **클라이언트 소켓을 먼저 닫고**, 곧바로 종료를
시작한다. 고치기 전 코드에서는 종료가 그 메시지를 남겨둔 채 즉시 끝나 실패하고, 고친 뒤에는
그 메시지가 끝날 때까지 기다린다.

이 테스트가 gateway 단위인 것은 의도적이다. 불변식이 gateway의 것이고(`close()`는 이미 받은
메시지가 처리 중인 동안 끝나지 않는다) `server.close()`가 그 위에 서 있기 때문이며, 또한
지금은 서버 전체 경로로는 도달할 수 없기 때문이다 — intent 경로에 실제 I/O를 기다리는 지점이
없어서, 받은 메시지는 그것을 읽은 tick 안에서 끝나고 소켓의 close 이벤트가 도착할 때에는 이미
남아 있지 않다. 원격 저장소를 쓰는 durability는 첫 줄에서 그것을 바꾼다. 그래서 지금 못 박아
둔다.

`main.ts`는 `process.once`가 아니라 `process.on`으로 신호를 받는다. `once`면 두 번째
`SIGTERM`이 Node 기본 핸들러로 떨어져 flush 도중 프로세스를 죽이는데, 이 순서가 막으려는
것이 정확히 그 반쯤 쓰인 데이터베이스다.

공개 인터페이스 변화는 `close(): Promise<void>`의 멱등성 보장뿐이다. protocol v7,
Save v1, DB schema v1, content identity는 그대로다.

## 3. 검증 기반

### Fault harness

`tests/support/recovery/fault-server.ts`가 "세 번째 저장"이 아니라 **대상 전이**로 fault를 받는다.

- `FaultTarget`: `combat-command` · `ai-command` · `encounter-complete` · `level-up` ·
  `adventure-complete` · `reward` · `migration` · `any`
- 분류는 저장된 save와 candidate save를 비교해서만 한다. 서버에 "무엇을 하는 중이냐"고
  묻지 않는다 — crash가 남기는 증거는 save뿐이고, 복구도 같은 것을 읽는다.
- fault는 부모가 IPC로 **arm** 하기 전까지 무동작이다. 프로세스 시작부터 세면 준비 단계의
  저장까지 세게 되어, 준비 단계가 하나 늘면 조용히 다른 전이를 겨누게 된다.
- 발화는 `process.exit`이 아니라 `SIGKILL`이다. 정상 종료는 shutdown handler를 돌리고 DB를
  닫는데, crash가 결코 하지 못하는 일이 바로 그것이다.
- 증거는 marker 파일에 **동기적으로** 쓴다. SIGKILL은 pipe로 가는 비동기 stdout write가
  flush되기 전에 프로세스를 가져간다.
- `after`는 `committed === true`일 때만 발화한다. 거절된 CAS는 DB가 갖고 있지 않은 전이이므로
  거기서 죽이면 이름만 `after`인 `before` fault가 되고, 복구 assertion이 다른 계약을 판정하게
  된다. 거절된 commit은 그대로 돌려주어 서버가 평소대로 보고하게 둔다.

### 공용 테스트 driver

세 suite가 각자 복사해 두었던 것을 하나로 모았다.

| 모듈 | 무엇 |
|---|---|
| `tests/support/network/socket-client.ts` | hello·waitFor·intent→ACK. 사본 셋은 한 suite가 조용히 다른 것들과 다른 검사를 하게 되는 길이다 |
| `tests/support/campaign/adventure-driver.ts` | production Adventure를 seed 1에서 8전 완주까지 끌고 갈 수 있는 hero 정책. 공유 legality query로만 묻는다 |
| `tests/support/campaign/campaign-drive.ts` | 스냅샷만 보고 다음 입력을 정하는 구동 loop. child process에는 `host.whenIdle()`이 없으므로 "서버가 사람을 기다리는 지점"을 스냅샷에서 읽는다 |
| `tests/support/recovery/fault-child.ts` | fault 서버의 spawn·arm·marker·정지 |

`campaign-drive`의 `minRevision`이 이 loop를 정직하게 만든다. ACK와 그 commit의 snapshot은
별개 frame이라, ACK 직후 "가장 새 snapshot"으로 판단하면 **자기 수를 두기 전 상태**를 보고
같은 수를 다시 보내게 된다.

checkpoint는 조작하지 않는다. HP를 낮추거나 완료 목록·EXP를 직접 바꿔 승리를 만들지 않고,
seed 1의 생산 콘텐츠를 실제 reducer로 끝까지 플레이해서 도달한다.

## 4. 장애 매트릭스 실측

`tests/integration/restart-matrix.test.ts`. 각 사례는 fault 없는 새 프로세스가 같은
DB 파일을 열고 Continue한 결과다. `campaignRevision`은 fault marker가 그 경계에서 기록한 값과
복구 후 값이며, 표의 두 값이 같다는 것이 곧 "0회 또는 1회"의 증거다.

| 대상 전이 | 경계 | fault 시점 revision | 복구 후 revision | 복구된 진행 |
|---|---|---:|---:|---|
| 첫 Encounter 승리 | before | 7 | 7 | 완료 `[]`, Lv.1, EXP 0, phase `combat` |
| 첫 Encounter 승리 | after | 8 | 8 | 완료 `[road-ambush]`, Lv.1, **EXP 200**, phase `reward` |
| 4전 승리 + Level-Up | before | 260 | 260 | 완료 3개, **Lv.1 / EXP 700**, phase `combat` |
| 4전 승리 + Level-Up | after | 261 | 261 | 완료 4개, **Lv.2 / EXP 100**, phase `reward` |
| 보상 선택 | before | 8 | 8 | 소유 15 그대로, **offer가 열린 채** phase `reward` |
| 보상 선택 | after | 9 | 9 | 소유 15→**16**, `pendingReward` 해소, phase `between-encounters` |
| AI 연속 command | before | 14 | 14 | 마지막으로 본 전투 그대로, Resume이 그 단계를 다시 진행 |
| AI 연속 command | after | 15 | 15 | `commandLog`가 빈틈 없는 1..N, Resume 후 그 다음 단계부터 재개 |
| 최종 Encounter 승리 | before | 750 | 750 | 완료 7개, Lv.3 / EXP 0, phase `combat` |
| 최종 Encounter 승리 | after | 751 | 751 | 완료 **8개**, Lv.3 / **EXP 500**, phase `complete` |
| 콘텐츠 이관 | before | legacy 유지 | legacy 유지 | 원본 identity·revision 그대로, 다음 Continue가 이관 |
| 콘텐츠 이관 | after | legacy+1 | legacy+1 | 목표 identity, 반복 Continue에서 **재이관 없음** |
| 일반 Combat command | before / after | — | — | `campaign-persistence` suite가 유지 (HP·facing·turn·RNG·카드·commandLog 전체) |

`before` 쪽은 "잃지 않았다"만으로는 부족하므로 **다시 할 수 있는지**까지 본다. 보상 before는
Resume 후 같은 offer를 다시 골라 사본이 정확히 하나 늘고, AI before는 Resume이 삼켜진 그
단계를 다시 진행하며, 최종 승리 before는 Resume 후 실제로 끝까지 플레이해 완료에 도달한다.

**적 reaction 경계는 없다.** 계획 §3.1이 요구했지만 지금 콘텐츠가 만들 수 없다:
`reactive-strike`가 유일한 Reaction이고 18종 Creature 중 어느 쪽도 그것을 받지 않으므로 적에게
Reaction window가 열리지 않고, 서버 AI가 그것을 COMMIT하는 일도 없다. 통과할 수밖에 없는
빈 케이스를 쓰는 대신 이유를 검사로 남겼다 — matrix suite의 마지막 테스트가 "Reaction을 가진
Creature가 없다"를 확인하므로, 나중 pack이 그것을 만들면 그 순간 이 커버리지 부재가 실패로
드러난다.

before 사례의 복구 hash는 클라이언트가 **마지막으로 본 snapshot의 hash와 동일**하다
(예: 첫 승리 before는 `fnv1a64:cc45880be6093de1`). after 사례는 클라이언트가 본 적 없는
hash로 복구된다(`…cc45880b…` → `fnv1a64:ab772a17e113673e`). 비교는 hash뿐 아니라
`partySlots`·Adventure·Combat 객체 전체로 한다.

공통으로 확인하는 것:

1. 새 Resume Lobby는 `revision 0`, 빈 guest claim, 새 identity로 시작한다.
2. Resume 자체는 gameplay hash도 campaign revision도 바꾸지 않는다.
3. 복구 뒤 다음 합법 행동을 실제로 수행할 수 있다.
4. 이미 확정된 EXP·Level-Up·보상·Encounter 완료가 다시 적용되지 않는다.
5. Level-Up after 복구 뒤 다음 전투는 **Lv.2 profile**로 만들어진다.

## 5. ACK 유실 — 프로세스는 살아 있다

`tests/integration/ack-loss.test.ts`. 프로세스는 죽지 않고 답만 사라진다.

- 요청 직후 소켓을 끊는다. 서버는 클라이언트가 사라진 줄 모르고 COMMIT한 뒤 죽은 소켓에 답한다.
- 같은 credential로 재접속해 **동일 requestId·expectedRevision·payload**를 다시 보낸다.
- journal이 원래 ACK를 그대로 돌려주고 `resync` snapshot이 뒤따른다. ACK의
  `committedRevision`은 **그 요청 자신의 commit**이며, 그 사이 서버가 자기 적 턴으로 더
  진행했더라도 그 값은 움직이지 않는다. 이어지는 resync가 현재 상태를 준다.
- DB `campaignRevision`·`snapshotHash`·완료 목록·Collection·Level/EXP 전부 불변.
- 같은 requestId에 다른 payload는 `REQUEST_ID_REUSE`로 거절하고, 역시 아무것도 쓰지 않는다.
- 클라이언트는 막히지 않는다: 다음 요청은 평범하게 처리된다.

서버 재시작 후에는 과거 요청이 자동 재전송되지 않는다. 이전 credential은
`SESSION_NOT_FOUND`이고, 새 세션은 journal 없이 `revision 0`에서 저장된 gameplay로 시작하므로
같은 requestId는 그냥 `STALE_REVISION`으로 판정된다.

## 6. 배포 빌드 복구 E2E

`playwright.recovery.config.ts` + `tests/recovery/campaign.recovery.ts` +
`tests/support/recovery/deployment.ts`. `npm test`의 마지막 계층이며, 앞선 `npm run build`가
남긴 산출물을 쓴다 — 없으면 다시 만들지 않고 그 사실을 말하며 실패한다.

- 실제 `dist-server/main.js`가 빌드된 `dist/` 클라이언트를 서빙한다. 서버 모듈을 test
  프로세스로 import하지 않는다 — test가 조각들을 붙들고 있어야만 되는 복구는 복구가 아니다.
- 테스트마다 전용 포트·임시 DB·전용 계정을 가진다. 계정은 실제 운영 경로인
  `tools/accounts/create-account.ts`로 만든다. 공유 `dev:coop` 서버와 개발·운영 DB는 쓰지
  않는다. 재시작은 같은 origin·포트·DB를 유지하고, worker는 1이다.
- `sessionStorage`를 테스트가 직접 지우지 않는다. 실제 Client가 이전 credential의 무효화를
  처리하는 경로를 그대로 본다.

| 시나리오 | 확인한 것 |
|---|---|
| 1P 정상 종료 복구 | Login → New → Combat 저장 → `SIGTERM`(exit 0) → 같은 DB 재시작 → My Campaigns → Continue → Resume Lobby(읽기 전용 저장 Party, `apply-party` 없음) → Resume이 저장 hash를 그대로 재공개 → End Turn이 hash를 움직임 |
| 3P 강제 종료 복구 | Host + Guest 2명 Join/Claim → Combat 저장 → `SIGKILL` → 재시작 → Host Continue(**새 session id**) → 새 invite로 Guest 재참가·재claim → claim·presence가 hash를 움직이지 않음 → Resume 후 세 클라이언트가 같은 hash, 각 Guest가 자기 캐릭터 제어 |
| Host 재로그인 | auth·credential이 전혀 없는 새 브라우저에서 Login 후 같은 Campaign을 Continue·Resume |
| Continue 실패 재시도 | Continue와 목록 재조회가 함께 실패해도 버튼이 다시 활성화되고, 복구 후 정상 Continue |
| Host 단절 | Host가 사라져도 Guest claim·gameplay hash·revision·소유권이 불변, 미인증 접근은 401, Host 복귀 시 제어 복원 |

### 중복하지 않은 것

계획 §4의 "같은 live session의 단절 회귀" 중 **Guest disconnect → Host fallback → 같은
credential reconnect → claim·control 복원**은 이미
`tests/e2e/coop.spec.ts`와 `tests/integration/coop.test.ts`가 검증한다. 계획이
명시적으로 금지한 복제 대신, 아직 검증되지 않았던 **Host 단절**을 추가했다.

### 축소한 것 하나

계획 §4의 "오래된 성장 요약: 첫 승리 요약을 본 Guest가 단절된 동안 **다음 전투 승리** →
재접속 → 현재 EXP 450 표시"는 브라우저에서 구현하지 않았다. 두 번째 전투를 UI로 이기려면
encounter별 좌표에 묶인 전투 구동 헬퍼가 하나 더 필요하고, 그 취약함이 이 규칙이 주는
가치보다 크다. 같은 시나리오는 `src/dom/progression-view.test.ts`가 리뷰에서 재현된 그대로
검증한다 — 이벤트 없는 resync에서 두 전투 전의 요약을 폐기하고, 순서가 뒤바뀐 오래된 view는
유지하며, 같은 전투로 돌아온 재접속은 요약을 지킨다. 브라우저 쪽은
`tests/unit/browser/progression.spec.ts`가 요약 표시 자체를 검증한다.

## 7. 쓰기 실패와 복구 거절

새로 만들지 않고 기존 검증을 요구사항에 매핑한다.

| 요구 | 어디서 |
|---|---|
| 승리·레벨업 쓰기 실패 시 성장 이벤트·accepted ACK 미공개, 이전 authority 유지 | `src/server/session-host.test.ts` "keeps EXP unpaid and unpublished…" |
| 재시도 가능한 쓰기 실패 후 동일 요청 재시도가 한 번만 반영 | 같은 테스트의 후반부 |
| AI 쓰기 실패 → candidate 미공개·pump 중단·세션 종료 | `src/server/session-host.test.ts` "commits every server AI step on its own…" |
| 손상 JSON/hash·미지원 schema·미등록 identity 거절과 row 보존 | `src/server/campaign-save.test.ts`, `tests/integration/campaign-persistence.test.ts` |
| 사전 검증 실패가 기존 live writer를 죽이지 않음 | `tests/integration/campaign-service.test.ts` "leaves the live session and the stored row untouched…" |
| 다른 계정 404 / 미인증 401 | `tests/integration/account.test.ts`, 위 E2E의 Host 단절 사례 |

## 8. 실행한 gate

```bash
npm run check        # content + production + assets + typecheck x4 + lint + 단위 584개
npm run build        # client + server
npm run test:network # 40 tests / 7 files
npm run test:smoke   # 55 tests
npm run test:recovery # 5 tests, 배포 빌드
```

전부 통과했다. 네트워크 테스트는 M9-4 시점 28개에서 44개로 늘었다(신규: 종료 5, 장애
매트릭스 9, ACK 유실 2). `test:recovery`는 `npm test` 집계와 **`.github/workflows/ci.yml`의
필수 gate**에 모두 들어간다 — 로컬 전체 gate만 통과하고 CI에서는 배포 빌드 재시작이 검증되지
않는 상태를 남기지 않기 위해서다.

**완료 조건 충족:**

- 배포 서버가 같은 SQLite 파일을 재오픈하고 1P·3P 플레이를 이어간다.
- 일반 전투·EXP·Level-Up·보상·AI·콘텐츠 이관이 장애 경계에서 0회 또는 1회만 durable하게
  반영된다(§4 실측).
- 저장 실패한 candidate는 성공 상태로 공개되지 않는다.
- 같은 세션 재접속(journal)과 서버 재시작 후 새 세션 복구가 각각 올바르게 동작한다.
- 모든 required gate와 배포 빌드 복구 E2E가 통과한다.
