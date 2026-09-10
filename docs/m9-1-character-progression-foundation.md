# M9-1 — Character Progression Foundation

[Parent issue #36](https://github.com/darkbard81/CardGuild/issues/36)의 M9-1 구현 계약과 검증 기록이다.
기준 브랜치는 `M9-Persistence`, 구현 전 기준 커밋은 `4fc5f92`이다.

## 1. 목표와 범위

PartyMember가 콘텐츠와 독립적인 runtime Level/EXP를 소유하고, 다음 Encounter와 Loadout
미리보기가 같은 effective Character profile로 수치를 계산한다. 이미 생성된 CombatState와
compiled content는 progression 때문에 변경하지 않는다.

완료 기준은 **초기화된 PartyMember에 테스트용 Level 2를 주입하면 다음 전투의
HP/AC/Save/Skill/Perception/Strike/Class DC와 Loadout preview가 Level 2를 사용하고,
기존 active/completed Combat의 state/hash/replay는 유지되는 것**이다.

포함:

- 필수 PartyMember progression, authored starting Level 초기화, invariant 검사
- AdventureState v3와 protocol v5, gameplay hash/JSON/reconnect 회귀
- 전투 생성과 Loadout 전체 preview 경로의 effective profile 연결
- Adventure 파티 요약과 Loadout 선택 캐릭터의 최소 Level/EXP 텍스트

후속 범위:

- **M9-4:** 승리 EXP 지급, 1000 EXP threshold/carry 계산, 실제 Level-Up transition,
  EXP bar 및 Level-Up feedback. `accept-combat-result`의 승리 확정 안에서 적용한다.
- **M9-2 이후:** Account/Auth/SQLite/Campaign Save/Continue/restart recovery.
- Attribute Boost, proficiency rank/Feat/Class feature 선택은 M9 전체 범위 밖이다.

M9-1에는 progression 변경 command, debug API 또는 client-side gameplay save가 없다.

## 2. 상태·초기화·검증

`src/adventure/types.ts`:

```ts
interface CharacterProgressionState {
  readonly level: number;
  readonly experience: number; // 현재 Level에서 다음 Level까지의 EXP
}
```

`PartyMemberState.progression`은 필수다. `AdventureState.version`은 2에서 **3**으로 변경한다.
초기화 전 `PartyMemberSetup = Omit<PartyMemberState, "progression">`과 `PartySetup`을
runtime PartyState와 분리하여, caller가 dummy progression을 채울 필요가 없게 한다.

`createAdventureSession(context, party: PartySetup, seed)`는 다음을 수행한다.

1. ActorDefinition을 조회하고 Character profile인지 확인한다.
2. 기존 정책대로 starter Loadout과 Collection을 생성한다.
3. 각 member마다 authored `statProfile.stats.level`과 EXP 0으로 새 progression 객체를 만든다.
4. 결과 Adventure invariant를 확인한다.

새 Adventure에서는 caller의 추가 runtime 필드가 초기값을 덮어쓰지 못한다. 콘텐츠에 Level 3이
명시되어 있으면 Level 3으로 시작한다. runtime을 복구하기 위한 함수가 아니므로 향후 Continue는
이 함수를 다시 호출해 진행 상황을 초기화해서는 안 된다.

`src/adventure/progression.ts`의 공개 함수와 상수:

| 인터페이스 | 책임 |
|---|---|
| `EXPERIENCE_PER_LEVEL = 1000` | invariant와 표시가 공유하는 다음 Level EXP 기준 |
| `assertCharacterProgression(value)` | Level/EXP의 runtime 검증 |
| `createCharacterProgression(actor)` | authored starting Level과 EXP 0 생성 |
| `resolveEffectiveCharacterStatProfile(actor, progression)` | Character profile 복제와 Level overlay |
| `assertAdventureInvariants(state)` | Adventure v3 및 모든 member의 progression 확인 |

Level은 1 이상 정수, EXP는 0 이상 1000 미만 정수여야 한다. 누락·소수·NaN·Infinity는
거절한다. Level 상한, clamp, 누락 필드의 자동 기본값은 도입하지 않는다.

검사는 Adventure 생성 결과, command 진입, encounter 생성 및 Session invariant에서 실행한다.
잘못된 내부 상태는 예외로 드러내며 v2를 조용히 v3로 보정하지 않는다. 이는 전체 unknown Save를
검증하는 decoder가 아니다. Save validator와 명시적 migration entry point는 M9-3의 책임이다.

`SessionHost` constructor도 같은 경계에 포함한다. `attach()`는 받은 state를 gameplay commit
없이 곧바로 snapshot으로 전송하므로, commit 시점의 `assertSessionInvariants()`만으로는
constructor seam으로 들어온 state를 막지 못한다. progression이 wire snapshot의 필수 계약이 된
이상 constructor에서 먼저 검증하여, SessionHost가 invalid gameplay state를 한 번도 publish하지
못하게 한다. M9-3의 Campaign rehydration이 이 seam을 그대로 사용한다.

## 3. Effective profile과 전투 수명

```text
ActorDefinition.statProfile + PartyMember.progression.level
  → resolveEffectiveCharacterStatProfile()
  → deriveActorSetup() / deriveLoadoutSnapshot() / previewLoadoutChange()
  → 기존 statistics / offense resolver
```

Effective resolver는 `cloneActorStatProfile()`로 nested Character profile을 복제한 뒤
`stats.level`만 교체한다. Character Attribute, proficiency rank, 장비, class feature는 그대로다.
Creature에 Character progression을 적용하려 하면 거절한다.

Loadout의 다음 공개 함수는 마지막 선택 인자 `effectiveStatProfile?: ActorStatProfile`을 받는다.

- `deriveActorSetup(actor, placement, loadout, content, memberId?, effectiveStatProfile?)`
- `deriveLoadoutSnapshot(actor, loadout, content, memberId, effectiveStatProfile?)`
- `previewLoadoutChange(party, collection, content, memberId, candidate, effectiveStatProfile?)`

인자가 없으면 authored profile을 사용한다. Loadout 모듈은 Adventure 타입을 import하지 않는다.
Adventure와 DOM caller가 effective profile을 전달한다.

`buildAdventureEncounter()`의 party actor 경로는 runtime progression을 반드시 전달한다.
Static placement, Creature와 Lobby starter 소개는 기존 authored 경로를 사용한다.
`deriveActorSetup()`은 동일한 profile로 Max HP를 계산하고 ActorSetup.statProfile을 복제한다.
새 Encounter의 HP는 기존 정책대로 `hp = maxHp`이다.

Loadout은 기본 요약, 덱·능력치 탭, 상세 tooltip, 장비/Prepared Cards 변경 전후 preview에 모두
같은 effective profile을 전달한다. 최종 AC/HP/Strike modifier를 Adventure에 중복 저장하지 않는다.

전투 경계:

- 이미 생성된 CombatState는 그 전투의 profile로 끝까지 진행한다.
- Adventure progression을 변경해도 기존 Combat의 profile/hp/maxHp/state/hash를 다시 계산하지 않는다.
- M9-1의 승리·패배·보상·Loadout 전이는 Level/EXP를 보존한다. EXP/Level event도 발생하지 않는다.
- 현재 `finalizeCombat()`은 결과 확정 후 Session의 `combat`을 null로 정리한다. 과거 Combat
  snapshot이나 replay 저장 기능을 이번에 추가하지 않는다.
- 완료된 전투 불변성은 테스트가 보관한 실제 승리 전투와 그 replay를 비교해 검증한다.
- M9-4가 승리 Adventure transition에서 Level을 변경하면 갱신 직후의 derived view와 다음
  Encounter가 이를 사용한다. 과거 Combat을 새 Level로 재해석하지 않는다.

현재 production starter 장비의 회귀 수치:

| 캐릭터 | Max HP: Lv.1 → 2 | AC | Strike modifier | Class DC |
|---|---:|---:|---:|---:|
| Aerin | 21 → 34 | 18 → 19 | 8 → 9 | 16 → 17 |
| Brom | 26 → 42 | 20 → 21 | 6 → 7 | 16 → 17 |
| Lyra | 17 → 26 | 18 → 19 | 7 → 8 | 17 → 18 |
| Nera | 18 → 28 | 16 → 17 | 5 → 6 | 19 → 20 |

모든 수치에 무조건 +1을 적용하지 않는다. 예를 들어 Nera의 untrained Athletics는 0으로
유지된다. HP는 기존 `ancestryHp + level * (classHpPerLevel + CON)` 공식으로 계산한다.

## 4. Snapshot·호환성·표시

| 계약 | M9-1 |
|---|---|
| AdventureState | v3: PartyMember.progression 필수 |
| SessionCoreState | v2 유지: lifecycle/control 구조 동일, 내부 Adventure는 자체 version 검사 |
| Wire protocol | v5: `src/protocol/v5-types.ts`, 구버전/미지원 버전 거절 |
| Content schema / pack | v8 / cardguild.m7@0.3.0 유지 |
| Content fingerprint | fnv1a64:887ee163d92faa57 유지 |
| Combat replay | 형식과 기존 Level 1 결정론 계약 유지 |
| Durable Save | 이번 단계에 없음 |

서버는 hello/intent의 구버전을 `PROTOCOL_MISMATCH`로 거절한다. 클라이언트도 수신 version을
먼저 확인하여 불일치 snapshot/ACK/error를 적용하지 않고 연결을 종료한다. 재시도를 중단하고
기존 terminal handshake 경로로 credential을 정리한다. 서버와 클라이언트를 함께 배포해야 한다.

Gameplay hash는 기존 전체 Adventure projection을 그대로 사용하므로 Level과 EXP를 포함한다.
Adventure version/필드 추가로 Session hash는 변경된다. EXP만 바뀌면 기존 Combat hash는
변하지 않으며, 새 Level로 생성한 다음 Combat의 setup fingerprint는 달라진다.
Guest claim/presence/control metadata의 gameplay hash 제외 계약은 유지한다.

사용자가 선택한 최소 표시 범위:

- Adventure: encounter 목록과 Collection 사이에 seat 순서로 캐릭터명과
  `Lv. N · EXP X / 1000`을 표시한다. 전투 외 모든 phase에서 보인다.
- Loadout: 선택한 캐릭터 정보에 같은 텍스트를 표시한다. 읽기 전용 캐릭터도 조회할 수 있다.
- 캐릭터 전환과 snapshot 갱신에 맞춰 재렌더링한다. 별도 client progression state는 없다.
- 기존 테마의 DOM/CSS를 사용하며 전투 HUD와 새 asset은 추가하지 않는다.
- 1024×768에서 주요 버튼과 pagination이 보이며 좁은 화면에서는 텍스트를 줄바꿈한다.
- 파티 요약이 늘어난 만큼 최소 지원 높이에서는 바깥 여백을 먼저 줄인다. `@media (min-width: 901px) and (max-height: 800px)`가
  `.adventure-screen`과 `.adventure-map-card`의 padding만 줄여, 8개 encounter·3명 progression·Collection을
  정보 숨김 없이 한 화면에 유지한다.

## 5. 검증과 완료 조건

| 증거 | 확인할 내용 |
|---|---|
| `src/adventure/progression.test.ts` | authored 초기 Level, invalid 상태 거절, 4종 Level 2 수치, 모든 Save/Skill/Perception, preview 전후, Creature 경로, 실제 승리 전투 replay 불변성, 다음 Encounter full HP, EXP 미지급 |
| `src/session/session.test.ts` | Level/EXP hash 반영, JSON 왕복, Combat hash 보존, Session의 Adventure invariant 위임, 기존 control 회귀 |
| `src/protocol/validate-message.test.ts` | v5 수용, v4 포함 미지원 버전 거절, 기존 Facing 계약 |
| `src/client/session-client.test.ts` | v4 snapshot/ACK/error 수신 시 미적용·연결 종료·재시도 중단 |
| `tests/integration/coop.test.ts` | 실제 WebSocket에서 nonzero Level/EXP 전송, Level 2 전투 생성, disconnect/reconnect 후 동일 state/hash, `SessionHost` constructor의 invalid state 거절, 기존 1P/2P/3P 회귀 |
| `tests/unit/browser/progression.spec.ts` | 실제 Host 시작/reload, 양쪽 표시, Level 2/EXP 375 fixture, preview 수치, 캐릭터 전환, 읽기 전용, 재렌더링, desktop/mobile screenshot |

테스트의 runtime Level/EXP 주입은 생성된 상태의 불변 교체 또는 기존 SessionHost constructor
경계를 사용한다. 제품용 임의 progression 변경 기능을 추가하지 않는다.

필수 완료 gate:

```bash
npm run check
npm run build
npm run test:network
npm run test:smoke
```

구현 전 baseline은 관련 단위 테스트 6개 파일·80개 통과였다.

## 6. 구현 결과

`M9-Persistence` 브랜치의 `4fc5f92` 위에서 구현을 마쳤다. 커밋/푸시는 별도 요청 범위다.

### 변경한 파일

| 영역 | 파일 |
|---|---|
| progression 코어 | `src/adventure/progression.ts`(신규), `src/adventure/progression.test.ts`(신규) |
| Adventure 상태 | `src/adventure/types.ts`, `runtime.ts`, `combat-bridge.ts`, `index.ts`, `adventure.test.ts` |
| 파생 계산 | `src/loadout/loadout.ts` |
| protocol | `src/protocol/v4-types.ts` → `v5-types.ts`, `index.ts`, `validate-message.ts`, `validate-message.test.ts` |
| session·client | `src/session/authority.ts`, `session.test.ts`, `src/client/session-client.ts`, `session-client.test.ts` |
| 표시 | `index.html`, `src/dom/adventure-ui.ts`, `src/dom/loadout-ui.ts`, `src/style.css` |
| 테스트·도구 | `tests/unit/browser/progression.spec.ts`(신규), `tests/integration/coop.test.ts`, `tests/integration/adventure-progression.test.ts`, `src/content/*.test.ts`, `tools/content/check-production-content.ts`, `tools/playtest/run-playtest.ts` |
| 문서 | `README.md`, 이 문서 |

`PartySetup` 도입으로 Adventure를 생성하는 모든 호출부(테스트·playtest·production check)가 progression
없는 입력을 그대로 사용하며, runtime progression은 `createAdventureSession()`만 만든다.

### Gate 결과

2026-09-09 기준 Node v24.18.1에서 네 gate가 모두 통과했다.

| Gate | 결과 |
|---|---|
| `npm run check` | 통과 — content/production/assets check, typecheck 4종, lint, unit 38개 파일·469개 테스트 |
| `npm run build` | 통과 — client bundle과 `dist-server/main.js` 생성, 기존 chunk size 경고만 유지 |
| `npm run test:network` | 통과 — 2개 파일·11개 테스트 (`coop` 10개, 전체 Adventure 완주 1개) |
| `npm run test:smoke` | 통과 — Playwright 45개 테스트 |

브라우저 검증은 `tests/unit/browser/progression.spec.ts` 2개 테스트가 smoke gate 안에서 함께 돈다.
실제 Host 시작 경로의 초기 표시, Level 2/EXP 375 fixture, 양쪽 화면의 수치와 preview,
캐릭터 전환·읽기 전용 조회를 확인하고 1024×768 Adventure/Loadout/runtime Level screenshot 3장과
390×844 mobile screenshot 1장을 남긴다. 1024×768에서는 마지막 encounter 항목과 Collection이
viewport 안에 들어오고 `.adventure-map-card`가 잘리지 않는 것을 단언으로 고정했다.

### 리뷰 반영

`121ef7a` 리뷰에서 `SessionHost` constructor의 invariant 경계 1건을 지적받아 후속 커밋에서 닫았다.
constructor가 `assertSessionInvariants()`를 먼저 호출하고, `tests/integration/coop.test.ts`가
valid Level 2/EXP 375 복원 성공과 EXP 1000·progression 누락·Adventure v2 거절, 그리고 거절된 state가
`attach()` snapshot에 도달하지 않음을 함께 고정한다. 이 테스트는 수정 전 코드에서 실패한다.

`assertAdventureInvariants()`는 content context가 없어 `actorDefinitionId`가 실제 Character profile인지
검증하지 않는다. 새 Adventure 생성과 encounter build가 각각 막으므로 M9-1 범위에서는 문제가 없지만,
M9-3의 Save restore validator에는 `PartyMember.actorDefinitionId → Character profile` semantic
검증을 포함해야 한다.

### 남은 작업

EXP 지급·threshold/carry·Level-Up transition과 EXP bar는 M9-4, Account/Save/Continue/복구는
M9-2 이후에서 이어간다. 이 문서의 2~4절 계약이 그 작업의 입력이다.
