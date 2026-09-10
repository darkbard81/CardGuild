# M9-2 — Host Identity & Campaign Ownership

[Parent issue #36](https://github.com/darkbard81/CardGuild/issues/36)의 M9-2 구현 계약과 검증 기록이다.
기준 브랜치는 `M9-Persistence`, 구현 전 기준 커밋은 M9-1을 끝낸 `15593ae`이다.

## 1. 목표와 범위

로그인한 Host의 영속 `accountId`가 Campaign metadata를 소유하고, auth session과 live
`gameSessionId`는 소유자가 아니게 만든다.

M9-2의 성과는 로그인 화면이 아니라 **ID 경계의 분리**다.

```text
accountId      영속 사용자 identity     ← Campaign을 소유하는 유일한 주체
auth token     임시 인증 credential     ← 만료/로그아웃 가능, 소유자 아님
campaignId     영속 Save identity       ← accountId가 소유
gameSessionId  live multiplayer room    ← 재시작하면 새로 발급, 소유자 아님
playerId       live session 참가자
```

포함:

- SQLite schema/migration, Account·AuthSession·Campaign repository
- 로그인/로그아웃/현재 계정 HTTP API와 auth 쿠키
- Campaign 생성·목록·Continue의 인증과 소유권 게이트
- Host 로그인과 My Campaigns 화면, Guest 익명 참가 유지

후속 범위:

- **M9-3:** `CampaignSaveV1`, gameplay projection 저장/복구, Resume Lobby, commit-before-ACK
- **M9-4:** EXP 지급과 Level-Up
- **M9-5:** 서버 재시작 복구와 멱등성

M9-2에는 gameplay snapshot이 없다. 그래서 Continue는 인증과 소유권을 모두 통과해도
`409 SAVE_NOT_FOUND`로 끝난다.

## 2. 확정한 기술 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| SQLite driver | 내장 `node:sqlite`(`DatabaseSync`) | 런타임 의존성 0개 추가, 네이티브 빌드·esbuild external 불필요. esbuild는 `node:` 접두 specifier를 `--platform=node`에서 자동 외부화한다 |
| engines | `>=24.0.0` | 22.13에서도 `node:sqlite`는 플래그 없이 쓸 수 있으나 "1.1 Active development" 단계다. `.node-version`과 CI가 24뿐이라 22.x는 **한 번도 테스트되지 않는다** — 지원한다고 선언하지 않는 편이 정직하다 |
| 계정 등록 | HTTP 라우트 없음, `npm run account:create` CLI | 서버가 공개 도메인에 배포되어 있어 가입을 열면 누구나 Campaign 소유자가 된다 — **이 결정은 이후 뒤집혔다. 아래 주석을 볼 것** |
| password KDF | scrypt N=2^15, r=8, p=1, keylen=32 | 이 하드웨어에서 약 80ms. **`maxmem`을 명시해야 한다** — 기본 32MiB로는 N=2^15가 실패한다 |
| auth session | 30일 절대 만료, 슬라이딩 없음 | 슬라이딩은 요청마다 쓰기를 만든다. M9-3이 같은 파일에 commit-before-ACK를 얹으므로 그 경로에 경합을 미리 넣지 않는다 |

## 3. 지킨 경계

**pure reducer는 SQL을 모른다.** persistence는 전부 `src/server/` 아래에 있다. eslint
`no-restricted-imports`가 `src/game|adventure|loadout|session/**`에서 `node:*`를 이미 금지한다.

**account/campaign 식별자는 `SessionCoreState`에 넣지 않는다.** 넣으면 gameplay hash가 바뀌어
결정론 계약을 깬다. 소유권은 `campaign-service.ts`가 세션 옆의 `Map<sessionId, ownership>`으로
들고 있다. 단위 테스트와 네트워크 테스트가 각각 "세션 state에 accountId·campaignId 문자열이
없다"와 "서로 다른 계정이 연 두 Campaign의 gameplay hash가 같다"로 이를 고정한다.

**wire protocol은 v5 그대로.** 계정은 Campaign 생성/이어하기를 막을 뿐 WebSocket `hello`는
건드리지 않는다. 새 실패 코드(`CAMPAIGN_NOT_FOUND`, `SAVE_NOT_FOUND`)는 `ProtocolErrorCode`에
넣지 않고 HTTP 전용 union으로 두었다. `src/protocol/v5-types.ts`는 손대지 않았다.

**Guest는 익명 그대로.** `POST /api/sessions/:id/join`은 서명도 동작도 바뀌지 않았다.

## 4. 설계

### 계층

```text
src/server/persistence/
  types.ts               driver 비의존 레코드·repository 인터페이스 (SQL 한 줄도 없음)
  migrations.ts          user_version 기반 순차 마이그레이션
  sqlite-persistence.ts  DatabaseSync 열기, PRAGMA, 준비된 statement, row 매핑
src/server/password.ts        scrypt 해시/검증 + decoy 해시
src/server/cookies.ts         Cookie 파싱, Set-Cookie 생성, Secure 결정
src/server/auth-service.ts    계정 생성·로그인·인증·로그아웃
src/server/campaign-service.ts Campaign 생성·목록·소유 조회, 세션 소유권 map
src/server/database-path.ts   서버와 CLI가 공유하는 DB 경로 해석 + 개발 시드 가드
tools/accounts/create-account.ts 운영자 계정 생성 + --seed-dev
```

`Persistence`는 인터페이스이고 `startCardGuildServer`가 주입받는다. 기본값은 in-memory라
모든 테스트가 자기 DB를 갖는다. M9-3은 **상위 DI 경계와 `Persistence` 합성은 그대로 두고**
`CampaignRepository`에 save write/read를 더한다 — 지금 계약에는 `create`/`listByOwner`/
`findOwned`/`delete`만 있고 `CampaignRecord`도 snapshot payload를 표현하지 않으므로,
repository 계약 확장은 M9-3에서 반드시 필요하다.

### 스키마 (migration 1, 모두 `STRICT`)

```sql
accounts(account_id PK, username UNIQUE COLLATE NOCASE, password_hash, created_at)
auth_sessions(token_digest PK, account_id FK→accounts ON DELETE CASCADE, created_at, expires_at)
campaigns(campaign_id PK, owner_account_id FK→accounts ON DELETE CASCADE, name,
          campaign_revision, save_schema_version, content_pack_id, content_pack_version,
          content_fingerprint, snapshot_json, snapshot_hash, created_at, updated_at)
```

snapshot 계열 컬럼은 M9-2에서 항상 `NULL`이다. 지금 만들어 두는 이유는 마이그레이션을
아끼려는 게 아니라, `campaigns` row가 처음부터 "save를 가질 수 있는 것"으로 정의되어야
Continue의 409가 임시방편이 아니라 계약이 되기 때문이다. `hasSave`는 `snapshot_json IS NOT NULL`이다.

`COLLATE NOCASE`는 ASCII만 접는다. 그래서 auth service가 아이디를
`/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/`로 제한한다. 이 제한이 없으면 `Ä`와 `ä`가 서로 다른
계정이 되어 "중복 계정 거절"이 통과하면서도 불변식은 깨진다.

FK는 `node:sqlite`에서 기본으로 켜져 있다. pragma는 의도를 적어 두기 위해 남겼다.

### HTTP

| Method | Path | 동작 |
|---|---|---|
| POST | `/api/auth/login` | 200 `{account}` + `Set-Cookie` / 401 |
| POST | `/api/auth/logout` | 204 + 쿠키 만료. 미로그인이어도 204 |
| GET | `/api/auth/me` | 200 `{account: null \| {...}}` |
| POST | `/api/campaigns` | 401 / 201 `{campaign, ...credential, invite}` |
| GET | `/api/campaigns` | 401 / 200 `{campaigns}` (소유한 것만) |
| POST | `/api/campaigns/:id/continue` | 401 / 404 / 409 `SAVE_NOT_FOUND` |
| POST | `/api/sessions/:id/join` | **변경 없음** (Guest 익명) |

`POST /api/sessions`는 삭제했다. Host가 되는 길은 로그인 후 Campaign을 여는 것뿐이다.

세 가지 응답 선택에 이유가 있다.

- **`/api/auth/me`는 401이 아니라 200 + `{account: null}`이다.** 클라이언트의 `api()`는
  `!response.ok`에서 throw하므로, 익명을 401로 만들면 정상적인 비로그인 경로가 부트스트랩의
  예외 흐름이 된다. 익명은 실패가 아니라 답이다.
- **남의 Campaign은 403이 아니라 404다.** 조회 자체가 `campaign_id`와 `owner_account_id`를
  함께 받으므로 403을 낼 수 있는 코드 경로가 없다. 본문까지 "없는 id"와 동일하다.
- **미로그인은 401이다.** 게스트에게는 쿠키가 아예 없으므로 403이 아니다.

로그인 실패는 아이디가 없든 비밀번호가 틀리든 상태·본문·소요시간이 같다. 모르는 아이디에도
고정 decoy 해시로 KDF를 돌려 응답 시간으로 계정 목록을 훑지 못하게 한다.

### 개발 계정 시드

개발과 Playwright는 `.data/cardguild.dev.sqlite`를 쓰고, 배포는 `CARDGUILD_DB_PATH`(기본
`.data/cardguild.sqlite`)를 쓴다. **두 경로는 절대 같으면 안 된다.**

`--seed-dev`는 "지금이 어떤 환경인가"가 아니라 **"어느 DB를 여는가"**로 막는다. 시드가
넣는 계정은 비밀번호까지 공개 저장소에 있으므로, `NODE_ENV`를 설정하지 않은 배포에서
`npm run dev:coop`을 한 번 돌리는 것만으로 그 계정이 실제 DB에 생기면 안 된다. 환경변수
누락은 흔하지만 경로는 명시적으로 개발 DB를 가리켜야만 통과한다. 검사는 파일을 열기
전에 하므로 거절된 시드는 대상 DB를 마이그레이션조차 하지 않는다.

### 쿠키

`cardguild_auth`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age`.

`SameSite=Lax`가 이 서버의 **유일한** CSRF 방어다. CSRF 토큰이 없으므로 나중에
`SameSite=None`으로 완화하려면 토큰을 먼저 만들어야 한다.

`Domain`은 붙이지 않는다. vite 개발 프록시가 `Set-Cookie`를 그대로 전달하는데, 백엔드
호스트를 가리키는 `Domain`은 개발 origin에서 거부된다. 쿠키는 포트를 무시하므로 host-only
쿠키가 프록시 뒤와 프로덕션 양쪽에서 동작한다.

`Secure`는 설정에서만 온다. 프로덕션은 리버스 프록시 뒤 평문 HTTP라 요청만으로는 브라우저가
HTTPS를 썼는지 알 수 없고, `X-Forwarded-Proto`는 아무도 벗겨내지 않으므로 신뢰할 수 없다.
기본값은 "허용 origin이 전부 https면 켬"이고, `CARDGUILD_COOKIE_SECURE`가 이를 덮어쓴다.
프로덕션 env 파일에는 명시적으로 `true`를 적어 두었다 — origin 하나가 http로 추가되면
기본값이 조용히 꺼지기 때문이다.

### 화면

새 화면을 만들지 않았다. `#session-screen`은 이미 `renderLanding()`과 `renderLobby()` 두
모드를 `replaceChildren`으로 갈아끼우므로, `renderLogin()`과 `renderCampaigns()`를 같은
화면의 렌더 모드로 더했다. 덕분에 `src/style.css`의 세 개 `data-screen` hide 블록과 반응형
미디어쿼리를 건드리지 않고 기존 카드·폼·버튼 클래스를 그대로 쓴다.

랜딩은 게스트의 자리로 남겼다. `#session-display-name`, `#join-session-id`, `#join-session`은
id와 동작이 그대로다. `#create-session`은 `#host-login`으로 대체되었다.

부트스트랩에는 `#app[data-auth]`를 두었다. 생성자에서 동기적으로 `unknown`을 찍고,
`/api/auth/me`가 오면 `anonymous`/`authenticated`로 바뀐다. 저장된 credential로 바로 붙는
경로는 `resumed`다. 이게 없으면 랜딩 렌더가 비동기 응답과 얽혀 브라우저 테스트가
`data-screen`을 두고 경쟁하고, 사용자는 화면 깜빡임을 본다.

## 5. 검증

| 증거 | 확인할 내용 | 러너 |
|---|---|---|
| `tests/integration/persistence.test.ts` | 마이그레이션 결정성·재실행 no-op·미래 버전 거절, 대소문자 무시 중복 계정 거절, 소유권 격리, 만료가 조회에 포함됨, FK 강제, 비밀번호 평문 미저장·손상 해시가 예외가 아닌 실패 | `test:network` |
| `tests/integration/auth-service.test.ts` | 중복 계정 거절, ASCII 아이디 제한, 짧은 비밀번호 거절, 없는 아이디와 틀린 비밀번호가 같은 답, 만료 경계와 지연 청소, 로그아웃 멱등성, 계정 간 세션 분리 | `test:network` |
| `tests/integration/campaign-service.test.ts` | Campaign 생성이 세션을 열고 소유를 기억, **소유권이 session state와 gameplay hash에 없음**, 남의 Campaign은 404 형태, 이름 검증, **부분 생성 양방향 차단**(durable write 실패 시 세션 미생성 / 세션 생성 실패 시 campaign row 보상 삭제, 앞선 campaign은 보존) | `test:network` |
| `src/server/database-path.test.ts` | 개발 시드가 개발 DB 경로에서만 허용되고 배포 기본 경로·임의 경로는 거절, `NODE_ENV`는 관여하지 않음 | `test:unit` |
| `src/server/cookies.test.ts` | 파싱·이스케이프 왕복, HttpOnly·SameSite=Lax·Domain 없음, Secure 결정 규칙 | `test:unit` |
| `tests/integration/account.test.ts` | 실제 HTTP 로그인/쿠키/me/로그아웃/만료, 미로그인 401, 타 계정 404가 없는 id와 동일, 자기 Campaign Continue 409, 게스트 무계정 참가, **snapshot과 서버 출력에 비밀번호·토큰·해시 없음**, 서로 다른 계정 두 Campaign의 hash 동일 | `test:network` |
| `tests/e2e/account.spec.ts` | 게스트 진입은 무계정, 틀린 비밀번호 UI, Campaign 생성 후 라이브 세션, 재방문 목록, 계정 간 목록 격리, 로그아웃, save 없는 Continue 비활성 | `test:e2e` |
| 기존 회귀 | `coop.integration.test.ts` 10개, 전체 Adventure 완주 1개, 브라우저 45개 | network / smoke |

이슈 §14의 M9-2 필수 항목 대응:

| 이슈 요구 | 대응 |
|---|---|
| duplicate account reject | persistence·auth-service 단위 테스트(대소문자 변형 포함) |
| bad password reject | auth-service 단위 + HTTP 401 |
| auth expiry / logout | 시계 주입 단위 테스트 + 짧은 TTL 서버의 HTTP 왕복 |
| campaign owner isolation | campaign-service 단위 + HTTP 404 + 브라우저 목록 |
| Guest cannot call owner Campaign API | 쿠키 없는 세 라우트 401, join은 정상 |
| token/password not exposed | snapshot JSON과 stdout/stderr/console.error 단언 |

### Gate 결과

2026-09-09 기준 Node v24.18.1에서 네 gate가 모두 통과했다.

| Gate | 결과 |
|---|---|
| `npm run check` | 통과 — unit 42개 파일·502개 테스트 (M9-1 시점 38/469) |
| `npm run build` | 통과 — `node:sqlite`는 번들에 import로 남고 외부화된다 |
| `npm run test:network` | 통과 — 3개 파일·23개 테스트 |
| `npm run test:smoke` | 통과 — Playwright 49개 (M9-1 시점 45개) |

### 구현 순서

`npm run check`는 `test:network`도 `test:smoke`도 돌리지 않는다. 그래서 라우트 삭제를 먼저
했다면 check는 초록인 채로 CI만 깨졌을 것이다. 순서를 **추가 → 이전 → 삭제**로 잡았다.

1. 플랫폼 하한(engines, esbuild target, `.gitignore`)
2. persistence 계층과 password
3. auth·campaign 서비스
4. 계정 CLI
5. 쿠키와 HTTP 라우트 — **추가만**, `POST /api/sessions`는 그대로 둔다
6. 클라이언트 API — 추가만
7. 계정 화면과 브라우저 테스트 이전
8. `POST /api/sessions`와 `SessionClient.create` 삭제, 네트워크 테스트 이전

## 6. 리뷰 반영

`15593ae..7bbc969` 리뷰에서 P1/P2 두 건을 받아 후속 커밋에서 닫았다.

**P1 — 개발 시드가 배포 DB를 실제로 보호하지 못했다.** 가드가 `NODE_ENV === "production"`만
보는데 이 저장소의 배포 계약(`deploy/cardguild.production.env`, `npm run start:production`)에는
`NODE_ENV`가 없다. 게다가 배포 env와 개발 기본값이 **같은 `.data/cardguild.sqlite`를 가리키고**
있어서, 배포 호스트에서 `npm run dev:coop`을 돌리면 공개된 비밀번호의 계정이 실제 DB에
생길 수 있었다. 개발 DB를 `.data/cardguild.dev.sqlite`로 분리하고, 가드를 경로 allowlist로
바꿨다. 거절 경로를 테스트로 고정했고, 이 테스트는 수정 전 코드에서 실패한다.

**P2 — 부분 생성이 한쪽 방향만 막혀 있었다.** campaign row를 INSERT한 뒤 `store.create()`가
던지면 row가 영구히 남아, 호출자는 실패를 받았는데 목록에는 Campaign이 보였다. 그 row가
M9-3/M9-5의 durable identity 뿌리가 되므로 보상 삭제를 넣고 **양방향 실패를 모두** 테스트했다.
두 테스트 모두 수정 전 코드에서 실패한다.

비차단 지적 두 건도 고쳤다. M9-3이 `CampaignRepository`를 확장해야 한다는 점(§4)과, Node
22.13이 `--experimental-sqlite`를 요구한다는 근거가 사실과 다르다는 점(§2)이다. 22.13
문서는 플래그 없이 `node:sqlite`를 import한다. Node 24 하한 자체는 유지하되 근거를
"22.x가 테스트되지 않는다"로 바로잡았다.

## 7. 남은 작업과 후속 주의점

- **KDF 동시성 상한은 넣지 않았다.** scrypt는 async라 이벤트 루프를 막지 않지만 libuv
  스레드풀 4칸을 정적 파일 서빙과 공유한다. 동시 로그인이 몰리면 SPA 로딩이 느려질 수 있다.
  공개 가입이 없어 계정 수가 운영자에게 알려진 소수라 지금은 과설계로 보고 미뤘다.
- **로그인 실패 횟수 제한도 없다.** 같은 이유이고, 단일 호스트에서 잠금은 자기 DoS 벡터다.
  가입을 열게 되면 둘 다 다시 판단해야 한다.
- **가입은 이후 열렸다.** `POST /api/auth/register`와 로그인·랜딩 화면의 Create account
  버튼이 추가되어, 위 표의 "계정 등록" 행은 더 이상 현재 동작이 아니다. 계정 수가 운영자에게
  알려진 소수라는 전제가 깨졌으므로 **바로 위 두 항목(KDF 동시성 상한, 로그인·가입 시도
  제한)이 다시 열린 문제가 된다.** 초대제로 운영하려면 리버스 프록시에서 그 라우트를 막고
  CLI만 쓴다. 현재 동작은 README를 볼 것.
- **WAL은 아직 실제로 검증되지 않았다.** `PRAGMA journal_mode=WAL`은 `:memory:`에서 조용히
  no-op이고 모든 테스트가 in-memory다. M9-3의 재시작 테스트가 파일 DB를 써야 한다.
- **M9-3 Save restore validator**는 `PartyMember.actorDefinitionId → Character profile`
  semantic 검증을 포함해야 한다. `assertAdventureInvariants()`는 content context가 없어
  이를 확인하지 못한다(M9-1 리뷰에서 지적된 항목).
