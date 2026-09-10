# M9-3 — Durable Campaign Save & Resume Lobby

[Parent issue #36](https://github.com/darkbard81/CardGuild/issues/36)의 M9-3 구현 계약과 검증
기록이다. 기준 브랜치는 `M9-Persistence`, 구현 전 기준 커밋은 M9-2를 끝낸 `ad6089e`이며,
계획은 [issue #39](https://github.com/darkbard81/CardGuild/issues/39)다.

## 1. 목표와 범위

마지막으로 **COMMIT된** 캠페인 진행을 새 라이브 세션으로 복구하고, Host가 Resume한 뒤
정확히 이어서 플레이한다. gameplay의 영속 원본은 SQLite 하나뿐이다.

M9-3의 성과는 "저장 버튼"이 아니라 **공개 순서의 역전**이다.

```text
M9-2까지:  reducer → 메모리 state 교체 → ACK/broadcast
M9-3부터:  reducer → durable COMMIT → 메모리 state 교체 → ACK/broadcast
```

DB write가 실패하면 candidate는 메모리 authority에도, 네트워크에도 존재하지 않는다.
그래서 "클라이언트가 본 진행"은 항상 "DB가 가진 진행"의 부분집합이다.

포함:

- `CampaignSaveV1` gameplay projection과 schema/content migration 진입점, 런타임 검증
- `CampaignRepository`의 save load와 `campaignRevision` compare-and-swap commit
- Client intent와 서버 AI 공통 commit-before-publish, 실패 시 세션 종료 규칙
- `SessionCoreState` v3 · wire protocol v6 · `resume-lobby` lifecycle · `resume-adventure`
- Continue 직렬화, 기존 live writer retire, 새 세션 재수화, Resume Lobby UI

후속 범위:

- **M9-4:** EXP 지급과 Level-Up transition
- **M9-5:** 서버 재시작 복구 강화와 멱등성

## 2. 확정한 기술 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 저장 대상 | `SessionCoreState`가 아니라 gameplay projection | `SessionCoreState`를 통째로 직렬화하면 sessionId·playerId·guestClaims·reconnect가 durable해져 M9-2가 만든 ID 경계가 무너진다 |
| snapshot hash | 기존 `hashSessionGameplayState()` 재사용 | 저장 payload의 raw JSON을 해싱하면 hash의 의미가 바뀐다. 같은 canonical projection을 쓰면 "복구본 hash == 저장 hash"가 한 줄짜리 exit 판정이 된다 |
| DB schema | migration 2 없음 | migration 1의 `campaigns`가 이미 save 컬럼을 갖는다. 실제 schema가 바뀌지 않는데 migration을 추가하면 append-only 목록이 의미를 잃는다 |
| 저장 write | 컬럼 전체를 한 UPDATE로 + revision CAS | 나눠 쓰면 crash나 stale writer가 서로 다른 세대의 snapshot·hash·content identity를 한 row에 남길 수 있다 |
| `campaignRevision` | live `SessionCoreState.revision`과 별개 | Guest join/claim과 Resume은 accepted transition이지만 durable gameplay를 바꾸지 않는다. 두 숫자를 합치면 첫 게스트 참가에서 의미가 갈라진다 |
| AI 저장 실패 | 자동 재시도 없음, 세션 종료 | 재시도는 split-brain writer가 덮어쓰는 경로 그 자체다. Host는 My Campaigns에서 Continue하고 Guest는 새 세션에 참가한다 |
| 미지원·손상 save | 보존하고 명시적 거절 | 지금 코드 모양으로 추측 보정하면 나중에 진짜 migration을 쓸 수 없다 |
| 첫 저장 시점 | `begin-adventure` 성공 | 새 Campaign의 파티 편집만으로 save를 만들면 `hasSave`가 "이어서 할 진행이 있다"를 뜻하지 않게 된다 |

## 3. 지킨 경계

**pure session 계층은 여전히 SQL도 persistence 타입도 모른다.** `createResumedSessionCoreState()`는
`CampaignSaveV1`이 아니라 순수 `SessionGameplayProjection`을 받는다. `SessionHost`는
`SessionDurability` 인터페이스만 알고, 그 뒤에서 `campaign-durability.ts`가 serialize와 CAS를 한다.

**account/campaign 식별자는 여전히 `SessionCoreState` 밖이다.** 저장 payload에도 들어가지
않는다. `campaignId`/`ownerAccountId`는 DB metadata와 `CampaignService`의 map에만 존재한다.

**gameplay hash 계약은 그대로다.** `hashSessionGameplayState()`의 `party` 키와 정렬 의미를
바꾸지 않았다. 입력 타입만 `SessionGameplayHashInput`으로 넓혀 lobby(`adventure: null`)와
복구 projection(`adventure` 필수)을 함께 받는다.

**client durable storage는 늘리지 않았다.** `sessionStorage`에는 지금도 reconnect credential
하나뿐이고, `AdventureState`/`CombatState`/`campaignRevision`/`snapshotHash`는 넣지 않는다.

## 4. 설계

### 저장 계약

```ts
interface CampaignSaveV1 {
  readonly saveSchemaVersion: 1;
  readonly contentIdentity: ContentIdentity;
  readonly partySlots: readonly SessionPartySlot[]; // slot 순 canonical
  readonly adventure: AdventureState;               // v3
  readonly combat: CombatState | null;              // v4
}
```

`adventure`가 nullable이 아닌 이유는 첫 저장이 Adventure begin 이후이기 때문이다. save가
있으면 `AdventureState`도 반드시 있다. `partyPrepared`는 복구 시 파생하고, `adventureSeed`는
`AdventureState`가 이미 들고 있으므로 따로 저장하지 않는다.

### 검증 4단계 (`src/server/campaign-save.ts`)

| 단계 | 검사 | 실패 코드 |
|---|---|---|
| A storage envelope | 저장 metadata 전체 NULL / 일부 NULL, JSON parse, 빈 hash, 정수 아닌 schema version, metadata↔payload 불일치 | `SAVE_NOT_FOUND` / `SAVE_CORRUPT` |
| B save schema | v1만 지원. `migrateSaveSchema()`가 버전 dispatch + Ajv 중첩 구조 검사 | `SAVE_SCHEMA_UNSUPPORTED` / `SAVE_CORRUPT` |
| C content identity | `packId`·`packVersion`·`fingerprint` 3개 모두 일치. `migrateSaveContent()`에 등록된 migration 없음 | `SAVE_CONTENT_MISMATCH` |
| D semantic | 파티/Adventure/Combat 참조와 관계, 재수화 상태의 `assertSessionInvariants()`, snapshot hash 재계산 일치 | `SAVE_CORRUPT` |

단계 D가 실제로 보는 것:

- 연속 slot, 결정적 `memberId`, 고유 캐릭터, 현재 pack 존재, `statProfile.kind === "character"`, `playable` trait
- `partySlots` ↔ `adventure.party.members`의 seat/memberId/actorDefinitionId mapping 일치
- Adventure v3와 progression 불변식, `adventureId` 일치, current/completed encounter가 현재 정의 안에 존재
- reward phase ↔ `pendingReward` 대응, 보상 id와 선택지 수
- `validatePartyLoadout()`으로 loadout/collection 소유 수량, collection 참조 존재
- Combat v4, content identity, scenario 존재, Adventure phase가 `combat`, `scenarioId == currentEncounterId`
- actor id 자기일치·정의 존재·HP 범위·defeat 플래그·맵 안, party member가 전원 actor로 존재
- initiative order의 유일성/전수/활성 index, card zone 소유자와 카드 instance 유일성, effect target
- tile은 자기 좌표 키에, map object는 자기 id 키에, interaction target tile 존재
- pendingReaction의 actor·손패 카드·action 참조, `sequence == commandLog.length`와 gap 없는 순번

**복구 과정에서 encounter를 다시 만들거나 command를 replay하지 않는다.** 거절된 save는
덮어쓰지도 지우지도 않는다.

### SQLite

```sql
UPDATE campaigns
SET campaign_revision = campaign_revision + 1,
    save_schema_version = ?, content_pack_id = ?, content_pack_version = ?,
    content_fingerprint = ?, snapshot_json = ?, snapshot_hash = ?, updated_at = ?
WHERE campaign_id = ? AND owner_account_id = ? AND campaign_revision = ?;
```

`changes === 1`만 성공이다. 0이면 row 존재 여부로 `revision-conflict`와 `not-found`를 가른다.
`loadOwnedSave()`는 `not-found` / `empty` / `partial` / `loaded` 네 답을 준다 — "한 번도 플레이하지
않은 캠페인"과 "반쯤 쓰인 metadata"는 다른 사건이기 때문이다.

### 공개 순서와 실패 처리

```text
순수 reducer → candidate 검증 → durable COMMIT
→ 메모리 상태 교체 → accepted 부수효과·이력 갱신
→ ACK / snapshot → 다음 AI 단계
```

저장 판정은 두 줄이다. gameplay hash가 그대로면 write 없음, `candidate.adventure`가 없으면
write 없음. 덕분에 Guest join/claim, offline guest 제거, presence/control, Resume 전환, 새
Campaign 로비의 파티 편집이 전부 자동으로 제외된다.

| 상황 | 동작 |
|---|---|
| Client 명령의 DB 쓰기 실패 | 이전 상태·revision·이력 유지, 실패 ACK + `PERSISTENCE_FAILED`. **journal에 확정하지 않아** 같은 requestId 재시도가 성공할 수 있다 |
| AI 단계의 DB 쓰기 실패 | candidate 미공개, pump 중단, 오류 통지 후 세션 종료 |
| CAS 충돌 또는 저장 대상 소실 | writer 종료, 이후 명령·attach·join 차단 |
| COMMIT 후 ACK 전 프로세스 종료 | Continue가 이미 COMMIT된 상태를 복구 |

AI는 command마다 COMMIT하고 공개한다. 여러 단계를 한 write로 묶지 않는다 — #36의 crash
계약은 **마지막 durable AI step**까지 복구하는 것이다.

### Continue와 writer 교체

```text
인증·소유권 확인 → Campaign별 직렬 처리 → save 사전 조회·검증
→ 기존 Host queue barrier 종료 → 기존 Host·mapping 제거
→ DB save 재조회·재검증 → 새 identity와 coordinator로 resume-lobby 등록
→ 새 SessionCredential 반환
```

**사전 검증과 실제 복구 원본이 다르다.** 사전 검증은 "손상된 save 때문에 멀쩡히 플레이 중인
세션을 죽이지 않기" 위한 것이고, 실제 복구는 반드시 **기존 writer가 끝난 뒤 다시 읽은** save다.
retire보다 먼저 읽으면 마지막 gameplay transition이 queue에 남아 있어 stale snapshot을 되살린다.

`CampaignService`는 `ownershipBySessionId`에 더해 `liveSessionByCampaignId`를 갖는다. 정리
경로는 항상 session ID를 비교해서, 늦게 도착한 이전 세션 정리가 새 mapping을 지우지 않는다.
세션이 스스로 retire하면(AI 저장 실패) store가 listener로 알려 mapping을 같이 지운다.

`SessionHost.retire()`는 queue에 넣고, AI 실패 경로는 queue 안에서 `retireInQueue()`를 직접
부른다. 두 경로를 나누지 않으면 실행 중인 queue가 자기 종료를 기다리는 교착이 생긴다.

### 상태·권한·API

| 항목 | 계약 |
|---|---|
| `SessionCoreState` | v2 → **v3**, `lifecycle: "lobby" \| "resume-lobby" \| "active"` |
| Wire protocol | v5 → **v6**, 구버전 `PROTOCOL_MISMATCH` |
| `resume-adventure` | Host 전용. lifecycle만 `active`, events 빈 배열, hash 불변, DB write 없음 |
| HTTP Continue 성공 | 기존 credential 응답 구조 유지 (`campaign`/`invite` 동봉) |
| HTTP save 오류 | `SAVE_NOT_FOUND`·`SAVE_CORRUPT`·`SAVE_SCHEMA_UNSUPPORTED`·`SAVE_CONTENT_MISMATCH` → 409 |
| 소유권 오류 | 401, 그리고 존재를 숨기는 404 유지 |
| 저장소 가용성 | 503 `PERSISTENCE_FAILED` |
| WebSocket 오류 | `PERSISTENCE_FAILED`(재시도 가능), terminal `SESSION_RETIRED` |
| 세션 교체 close code | **4005**. 기존 `4001`(연결 교체) 의미는 유지 |

Resume Lobby가 허용하는 intent는 `select-character`·`remove-offline-guest`·`resume-adventure`
뿐이고, Guest join은 `joinSessionCore()` 경로로 허용된다. 나머지는 전부 `FORBIDDEN`이다.

이게 M9-3에서 가장 조용한 구멍이었다. 기존 `authorizeSessionIntent()`의 combat/loadout/
start-encounter 계열은 lifecycle을 보지 않고 Adventure phase와 Combat 존재만 봤는데,
`resume-lobby`는 saved `adventure`와 `combat`을 **이미 들고 있다**. lifecycle만 추가하고
authorization을 그대로 뒀다면 악의적/구버전 Client가 Resume 전에 `use-action`이나
`choose-reward`를 보낼 수 있었다. 그래서 gameplay intent에는 `lifecycle === "active"`를
명시적으로 요구하는 조건을 따로 넣었다.

Host는 혼자서도, 캐릭터를 고르지 않은 Guest가 있어도 Resume할 수 있다. 미할당 캐릭터는
기존 `deriveControlView()` fallback대로 Host가 제어한다.

### 클라이언트

`AdventureController`는 `lobby` / `resume-lobby` / `active`를 명시적으로 분기한다. 이 분기가
없으면 saved Combat이 Resume 전에 화면에 그대로 진입하고 전투 입력이 켜진다.

`SessionLobbyUi.renderLobby()`가 두 모드를 갖는다. Resume 모드에서는 파티 편집기와 Begin
버튼 대신 읽기 전용 저장 파티 패널과 **Resume** 버튼을 보여주고, Guest는 기존 slot 2/3
선택 흐름을 그대로 쓴다. 새 DOM 테마·타이포그래피·반응형 규칙은 건드리지 않았다.

`SessionClient.clearCredential()`은 이제 자기 credential일 때만 지운다. 종료된 이전 탭의
close 4005가 늦게 도착해도 새 Continue가 방금 발급받은 credential을 삭제하지 않는다.

## 5. 검증

| 증거 | 확인할 내용 | 러너 |
|---|---|---|
| `src/server/campaign-save.test.ts` | mid-combat·비기본 Level/EXP·collection roundtrip과 hash 동일성, 입력 불변성, ephemeral 필드 미포함, slot canonical 정렬, malformed JSON/hash 불일치/metadata 불일치, 미지원 schema, content mismatch, 파티·progression·encounter·reward·loadout·combat·actor·turn·cardZone·map·reaction 참조 거절 | `test:unit` |
| `src/server/campaign-durability.test.ts` | control-only 0회 write, 로비 파티 편집 0회, begin-adventure 첫 저장, revision 증가, CAS 충돌·소실의 terminal 처리와 held revision 불변, store 실패의 재시도 가능 형태 | `test:unit` |
| `src/server/session-host.test.ts` | COMMIT 전 ACK/snapshot 미발생(지연 주입), 실패 시 old state·이력 유지와 동일 requestId 재시도 성공, CAS 실패의 `SESSION_RETIRED`+4005와 이후 명령/attach/join 차단, guest join·claim·presence 0회 write, Resume 0회 write와 hash 동일, 적 턴에 멈춘 resume-lobby에서 AI가 깨지 않고 Resume 이후에만 도는 것, AI step별 COMMIT 후 broadcast, AI 실패의 미공개·pump 중단·종료 | `test:unit` |
| `tests/integration/persistence.test.ts` | empty/not-found 구분, 첫 저장 0→1과 `hasSave`, 후속 증가, stale CAS 거절과 row 불변, owner 격리, 부분 metadata `partial`, **실제 파일 DB의 close/reopen과 `journal_mode=wal`** | `test:network` |
| `tests/integration/campaign-service.test.ts` | 첫 durable save 시점, Continue의 fresh 식별자·이전 writer retire·resume-lobby·hash 동일, 대기 중 커밋된 최신 상태 복구, 손상 save의 세션·row 보존, save 없음/타 계정/미지원 거절, 동시 Continue의 단일 writer, stale writer CAS 거절, 자기 retire 후 mapping 정리 | `test:network` |
| `src/session/session.test.ts` | 복구 상태의 fresh identity·revision 0·빈 claim·hash 동일·옛 식별자 부재, Resume 전 gameplay intent 전부 `FORBIDDEN`, 게스트 재참가/재claim, Host 단독 Resume과 lifecycle만 변경, 이어서 플레이, 잘못된 projection 거절 | `test:unit` |
| `src/protocol/validate-message.test.ts` | v6 수용, v1·v3·v4·v5 거절, `resume-adventure` 무페이로드 계약 | `test:unit` |
| `tests/integration/campaign-persistence.test.ts` | 실제 파일 DB의 서버 재시작 → 목록 `hasSave` → Continue → attach → resume-lobby hash → 명령 차단 → Resume → active hash → 이어서 플레이, 이전 credential 4005 무효화, 게스트 재참가·재claim·fallback, **자식 프로세스를 COMMIT 직전/직후에 종료한 뒤 동일 파일 DB 복구** | `test:network` |
| `tests/e2e/campaign-resume.spec.ts` | 1P Continue→Resume 정확 재개, 파티 편집기·Begin 부재와 전투 HUD 차단, 새 invite ID, 1440x900·390 폭 무가로스크롤, 이전 탭의 `SESSION_RETIRED`와 자기 credential만 정리, 2P 재참가·재claim·Host Resume·이탈 fallback | `test:e2e` |
| 기존 회귀 | protocol v6 이전 후 network 23개, 브라우저 49개 | network / smoke |

### 강제 종료 테스트

`tests/support/recovery/fault-server.ts`는 `commitSave` 앞뒤에 fault를 넣고 `process.exit(9)`하는 자식
서버다. 부모 테스트는 실제 파일 DB를 넘겨 자식을 띄우고, HTTP/WebSocket으로 mid-combat까지
플레이한 뒤 다음 end-turn에서 죽인다.

- **COMMIT 직전 종료:** 재시작 후 Continue가 직전 저장을 복구한다. 죽은 turn은 사라진다.
- **COMMIT 직후·공개 전 종료:** 클라이언트는 ACK를 못 받았지만 DB는 그 transition을 갖는다.
  재시작 후 Continue가 그 상태를 복구하고, `completedEncounterIds`와 `collection`은 중복
  적용되지 않는다. 기대 상태는 순수 reducer로 로컬에서 계산해 비교한다.

이 시나리오는 테스트 프로세스 안에서는 만들 수 없다. 핵심이 "프로세스가 죽는다"이기 때문이다.

### Gate 결과

2026-09-09 기준 Node v24.18.1에서 네 gate가 모두 통과했다.

| Gate | 결과 |
|---|---|
| `npm run check` | 통과 — unit 46개 파일·557개 테스트 (M9-2 시점 42/502) |
| `npm run build` | 통과 |
| `npm run test:network` | 통과 — 4개 파일·28개 테스트 (M9-2 시점 3/23) |
| `npm run test:smoke` | 통과 — Playwright 52개 (M9-2 시점 49개) |

## 6. 남은 작업과 후속 주의점

- **단일 서버 프로세스 전제다.** CAS는 split-brain을 *막지만* 조정하지는 않는다. 다중 노드는
  M9-3 범위 밖이고, 그때는 writer lease가 따로 필요하다.
- **AI 저장 실패에 재시도가 없다.** 사용자 선택에 따른 결정이다. 일시적 DB 장애가 세션 종료로
  이어지므로, 운영에서 잦다면 M9-5에서 bounded retry를 다시 판단해야 한다.
- **content migration은 진입점만 있다.** `migrateSaveContent()`에 등록된 단계가 없으므로
  콘텐츠 팩을 갱신하면 기존 save는 `SAVE_CONTENT_MISMATCH`가 된다. 보존은 되지만 열 수는 없다.
- **Combat 심층 구조의 Ajv 검증은 한 겹 얕다.** `statProfile.stats`와 command의 action/target은
  구조만 본다. 실질 방어선은 snapshot hash 재계산이며, 깊은 변조는 거기서 `SAVE_CORRUPT`가 된다.
- **저장 payload는 압축하지 않는다.** mid-combat snapshot은 수백 KB 수준이고 write는
  gameplay transition마다 일어난다. 캠페인 수가 늘면 row 크기와 WAL 증가를 다시 봐야 한다.
