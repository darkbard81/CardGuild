# M9-3 구현계획 — Durable Campaign Save × Resume Lobby

> 기준 저장소: `darkbard81/CardGuild`  
> 기준 브랜치: `M9-Persistence`  
> 기준 커밋: `ad6089e891fb88c627b4a7fbea7820a085a604d4`  
> 상위 이슈: [#36 — M9 Player Progression × Host-Owned Campaign Persistence × Server Recovery](https://github.com/darkbard81/CardGuild/issues/36)  
> 선행 서브이슈: [#37 — M9-1 Character Progression Foundation](https://github.com/darkbard81/CardGuild/issues/37), [#38 — M9-2 Host Identity & Campaign Ownership](https://github.com/darkbard81/CardGuild/issues/38)

---

## 0. 결론

M9-3는 단순히 `SessionCoreState`를 SQLite에 `JSON.stringify()` 하는 작업으로 구현하면 안 된다. 현재 코드와 #36의 계약을 같이 보면 구현의 중심은 다음 네 가지다.

1. **Gameplay projection만 저장하는 `CampaignSaveV1`을 독립 계약으로 만든다.**
   - `ContentIdentity`
   - 고정된 `partySlots`
   - `AdventureState v3`
   - `CombatState | null`
   - `sessionId`, `playerId`, `guestClaims`, reconnect credential, presence/control, request journal은 절대 저장하지 않는다.

2. **`SessionHost`의 state publish 순서를 `durable COMMIT → stateValue 교체 → ACK/broadcast`로 바꾼다.**
   - Client intent와 Server AI 모두 같은 경로를 탄다.
   - DB write가 실패하면 candidate state는 메모리 authority에도, network에도 공개되지 않는다.
   - gameplay hash가 바뀌지 않는 control/presence-only 변화는 DB를 쓰지 않는다.

3. **Continue는 저장된 `SessionCoreState`를 되살리는 것이 아니라 새로운 live session을 재수화한다.**
   - 새 `gameSessionId`
   - 새 Host `playerId`
   - 새 reconnect token
   - `guestClaims = {}`
   - `controlRevision = 0`, request journal 비움
   - 저장된 party/adventure/combat만 복구
   - lifecycle은 명시적인 `resume-lobby`

4. **한 Campaign에 두 개의 live writer가 생기지 않도록 막아야 한다.**
   - 브라우저를 닫은 뒤 Host가 Continue하면 기존 in-memory SessionHost가 서버에 남아 있을 수 있다.
   - 단순히 새 SessionHost를 추가하면 동일 Campaign을 두 세션이 동시에 저장하는 split-brain이 된다.
   - Continue는 기존 live session을 queue barrier 뒤 retire한 다음 durable save를 다시 읽고 새 session을 만든다.
   - DB write에는 `campaignRevision` compare-and-swap(CAS)을 추가해 stale writer를 최종적으로 차단한다.

이 네 계약을 먼저 고정하면 M9-3의 나머지는 repository/API/UI 연결 작업으로 정리된다.

---

# 1. 현재 레포 상태 분석

## 1.1 M9-1이 이미 바꿔 놓은 Save 대상

M9-1 이후 `AdventureState`는 **v3**이고 `PartyMemberState`는 필수 runtime progression을 가진다.

```ts
interface CharacterProgressionState {
  readonly level: number;
  readonly experience: number;
}

interface PartyMemberState {
  // ...
  readonly actorDefinitionId: ActorDefinitionId;
  readonly loadout: PartyMemberLoadout;
  readonly progression: CharacterProgressionState;
}
```

따라서 M9-3 Save는 Level/EXP를 별도 테이블에 떼어 저장할 필요가 없다. `AdventureState`를 canonical gameplay projection에 포함하면 progression은 자연스럽게 durable해진다.

중요한 점은 현재 `assertAdventureInvariants()`가 실질적으로 다음만 검사한다는 것이다.

- Adventure version이 3인지
- 각 PartyMember progression의 Level/EXP 범위가 정상인지

즉 M9-3 restore validator가 이것만 호출해서는 부족하다. 특히 #38 리뷰에서 지적된 것처럼 다음 semantic check는 별도로 필요하다.

```text
PartyMember.actorDefinitionId
  → 현재 Content Pack에 존재하는가?
  → Character stat profile인가?
  → saved partySlots와 Adventure party가 서로 같은 캐릭터를 가리키는가?
```

M9-1은 durable migration을 의도적으로 M9-3에 넘겼기 때문에, Adventure v2 같은 오래된 runtime object를 조용히 v3로 보정해서도 안 된다.

---

## 1.2 M9-2가 이미 준비한 SQLite schema

현재 migration 1의 `campaigns` table은 M9-3용 column을 이미 갖는다.

```sql
campaign_revision    INTEGER NOT NULL DEFAULT 0,
save_schema_version  INTEGER,
content_pack_id      TEXT,
content_pack_version TEXT,
content_fingerprint  TEXT,
snapshot_json        TEXT,
snapshot_hash        TEXT,
```

따라서 **M9-3에서 단순히 snapshot 저장을 시작하기 위해 DB schema migration 2를 추가할 필요는 없다.**

이번 단계에서 필요한 것은 schema 확장이 아니라 repository 계약 확장이다.

현재 `CampaignRepository`는 다음뿐이다.

```ts
create(campaign)
listByOwner(ownerAccountId)
findOwned(campaignId, ownerAccountId)
delete(campaignId, ownerAccountId)
```

그리고 `CampaignRecord`는 summary metadata와 `hasSave`만 노출한다.

따라서 M9-3은 #38 리뷰에서 정정된 대로:

> 상위 `Persistence` composition과 DI 경계는 유지하되, `CampaignRepository` 자체는 반드시 확장한다.

가 정확한 구현 방향이다.

---

## 1.3 현재 SessionHost의 가장 큰 변경점

현재 accepted Client intent는 대략 아래 순서다.

```text
reducer
→ this.stateValue = result.state
→ event history 갱신
→ ACK
→ snapshot broadcast
→ server AI pump
```

Server AI도 동일하게:

```text
server reducer
→ this.stateValue = result.state
→ event history 갱신
→ broadcast
```

M9-3에서는 이 순서가 핵심적으로 바뀌어야 한다.

```text
reducer
→ candidate state
→ gameplay projection 변화 판정
→ durable DB COMMIT
→ this.stateValue = candidate
→ event history 갱신
→ ACK / broadcast
```

이 변경은 `SessionHost`의 부가 기능이 아니라 M9-3의 correctness boundary다.

---

## 1.4 현재 gameplay hash는 Save projection과 거의 정확히 일치한다

현재 `hashSessionGameplayState()`는 다음만 hash한다.

```ts
{
  contentIdentity,
  party: sortedPartySlots,
  adventure,
  combat,
}
```

반대로 다음은 이미 hash에서 빠져 있다.

- `sessionId`
- `revision`
- `lifecycle`
- `hostPlayerId`
- seats / player identity
- `guestClaims`
- connection presence / control revision

이것은 M9-3에 매우 유리하다.

**Save 여부를 판단하는 기준도 기존 gameplay hash를 그대로 활용하는 것이 가장 안전하다.**

단, `snapshot_hash`를 새 JSON key 구조(`partySlots`)의 raw JSON hash로 바꾸면 기존 gameplay hash 의미가 달라질 수 있다. 따라서 저장 hash는 기존 계약을 그대로 유지하는 쪽을 권장한다.

```ts
snapshotHash = hashSessionGameplayState(candidate)
```

Restore 후 fresh SessionCoreState에서도 같은 함수 결과가 같아야 한다.

---

## 1.5 Continue route는 M9-3을 위해 이미 마지막 한 칸만 비워둔 상태다

현재:

```text
POST /api/campaigns/:id/continue
  → authenticate
  → ownership check
  → campaign이 없거나 남의 것이면 404
  → save가 없으면 409 SAVE_NOT_FOUND
```

M9-3은 이 마지막 분기를 다음으로 교체하면 된다.

```text
load saved snapshot
→ validate / migrate
→ retire previous live writer if any
→ create fresh resume-lobby SessionHost
→ return fresh SessionCredential
```

Client의 `SessionClient.continueCampaign()`과 `AdventureController.continueCampaign()`도 이미 성공 응답으로 `SessionCredential`이 오면 attach하는 구조라서 재사용할 수 있다.

---

# 2. 확정할 상태 계약

## 2.1 `CampaignSaveV1`

M9-3의 durable payload는 아래로 고정한다.

```ts
export interface CampaignSaveV1 {
  readonly saveSchemaVersion: 1;
  readonly contentIdentity: ContentIdentity;
  readonly partySlots: readonly SessionPartySlot[];
  readonly adventure: AdventureState;
  readonly combat: CombatState | null;
}
```

### 왜 `adventure`는 nullable이 아닌가

M9-3의 첫 auto-save 시점을 **Adventure begin 이후**로 고정하기 때문이다.

New Campaign의 lobby에서 party만 편집한 상태는 `hasSave=false`다. Host가 `begin-adventure`를 성공시키는 transition이 최초 durable save가 된다.

따라서 save가 존재한다면 `AdventureState`도 반드시 존재한다.

### 저장하지 않는 필드

다음은 DB snapshot에 들어가면 안 된다.

```text
SessionCoreState.version
SessionCoreState.sessionId
SessionCoreState.revision
SessionCoreState.lifecycle
SessionCoreState.hostPlayerId
SessionCoreState.adventureSeed   // AdventureState.adventureSeed에서 복구 가능
SessionCoreState.seats
SessionCoreState.partyPrepared
SessionCoreState.guestClaims

connectedPlayerIds
controlRevision
reconnect token / digest
request journal
socket/connection
combatEventHistory/UI playback queue
accountId / campaignId          // DB metadata에만 존재
```

`partyPrepared`는 Save가 존재하는 순간 항상 true이므로 restore state에서 파생한다.

---

## 2.2 Campaign DB metadata와 snapshot을 분리한다

`CampaignRecord`에 거대한 JSON payload를 억지로 붙이지 않는 편이 좋다.

현재 list API는 Campaign summary만 필요하기 때문이다.

권장 타입:

```ts
export interface CampaignSaveRecord {
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly campaignRevision: number;
  readonly saveSchemaVersion: number;
  readonly contentIdentity: ContentIdentity;
  readonly snapshotJson: string;
  readonly snapshotHash: string;
  readonly updatedAt: number;
}

export interface CampaignSaveCommit {
  readonly campaignId: string;
  readonly ownerAccountId: string;
  readonly expectedCampaignRevision: number;
  readonly saveSchemaVersion: number;
  readonly contentIdentity: ContentIdentity;
  readonly snapshotJson: string;
  readonly snapshotHash: string;
  readonly updatedAt: number;
}
```

Repository는 다음 수준으로 확장한다.

```ts
export interface CampaignRepository {
  create(campaign: CampaignRecord): CampaignRecord;
  listByOwner(ownerAccountId: string): readonly CampaignRecord[];
  findOwned(campaignId: string, ownerAccountId: string): CampaignRecord | undefined;
  delete(campaignId: string, ownerAccountId: string): boolean;

  loadOwnedSave(
    campaignId: string,
    ownerAccountId: string,
  ): CampaignSaveRecord | undefined;

  commitSave(input: CampaignSaveCommit):
    | { readonly committed: true; readonly campaignRevision: number }
    | { readonly committed: false; readonly reason: "not-found" | "revision-conflict" };
}
```

`Persistence` 자체의 shape는 그대로 유지한다.

---

## 2.3 `campaignRevision`은 live session revision과 완전히 별개다

현재 `SessionCoreState.revision`은 accepted live transition마다 증가한다.

하지만 M9-3에서는 Guest join/claim, resume-lobby lifecycle 전환처럼 durable gameplay를 바꾸지 않는 accepted transition도 존재한다.

따라서 두 revision을 합치면 안 된다.

```text
SessionCoreState.revision
  = 현재 live room의 optimistic concurrency revision

campaignRevision
  = durable gameplay save가 성공적으로 commit된 횟수
```

예:

```text
Campaign 생성               campaignRevision 0
party composition 변경       0
Guest join/claim              0
begin-adventure 저장          1
Guest disconnect/control      1
loadout 변경 저장             2
start encounter 저장          3
combat action 저장            4
AI action 저장                5
Resume Lobby 진입             5
Guest 재join/claim            5
Host Resume                   5
```

---

# 3. SQLite write 계약 — CAS가 필요하다

## 3.1 단일 UPDATE에 snapshot 전체를 넣는다

저장은 column별 여러 UPDATE로 나누지 않는다.

```sql
UPDATE campaigns
SET
  campaign_revision    = campaign_revision + 1,
  save_schema_version  = ?,
  content_pack_id      = ?,
  content_pack_version = ?,
  content_fingerprint  = ?,
  snapshot_json        = ?,
  snapshot_hash        = ?,
  updated_at           = ?
WHERE campaign_id = ?
  AND owner_account_id = ?
  AND campaign_revision = ?;
```

`changes === 1`일 때만 성공이다.

이 방식은 한 statement 안에서 다음을 동시에 보장한다.

- snapshot JSON
- snapshot hash
- ContentIdentity
- save schema version
- updatedAt
- campaignRevision

이 서로 다른 세대의 값으로 섞이지 않는다.

---

## 3.2 CAS를 쓰는 이유

`SessionHost` 내부 queue만 믿으면 한 SessionHost 안에서는 single writer가 맞다.

그러나 M9-3 이후에는 같은 Campaign을 Continue해서 새로운 live session을 만들 수 있다.

구현 실수나 race로 old SessionHost가 살아 있어도 CAS가 있으면:

```text
old writer: expected campaignRevision = 18
new writer: expected campaignRevision = 18

먼저 commit한 쪽 → 19
나중 writer UPDATE → changes = 0
→ stale writer로 판정
→ candidate publish 금지
```

즉 `campaignRevision`은 단순 표시용 숫자가 아니라 **split-brain 최종 방어선**으로 사용한다.

---

## 3.3 현재 migration 1은 유지

M9-3이 기존 save column을 사용하기 시작한다는 이유만으로 `MIGRATIONS`에 새 항목을 만들지 않는다.

새 migration이 필요한 경우는 실제 DB schema를 바꿀 때뿐이다.

M9-3의 주요 변경은:

- prepared statement 추가
- nullable snapshot column read
- all-or-none snapshot metadata 검증
- CAS save update

이다.

---

# 4. Save serializer / validator / migration entry point

새 server-only 모듈을 권장한다.

```text
src/server/campaign-save.ts
src/server/campaign-save.test.ts
```

여기에 SQL을 넣지는 않는다.

역할은 다음으로 한정한다.

```text
SessionCoreState
  ↕
CampaignSaveV1
  ↕
JSON / hash / runtime validation / migration
```

---

## 4.1 serializer

```ts
export function createCampaignSave(state: SessionCoreState): CampaignSaveV1 {
  if (!state.adventure) throw new Error("Campaign save requires an active AdventureState.");

  return {
    saveSchemaVersion: 1,
    contentIdentity: { ...state.contentIdentity },
    partySlots: [...state.partySlots]
      .sort((a, b) => a.slot - b.slot)
      .map((slot) => ({ ...slot })),
    adventure: state.adventure,
    combat: state.combat,
  };
}
```

실제 implementation에서는 input object를 mutation하지 않는 테스트를 추가한다.

---

## 4.2 snapshot hash는 기존 gameplay hash와 동일해야 한다

권장 계약:

```ts
const save = createCampaignSave(candidate);
const snapshotJson = JSON.stringify(save);
const snapshotHash = hashSessionGameplayState(candidate);
```

Restore validator는 saved payload로 같은 canonical gameplay hash를 재계산하여 DB의 `snapshot_hash`와 비교한다.

이렇게 하면 M9-3 Exit를 테스트 한 줄로 표현할 수 있다.

```ts
expect(hashSessionGameplayState(restored)).toBe(saved.snapshotHash);
```

그리고 M9 이전의 gameplay hash 의미를 불필요하게 바꾸지 않는다.

---

## 4.3 runtime validation은 4단계로 나눈다

### 단계 A — storage envelope

- save column이 모두 NULL → `SAVE_NOT_FOUND`
- 일부만 NULL → corrupt save
- `snapshot_json` JSON parse 실패 → corrupt save
- `snapshot_hash` 빈 값 → corrupt save
- `save_schema_version` integer가 아님 → corrupt save

### 단계 B — Save schema version

```ts
const CURRENT_SAVE_SCHEMA_VERSION = 1;

function migrateSave(value: unknown): CampaignSaveV1 {
  // v1은 그대로 validate
  // 미래 v2가 생기면 v1 → v2 migration을 여기에 등록
}
```

현재는 v1만 지원하고 그 외 버전은 명시적으로:

```text
SAVE_SCHEMA_UNSUPPORTED
```

으로 거절한다.

중요한 것은 **지원하지 않는 Save를 현재 코드 모양으로 추측해서 자동 보정하지 않는 것**이다.

### 단계 C — ContentIdentity

현재 production content와 아래 세 값이 모두 같아야 한다.

```text
packId
packVersion
fingerprint
```

정확히 같으면 계속한다.

다르면 content migration registry를 통과시킨다.

```ts
migrateSaveContent(save, currentContentIdentity)
```

M9-3 시점에는 등록된 migration이 없다면:

```text
SAVE_CONTENT_MISMATCH
```

으로 끝낸다.

**실패 시 DB row를 overwrite하거나 삭제하지 않는다.**

### 단계 D — semantic validation

최소한 다음은 반드시 검사한다.

1. `partySlots` slot/memberId/actorDefinitionId 유일성
2. 모든 `actorDefinitionId`가 현재 pack에 존재
3. Party member용 ActorDefinition은 `statProfile.kind === "character"`
4. playable Character인지 확인
5. saved `partySlots`와 `adventure.party.members`가 같은 memberId/seat/actorDefinitionId mapping인지 확인
6. `AdventureState.version === 3`
7. 각 progression의 Level/EXP invariant
8. `adventure.adventureId`가 현재 SessionAuthorityContext의 adventure와 일치
9. current/completed encounter ID가 현재 AdventureDefinition 안에 존재
10. Combat가 있으면:
    - `CombatState.version === 4`
    - Combat `contentIdentity`가 save/current content와 일치
    - `scenarioId`가 pack에 존재
    - Adventure phase가 `combat`
    - `adventure.currentEncounterId === combat.scenarioId`
11. Combat가 없는데 Adventure phase가 `combat`이면 reject
12. 최종 rehydrated SessionCoreState에 `assertSessionInvariants()` 실행
13. `snapshot_hash` 재계산 결과가 DB 값과 정확히 일치

현재 `assertAdventureInvariants()`는 content-aware validation을 하지 않으므로 위 semantic layer를 생략하면 안 된다.

---

# 5. Resume용 Session 상태

## 5.1 lifecycle을 `resume-lobby`로 명시한다

현재:

```ts
lifecycle: "lobby" | "active"
```

권장:

```ts
lifecycle: "lobby" | "resume-lobby" | "active"
```

`resume-lobby`를 별도 상태로 두는 이유는 saved Combat가 이미 존재하더라도 Host가 Resume 버튼을 누르기 전 gameplay command를 막아야 하기 때문이다.

---

## 5.2 SessionCoreState version과 protocol version

`resume-lobby` lifecycle과 `resume-adventure` intent가 wire-visible state/intent shape를 바꾼다.

따라서 다음을 함께 올리는 것을 권장한다.

```text
SessionCoreState.version: 2 → 3
wire protocol: v5 → v6
```

M9-1에서 Adventure v3 추가 때문에 protocol v5를 올린 것과 같은 원칙이다.

예상 파일:

```text
src/session/types.ts
src/session/authority.ts
src/session/session.test.ts
src/protocol/v6-types.ts
src/protocol/index.ts
src/protocol/validate-message.ts
src/protocol/validate-message.test.ts
src/client/session-client.ts
network tests
README/protocol docs
```

`sessionStorage`의 credential shape는 바뀌지 않으므로 저장 key를 반드시 바꿀 필요는 없다. 이전 배포의 stale credential은 handshake 실패 시 기존 terminal clear 경로로 제거할 수 있다.

---

## 5.3 새 intent

```ts
| { readonly type: "resume-adventure" }
```

역할은 오직:

```text
resume-lobby → active
```

전환뿐이다.

Adventure/Combat/party를 바꾸지 않아야 하므로 gameplay hash는 동일하고 DB write도 없어야 한다.

---

## 5.4 `createResumedSessionCoreState()`

Pure session 계층에 server persistence 타입을 import하지 않는다.

예를 들어 `CampaignSaveV1` 자체 대신 pure projection을 인자로 받게 한다.

```ts
interface SessionGameplayProjection {
  readonly contentIdentity: ContentIdentity;
  readonly partySlots: readonly SessionPartySlot[];
  readonly adventure: AdventureState;
  readonly combat: CombatState | null;
}
```

생성 결과:

```ts
{
  version: 3,
  sessionId: freshSessionId,
  revision: 0,
  contentIdentity: saved.contentIdentity,
  lifecycle: "resume-lobby",
  hostPlayerId: freshHostPlayerId,
  adventureSeed: saved.adventure.adventureSeed,
  seats: [{ seat: 1, playerId: freshHostPlayerId, displayName }],
  partyPrepared: true,
  partySlots: saved.partySlots,
  guestClaims: { byMemberId: {} },
  adventure: saved.adventure,
  combat: saved.combat,
}
```

복구하지 않는 것:

```text
옛 sessionId
옛 SessionCoreState.revision
옛 playerId/displayName
옛 Guest claim
옛 reconnect credential
옛 connection presence
옛 request journal
옛 controlRevision
옛 combat playback event history
```

---

# 6. Resume Lobby의 권한 경계 — 현재 코드에서 반드시 막아야 할 구멍

이 부분은 M9-3에서 특히 중요하다.

현재 `authorizeSessionIntent()`의 combat/loadout/start-encounter 계열은 대부분 `lifecycle === "active"`를 직접 확인하지 않고 Adventure phase/Combat 상태를 보고 판단한다.

그런데 `resume-lobby`는 saved `adventure`와 `combat`을 이미 들고 있다.

따라서 lifecycle만 추가하고 authorization을 그대로 두면 악의적/구버전 Client가 Resume 버튼을 누르기 전에:

```text
use-action
end-turn
use-reaction
set-loadout
start-encounter
choose-reward
```

같은 gameplay intent를 보낼 수 있다.

### 권장 규칙

`resume-lobby`에서 허용:

```text
select-character
remove-offline-guest
resume-adventure
```

Guest join은 `joinSessionCore()` 경로에서 허용한다.

나머지 gameplay intent는 모두 `FORBIDDEN`.

동시에 defense-in-depth로 실제 gameplay intent도 명시적으로 `lifecycle === "active"`를 요구하도록 수정한다.

### Party composition

Resume Lobby에서는 saved party가 고정이다.

```text
set-party-composition → 항상 금지
```

### Host solo Resume

Host는 Guest 없이도 Resume할 수 있어야 한다.

unclaimed character는 기존 `deriveControlView()` 규칙상 자동으로 Host가 control한다.

Guest가 먼저 join했다가 character를 선택하지 않은 경우에도 Host Resume을 막을 필요는 없다. 해당 Guest는 control 대상이 없고, unclaimed Character는 Host에게 남는다.

---

# 7. SessionHost durable orchestration

## 7.1 SQL을 SessionHost 안에 넣지 않는다

권장 server-only interface:

```ts
export interface SessionDurability {
  commitGameplayTransition(
    previous: SessionCoreState,
    candidate: SessionCoreState,
  ): Promise<void>;
}
```

실제 구현은 Campaign persistence coordinator가 담당한다.

```text
SessionHost
  → SessionDurability abstraction
      → CampaignSave serializer
      → CampaignRepository.commitSave()
      → SQLite
```

Pure reducer/session 계층은 여전히 SQL을 모른다.

---

## 7.2 save 필요 여부

가장 단순하고 안전한 규칙:

```ts
const beforeHash = hashSessionGameplayState(previous);
const afterHash = hashSessionGameplayState(candidate);

if (beforeHash === afterHash) {
  // control/session-only transition
  return;
}

if (!candidate.adventure) {
  // New Campaign lobby는 아직 durable save를 만들지 않는다.
  return;
}

await durableCommit(candidate, afterHash);
```

이 규칙의 장점:

- Guest join → skip
- Guest claim → skip
- remove offline guest → skip
- Resume lifecycle change → skip
- connection presence/control → 애초에 SessionCoreState gameplay hash 변화 없음
- party composition in New Lobby → hash는 변하지만 adventure가 null이므로 skip
- begin-adventure → 첫 save
- loadout/reward/combat/progression → save
- Server AI → save

M9-4에서 Level/EXP가 실제로 변하기 시작해도 AdventureState가 hash에 들어 있으므로 추가 분기가 필요 없다.

---

## 7.3 Client intent commit 순서

현재 `handleIntent()`의 accepted path를 다음으로 재구성한다.

```text
1. previous = stateValue
2. pure reducer → candidate
3. candidate invariant
4. await durability.commitGameplayTransition(previous, candidate)
5. stateValue = candidate
6. reconnect/journal cleanup 등 accepted side effect
7. combatEventHistory 갱신
8. accepted ACK 기록
9. ACK send
10. snapshot broadcast
11. server authority pump
```

### DB write 실패 시

```text
stateValue 유지
combatEventHistory 유지
accepted ACK를 journal에 넣지 않음
candidate broadcast 금지
```

Client에는 v6의 명시적인 transient server error를 권장한다.

```text
PERSISTENCE_FAILED
```

이 에러는 domain rejection과 구분해야 한다.

Retry 가능성을 남기기 위해 persistence failure를 성공 request journal처럼 영구 기억하지 않는다.

---

## 7.4 Server AI도 같은 commit 함수 사용

현재 `pumpServerAuthority()`에서 바로 `stateValue`를 교체하는 코드를 없앤다.

각 AI command마다:

```text
AI command
→ reducer candidate
→ durable commit
→ state publish
→ broadcast
```

를 거친다.

AI 여러 command를 한 transaction에 batching하지 않는다. #36의 crash contract는 **마지막 durable AI step**까지 복구하는 것이다.

DB write가 실패하면 해당 AI candidate는 publish하지 않고 pump를 중단한다.

---

# 8. Continue 시 old live session을 처리해야 한다

## 8.1 왜 필요한가

`SessionStore`는 현재 `Map<string, SessionHost>`에 SessionHost를 계속 보관한다.

브라우저 탭을 닫는 것은 SessionHost 삭제가 아니다.

따라서 M9-3 Exit의:

> 브라우저를 닫은 뒤 Campaign이 서버 DB에 남고, Continue로 fresh live session을 연다.

를 그대로 구현하면 다음 race가 생길 수 있다.

```text
Campaign C
 ├─ old SessionHost S1  (서버 메모리에 아직 존재)
 └─ Continue → new SessionHost S2

S1과 S2가 모두 Campaign C를 write 가능
```

이 상태는 허용하면 안 된다.

---

## 8.2 CampaignService가 양방향 live mapping을 가진다

현재:

```ts
ownershipBySessionId: Map<sessionId, { campaignId, ownerAccountId }>
```

여기에:

```ts
liveSessionByCampaignId: Map<campaignId, sessionId>
```

를 추가한다.

Campaign identity는 여전히 SessionCoreState 밖에 있다.

---

## 8.3 Continue 알고리즘

권장 순서:

```text
1. authenticate account
2. findOwned(campaignId, accountId)
3. per-campaign continue operation serialize
4. 기존 live session이 있으면 SessionHost retire barrier 대기
5. old session을 SessionStore/ownership map에서 제거
6. durable save를 DB에서 다시 load
7. schema/hash/content/semantic validate
8. fresh Host identity + reconnect credential 생성
9. fresh gameSessionId 생성
10. resume-lobby SessionCoreState 생성
11. CampaignDurability를 loaded campaignRevision으로 초기화
12. SessionHost 등록
13. ownershipBySessionId / liveSessionByCampaignId 갱신
14. fresh SessionCredential 반환
```

### 중요한 순서: retire 후 다시 load

old SessionHost queue에 마지막 gameplay transition이 이미 들어가 있을 수 있다.

따라서:

```text
save load → old host retire
```

순서는 stale snapshot을 읽을 수 있다.

반드시:

```text
old host queue barrier/retire 완료
→ 그 다음 DB load
```

로 해야 한다.

---

## 8.4 SessionHost retire

`SessionStore`에 다음 경로를 추가하는 것을 권장한다.

```ts
async retire(sessionId: string, reason: string): Promise<void>
```

SessionHost 쪽에서는 queue 안에서:

- `retired=true`
- 현재 connection close
- 이후 attach/intent 거절

을 수행한다.

그리고 queue가 drain된 뒤 Store map에서 제거한다.

기존 WebSocket close code `4001`이 “newer connection replaced this client” 의미로 이미 사용되고 있으므로, 같은 terminal semantics를 재사용하거나 새 reason을 명확히 정의한다.

---

## 8.5 CAS는 retire의 보조가 아니라 최종 안전장치

정상 경로는 retire barrier로 old writer를 끝낸다.

그래도 bug/race가 생겼을 때 CAS가 stale writer의 DB overwrite를 막는다.

둘 중 하나만 구현하는 것보다 둘 다 있는 편이 M9-3의 durable authority 계약에 맞다.

---

# 9. HTTP/API 계약

## 9.1 성공

```http
POST /api/campaigns/:campaignId/continue
```

성공 응답은 현재 Client가 이미 받을 수 있는 `SessionCredential` 중심 shape를 유지한다.

```json
{
  "sessionId": "fresh-session-id",
  "playerId": "fresh-host-player-id",
  "reconnectToken": "fresh-token",
  "seat": 1
}
```

필요하다면 create와 맞춰 `campaign` / `invite`를 추가할 수 있지만 M9-3 필수는 아니다.

---

## 9.2 실패 코드

현재 HTTP-only `ApiErrorCode`에 다음을 추가하는 것을 권장한다.

```text
SAVE_SCHEMA_UNSUPPORTED
SAVE_CONTENT_MISMATCH
SAVE_CORRUPT
```

모두 Campaign row는 그대로 둔다.

권장 status는 `409 Conflict`다. 사용자의 request JSON이 잘못된 것이 아니라 현재 build와 durable save의 compatibility/state가 충돌한 것이기 때문이다.

타인 Campaign은 기존대로 존재 자체를 숨기고 `404 CAMPAIGN_NOT_FOUND`를 유지한다.

---

## 9.3 snapshot은 HTTP 응답으로 노출하지 않는다

`GET /api/campaigns`는 summary만 유지한다.

```text
campaignId
name
hasSave
createdAt
updatedAt
```

`ownerAccountId`, raw snapshot, snapshot hash, campaignRevision은 일반 Client UI가 필요로 하지 않는다.

---

# 10. Client / UI 구현

## 10.1 SessionClient는 gameplay를 저장하지 않는다

현재 `sessionStorage`에는 live reconnect credential만 저장한다.

이 계약을 유지한다.

M9-3 이후에도 다음을 browser durable storage에 넣지 않는다.

```text
AdventureState
CombatState
CampaignSaveV1
campaignRevision
snapshotHash
```

게임 진행의 durable source는 오직 server DB다.

---

## 10.2 AdventureController에 resume-lobby 분기를 추가한다

현재 render path는:

```ts
if (state.lifecycle === "lobby") {
  render lobby
  return
}

// 그 외는 active라고 가정
render adventure/combat
```

이 상태로 `resume-lobby`만 추가하면 saved Combat가 **Resume 전에 바로 화면에 진입**한다.

반드시:

```ts
if (state.lifecycle === "lobby") {
  ...
  return;
}

if (state.lifecycle === "resume-lobby") {
  ...
  return;
}

// active only
```

로 분기한다.

---

## 10.3 Resume Lobby UI

기존 `SessionLobbyUi`를 확장하는 편이 현재 UI 구조와 맞다.

표시:

- Campaign Continue 상태
- saved party 1~3 slot
- 각 Character 이름
- Host Character 고정
- Guest join 상태
- Guest claim 상태
- invite/session ID
- Host `Resume` 버튼

금지/숨김:

- party composition 변경 UI
- Begin Adventure 버튼

Guest는 기존 join → select-character 흐름을 재사용한다.

Host가 혼자 Resume하면 slot 2/3은 기존 control fallback 규칙에 따라 Host가 제어한다.

---

# 11. 파일 단위 변경 계획

## 신규 권장

```text
src/server/campaign-save.ts
src/server/campaign-save.test.ts

src/server/campaign-durability.ts
src/server/campaign-durability.test.ts

tests/network/campaign-persistence.integration.test.ts
```

`campaign-durability.ts`는 작게 유지한다.

역할:

- 현재 `campaignRevision` 보유
- gameplay hash 변화 판정
- CampaignSave serialize
- repository CAS commit
- 성공 시 local revision 갱신

---

## 수정 — persistence

```text
src/server/persistence/types.ts
src/server/persistence/sqlite-persistence.ts
src/server/persistence/persistence.test.ts
```

내용:

- CampaignSaveRecord/Commit 계약
- loadOwnedSave
- commitSave CAS
- partial snapshot metadata reject
- owner isolation
- monotonic revision
- real file DB reopen test 일부 추가

`migrations.ts`는 schema를 실제로 바꾸지 않는 한 수정하지 않는다.

---

## 수정 — session pure domain

```text
src/session/types.ts
src/session/authority.ts
src/session/authorization.ts
src/session/session-hash.ts
src/session/session.test.ts
src/session/index.ts
```

내용:

- SessionCoreState v3
- `resume-lobby`
- `resume-adventure`
- fresh restore state builder
- resume-lobby authorization gate
- joinSessionCore의 resume-lobby 허용
- gameplay hash 유지 회귀

가능하면 `session-hash.ts`에는 raw save type을 넣지 않고 canonical gameplay hash helper만 둔다.

---

## 수정 — server orchestration

```text
src/server/session-host.ts
src/server/session-store.ts
src/server/campaign-service.ts
src/server/campaign-service.test.ts
src/server/http-api.ts
src/server/server.ts
src/server/index.ts
```

내용:

- SessionHost durability injection
- commit-before-publish
- Server AI durable commit
- retire/barrier
- SessionStore restore/retire
- one Campaign → one current live session mapping
- Continue rehydration
- save error HTTP mapping

`server.ts`는 현재 SessionStore를 Persistence보다 먼저 만들고 CampaignService에 둘을 전달한다. M9-3에서도 이 상위 DI 구조를 유지할 수 있다.

---

## 수정 — protocol/client/UI

```text
src/protocol/v5-types.ts → v6-types.ts
src/protocol/index.ts
src/protocol/validate-message.ts
src/protocol/validate-message.test.ts

src/client/session-client.ts
src/app/adventure-controller.ts
src/dom/session-lobby-ui.ts
src/style.css               // Resume Lobby에 새 layout이 실제 필요할 때만
```

---

# 12. 구현 순서

각 단계는 가능한 한 독립 commit으로 유지한다.

## Step 1 — Save contract와 validator

먼저 DB write 없이 pure/server serializer만 만든다.

- `CampaignSaveV1`
- create/serialize/parse
- hash verification
- schema migration entry point
- ContentIdentity check
- semantic validator

### 완료 조건

```text
현재 active SessionCoreState
→ CampaignSaveV1
→ JSON roundtrip
→ validate
→ 같은 gameplay hash
```

그리고 ephemeral field가 payload에 없음을 테스트한다.

---

## Step 2 — CampaignRepository save API + CAS

- repository 타입 확장
- SQLite loadOwnedSave
- atomic commitSave
- revision CAS
- hasSave/updatedAt 반영

### 완료 조건

```text
campaignRevision 0
→ save commit → 1
→ expected 0 재commit → revision-conflict
→ expected 1 commit → 2
```

타인 owner key로는 read/write 모두 실패한다.

---

## Step 3 — Resume state와 protocol v6

- SessionCoreState v3
- lifecycle `resume-lobby`
- `resume-adventure`
- authorization hard gate
- `createResumedSessionCoreState()`
- protocol v6

### 완료 조건

```text
saved gameplay hash
=== fresh resume-lobby gameplay hash
```

동시에:

```text
old sessionId != fresh sessionId
old playerId가 save에 없음
guestClaims = {}
revision = 0
```

을 확인한다.

---

## Step 4 — SessionHost commit-before-publish

- `SessionDurability` 주입
- accepted Client intent durable commit
- Server AI durable commit
- persistence failure rollback-to-old-authority semantics

### 완료 조건

spy/fake durability로 순서를 검증한다.

```text
reducer candidate
commit
state publish
ACK
snapshot
```

commit이 throw하면:

```text
old state/hash 유지
accepted ACK 없음
candidate snapshot 없음
```

---

## Step 5 — First auto-save

`candidate.adventure !== null`이 되는 `begin-adventure`가 첫 save가 되도록 연결한다.

### 완료 조건

```text
New Campaign → hasSave=false
party 변경 → false
Guest join/claim → false
Begin Adventure commit → true / campaignRevision=1
```

---

## Step 6 — Continue × retire × fresh session

- CampaignService async Continue
- per-campaign serialization
- old SessionHost retire barrier
- retire 후 durable save reload
- fresh SessionStore restore
- ownership/live mapping 갱신

### 완료 조건

```text
browser credential 유실 상황에서 Continue
→ old sessionId invalid
→ fresh sessionId 반환
→ resume-lobby
→ 같은 gameplay hash
```

그리고 old SessionHost의 stale write가 CAS로 거절되는 테스트를 둔다.

---

## Step 7 — Resume Lobby UI

- Continue success 후 Resume Lobby 표시
- saved party fixed
- Guest reclaim
- Host Resume

### 완료 조건

Host solo:

```text
Continue
→ Resume Lobby
→ Resume
→ exact Adventure/Combat continuation
```

2P/3P:

```text
Continue
→ Guest fresh join
→ Character reclaim
→ Resume
→ 기존 control fallback/reconnect 계약 유지
```

---

## Step 8 — real SQLite restart integration

`:memory:`만 쓰면 안 된다.

#38 리뷰에서 이미 확인했듯 `:memory:`에서는 WAL 검증도, process-level persistence 검증도 되지 않는다.

임시 실제 파일을 사용한다.

```text
/tmp/cardguild-m9-3-<random>.sqlite
```

시나리오:

```text
server A open file DB
→ account/campaign 생성
→ Adventure 시작
→ gameplay 진행
→ hash H, campaignRevision R 기록
→ server A close

server B same file DB
→ login
→ GET campaigns: hasSave=true
→ Continue
→ fresh sessionId
→ WebSocket attach
→ resume-lobby hash H
→ Host Resume
→ active hash H
```

실제 file DB에서 `PRAGMA journal_mode`가 `wal`인지도 별도 확인한다.

---

# 13. 필수 테스트 매트릭스

## 13.1 Save projection

| 시나리오 | 기대값 |
|---|---|
| Level/EXP가 있는 Adventure 저장 | 그대로 roundtrip |
| mid-combat 저장 | CombatState 전체 roundtrip |
| partySlots 순서 | slot 순 canonical |
| sessionId/playerId/guestClaims | snapshot JSON에 없음 |
| reconnect token/digest | snapshot JSON에 없음 |
| request journal/presence/control | snapshot JSON에 없음 |
| 저장 전/후 gameplay hash | 동일 |

---

## 13.2 Validator

| 시나리오 | 기대값 |
|---|---|
| malformed JSON | SAVE_CORRUPT |
| hash mismatch | SAVE_CORRUPT |
| saveSchemaVersion 미지원 | SAVE_SCHEMA_UNSUPPORTED |
| ContentIdentity mismatch | SAVE_CONTENT_MISMATCH |
| actorDefinitionId 없음 | reject |
| Creature profile을 PartyMember로 저장 | reject |
| partySlots와 Adventure party 불일치 | reject |
| invalid progression | reject |
| unknown encounter/scenario | reject |
| combat + Adventure phase 불일치 | reject |
| 거절된 save | DB row 변경 없음 |

---

## 13.3 Persistence

| 시나리오 | 기대값 |
|---|---|
| first save | revision 0→1, hasSave true |
| second save | 1→2 |
| stale expected revision | changes 0 / conflict |
| 타인 owner | read/write 불가 |
| 모든 metadata atomic | 같은 generation |
| close/reopen file DB | save 유지 |
| actual file journal mode | WAL |

---

## 13.4 Commit-before-publish

| 시나리오 | 기대값 |
|---|---|
| Client gameplay intent commit 성공 | COMMIT 뒤 ACK/snapshot |
| DB write 실패 | old state 유지, candidate 미전송 |
| control-only Guest claim | DB write 0회 |
| presence attach/detach | DB write 0회 |
| Host Resume lifecycle만 변경 | DB write 0회 |
| Server AI transition | 각 step commit 뒤 broadcast |
| Server AI commit 실패 | candidate 미전송, pump 중단 |

---

## 13.5 Crash semantics

### Crash before commit

```text
old durable state D0
candidate D1 계산
commit 전 crash
restart
→ D0
```

### Commit after / ACK before crash

```text
D1 COMMIT 성공
ACK/broadcast 전 process 종료
restart + Continue
→ D1
```

보상으로 reward/EXP를 다시 적용하지 않는다.

이 테스트는 “host 메모리 state를 어떻게 복구하는가”가 아니라 DB가 authoritative point라는 것을 검증해야 한다.

---

## 13.6 Resume Lobby

| 시나리오 | 기대값 |
|---|---|
| Continue | fresh sessionId/playerId/reconnect |
| saved guest claim | 복구 안 됨 |
| Host solo Resume | 가능 |
| Guest fresh join | 가능 |
| Guest character reclaim | 가능 |
| party composition 변경 | 금지 |
| Resume 전 combat action 직접 전송 | FORBIDDEN |
| Resume 전 loadout/reward/start encounter | FORBIDDEN |
| Resume intent | lifecycle만 active, hash 동일 |

---

## 13.7 Mid-combat exact resume

최소 한 번은 실제 Combat 중간에서 검증한다.

저장 전:

```text
HP
position/facing
turn/round/actionsRemaining
RNG state
sequence
card zones
conditions/effects
pendingReaction
map/object state
commandLog
combat hash
session gameplay hash
```

Continue 후 모두 동일해야 한다.

단 UI playback event history는 intentionally empty여도 된다. state 자체가 authoritative하다.

---

## 13.8 Multi-player regression

M9-3는 Guest identity를 durable하게 만들지 않는다.

따라서 기존 다음 계약을 다시 돌린다.

- anonymous Guest join
- 1P/2P/3P lobby
- Character claim
- disconnected Guest Character의 Host fallback
- reconnect
- control-only transition이 gameplay hash를 바꾸지 않음
- accountId/campaignId가 SessionCoreState/hash에 들어가지 않음

---

# 14. 현재 구조에서 특히 피해야 할 구현

## 14.1 `snapshot_json = JSON.stringify(SessionCoreState)`

금지.

이렇게 하면 live identity와 guest claim까지 durable해져 M9-2에서 만든 ID 경계가 무너진다.

---

## 14.2 ACK 후 비동기 autosave

금지.

```text
state publish
→ ACK
→ 나중에 save
```

는 crash 시 Client가 이미 본 gameplay를 DB가 잃게 만든다.

---

## 14.3 Client localStorage를 backup source로 사용

금지.

M9의 authoritative recovery 목표와 정면 충돌한다.

---

## 14.4 Continue에서 old session을 그냥 둔 채 새 session 생성

금지.

한 Campaign에 writer가 둘 생긴다.

---

## 14.5 `campaignRevision = SessionCoreState.revision`

금지.

Guest join/claim과 Resume lifecycle 같은 non-durable live transition 때문에 즉시 의미가 달라진다.

---

## 14.6 `assertAdventureInvariants()`만 믿고 restore

금지.

현재 invariant는 progression shape 중심이며 Content Pack semantic validity를 보장하지 않는다.

---

## 14.7 Content mismatch save를 자동 overwrite

금지.

지원되지 않는 save는 보존하고 명시적인 mismatch를 반환해야 향후 migration이 가능하다.

---

# 15. 예상 protocol/API 결정표

| 항목 | M9-2 현재 | M9-3 권장 |
|---|---|---|
| AdventureState | v3 | v3 유지 |
| CombatState | v4 | v4 유지 |
| SessionCoreState | v2 | **v3** |
| Wire protocol | v5 | **v6** |
| Save schema | 없음 | **CampaignSaveV1** |
| Campaign DB schema | migration 1에 save column 존재 | 그대로 사용 |
| CampaignRepository | metadata only | save load + CAS commit 추가 |
| New Campaign first save | 없음 | Adventure begin 후 |
| Continue | SAVE_NOT_FOUND | validate → fresh resume-lobby |
| Guest identity | ephemeral | ephemeral 유지 |
| Campaign owner | accountId | accountId 유지 |
| gameplay durable source | 없음 | SQLite Campaign snapshot |

---

# 16. Gate

M9-2가 현재 사용한 required gate를 그대로 유지한다.

```bash
npm run check
npm run build
npm run test:network
npm run test:smoke
```

단 M9-3에서는 `npm run check`가 통과하는 것만으로 충분하지 않다.

특히 다음은 별도 필수다.

```text
실제 file SQLite close/reopen integration
mid-combat Continue
commit-before-publish fault test
Server AI persistence fault test
Resume Lobby authorization test
campaignRevision stale-writer test
```

---

# 17. 권장 commit 단위

구현 commit을 다음 정도로 자르면 리뷰가 쉽다.

```text
1. feat(save): define CampaignSaveV1 and restore validation
2. feat(persistence): add campaign snapshot CAS repository
3. feat(session): add resume-lobby and protocol v6
4. feat(server): commit gameplay before session publish
5. feat(server): persist server authority transitions
6. feat(campaign): rehydrate Continue into fresh live session
7. fix(campaign): retire previous live writer before Continue
8. feat(ui): add Resume Lobby flow
9. test(persistence): add real-file restart and mid-combat recovery
10. docs(m9): document durable save and crash contract
```

큰 commit 하나로 묶는 것보다 특히 **repository CAS**, **commit-before-publish**, **Continue rehydration**을 분리해야 regression 원인을 찾기 쉽다.

---

# 18. M9-3 Exit를 코드 수준으로 다시 정의

M9-3 완료 판정은 UI에 Continue 버튼이 생겼는지가 아니다.

다음 테스트가 통과해야 한다.

```text
1. Host login
2. New Campaign 생성
3. party 준비
4. Adventure 시작
5. Combat 중간까지 gameplay 진행
6. hash H 기록
7. file DB COMMIT 확인
8. browser/live credential을 버림
9. Continue
10. 새 sessionId 발급 확인
11. resume-lobby 진입
12. saved party 고정, guestClaims empty 확인
13. resume-lobby에서 gameplay intent가 막히는지 확인
14. Host Resume
15. Adventure/Combat gameplay hash == H
16. 다음 gameplay intent 성공
17. campaignRevision 증가
18. server close/reopen 후 다시 Continue
19. 마지막 committed hash로 복구
```

그리고 전 과정에서:

```text
accountId/campaignId는 gameplay state/hash 밖에 존재
Guest identity/reconnect는 durable save 밖에 존재
Client storage는 gameplay source가 아님
```

이어야 한다.

이 상태가 되어야 M9-4의 EXP 지급과 M9-5의 restart/recovery hardening을 안전하게 그 위에 올릴 수 있다.

---

# 19. 최종 권장 범위

## M9-3에 반드시 포함

- `CampaignSaveV1`
- save schema version/runtime validator
- ContentIdentity compatibility check
- migration entry point
- snapshot hash verification
- CampaignRepository save load/write 계약
- `campaignRevision` CAS
- Adventure begin 이후 autosave
- Client intent commit-before-publish
- Server AI commit-before-publish
- control/presence-only save skip
- fresh Resume Lobby rehydration
- Guest Claims reset / fresh live credential
- Resume Lobby gameplay authorization lock
- existing live Campaign writer retire/replacement
- mid-combat Continue
- real file SQLite close/reopen test
- client gameplay durable storage 금지 회귀
- protocol v6 명시적 증가

## M9-3에서 하지 않음

- EXP 실제 지급/Level-Up transition — M9-4
- 계정 생성 HTTP/public signup
- Guest account
- DB를 gameplay reducer 안으로 이동
- event sourcing
- replay log를 Save source로 승격
- browser local save
- arbitrary old save 자동 보정
- content mismatch 자동 overwrite
- multi-node/distributed database coordination

---

# 20. 분석 기준 소스

- Parent M9: https://github.com/darkbard81/CardGuild/issues/36
- M9-1: https://github.com/darkbard81/CardGuild/issues/37
- M9-2: https://github.com/darkbard81/CardGuild/issues/38
- 기준 branch: `M9-Persistence`
- 기준 commit: `ad6089e891fb88c627b4a7fbea7820a085a604d4`

주요 현재 파일:

```text
src/adventure/types.ts
src/adventure/progression.ts
src/adventure/runtime.ts
src/session/types.ts
src/session/authority.ts
src/session/authorization.ts
src/session/session-hash.ts
src/server/session-host.ts
src/server/session-store.ts
src/server/campaign-service.ts
src/server/http-api.ts
src/server/server.ts
src/server/persistence/types.ts
src/server/persistence/sqlite-persistence.ts
src/server/persistence/migrations.ts
src/client/session-client.ts
src/app/adventure-controller.ts
package.json
```

