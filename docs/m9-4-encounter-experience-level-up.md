# M9-4 — Encounter EXP & Automatic Level-Up

[Parent issue #36](https://github.com/darkbard81/CardGuild/issues/36)의 M9-4 구현 계약과 검증
기록이다. 기준 브랜치는 `M9-Persistence`, 구현 전 기준 커밋은 M9-3을 끝낸 `3c203b9`이며,
계획은 [issue #40](https://github.com/darkbard81/CardGuild/issues/40)이다.

## 1. 목표와 범위

**Encounter 승리 → EXP 지급 → 자동 Level-Up → 저장 → 다음 전투 반영**을 완성한다.
M9-1이 만든 runtime Level/EXP는 이번 마일스톤 전까지 값이 바뀌지 않는 필드였다. M9-4에서
그 값을 움직이는 유일한 사건이 생긴다: **승리로 확정된 Encounter 결과**.

포함:

- Encounter별 EXP authoring(content schema v9, production pack `cardguild.m7@0.4.0`)
- 순수 성장 계산 `applyExperience()`와 승리 확정 전이의 EXP 지급
- `EXPERIENCE_GAINED` / `LEVEL_UP` 이벤트와 wire protocol v7
- 직전 콘텐츠 버전 Campaign Save의 명시적 이관과 Continue의 migration COMMIT 경계
- Adventure·Loadout의 EXP 표시와 승리 직후 성장 요약

후속 범위:

- **M9-5:** 서버 재시작 복구 강화와 멱등성

## 2. 확정한 제품 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| EXP 정의 위치 | Encounter별 `experienceAwards`, `rewards`와 분리 | 보상이 없는 전투와 최종 전투도 EXP를 준다. 보상에 얹으면 "보상 없는 전투는 아무것도 안 주는 전투"가 된다 |
| 누락 처리 | 자동 0 보정 없이 거절 | 0으로 보정하면 authoring 실수와 "의도적으로 0"이 구분되지 않는다 |
| 지급 대상 | 현재 Party 전원, 동일 금액 | 쓰러진 member, 미접속 Guest, claim 없는 캐릭터를 나누면 접속 상태가 gameplay 사실이 된다 |
| 지급 시점 | `accept-combat-result`의 승리 분기 하나 | EXP 전용 명령이나 저장 단계를 만들면 M9-3의 단일 candidate 규칙이 깨진다 |
| Level 계산 | `floor(total / 1000)`, 잔여는 `total % 1000` | 한 번에 여러 Level을 넘는 지급도 같은 식 하나로 처리된다 |
| 완료 Encounter 재수용 | 거절 | 같은 결과의 재전송이 EXP를 두 번 주는 유일한 경로다 |
| 진행 중 Combat | 레벨업이 profile·HP·hash를 건드리지 않음 | 살아 있는 전투를 다시 계산하면 replay 재현성이 깨진다 |
| 성장 반영 시점 | 다음 `buildAdventureEncounter()`부터 | 다음 전투는 새 Max HP로 full HP 시작 |
| 직전 저장 이관 | 등록된 identity 한 쌍만 명시적으로 | "더 오래된 것은 전부"는 규칙이 아니라 추측이다 |
| 소급 EXP | 없음 | 이관 시점에 이미 완료한 전투에는 지급하지 않는다 |
| 성장 요약 저장 | 저장하지 않음 (메모리 전용) | 요약은 "방금 무엇이 바뀌었는지"이고, 그것은 COMMIT과 함께 공개된 이벤트에만 존재한다 |

## 3. 콘텐츠 계약

### Encounter별 EXP authoring

```ts
interface AdventureExperienceAward {
  readonly afterEncounterId: ScenarioId;
  readonly amount: number;
}

interface AdventureDefinition {
  // 기존 필드 유지
  readonly experienceAwards: readonly AdventureExperienceAward[];
}
```

- `encounterIds` 각 항목에 정확히 하나. 누락은 `MISSING_ENCOUNTER_EXPERIENCE`.
- 중복은 `DUPLICATE_ENCOUNTER_EXPERIENCE`, Adventure 밖 참조는 `EXPERIENCE_OUTSIDE_ADVENTURE`.
- 음수·소수·비정상 수치는 `INVALID_EXPERIENCE_AMOUNT`. 구조 스키마가 필드 자체의 부재를 먼저 거절한다.
- fingerprint는 `afterEncounterId` 정렬 후 계산한다. 선언 순서만 바꾸면 fingerprint는 같고,
  지급량이 바뀌면 달라진다.
- M3/M6 회귀 fixture는 Encounter별 **명시적 0**을 넣어 기존 "성장 없음" 의미를 유지한다.
- production gate(`npm run content:production-check`)는 8개 Encounter 전부 양수 EXP인지,
  그리고 새 Party가 4전·7전 승리에서 각각 Lv.2·Lv.3인지 검사한다.

### 생산 Adventure EXP 테이블

| 순서 | Encounter | 지급 EXP | 승리 후 Level / EXP |
|---|---|---:|---|
| 1 | `encounter.road-ambush` | 200 | Lv.1 / 200 |
| 2 | `encounter.spear-line` | 250 | Lv.1 / 450 |
| 3 | `encounter.ruined-gate` | 250 | Lv.1 / 700 |
| 4 | `encounter.goblin-chief` | 400 | **Lv.2 / 100** |
| 5 | `encounter.bone-cellar` | 250 | Lv.2 / 350 |
| 6 | `encounter.wolf-run` | 300 | Lv.2 / 650 |
| 7 | `encounter.archer-perch` | 350 | **Lv.3 / 0** |
| 8 | `encounter.cult-sanctum` | 500 | Lv.3 / 500 |

구현은 전투 횟수를 세지 않는다. 각 전투의 지급량과 1000 EXP threshold만 쓴다.

### 버전 변경

| 계약 | M9-3 | M9-4 |
|---|---|---|
| Content schema | v8 | **v9** |
| Production pack | `cardguild.m7@0.3.0` `fnv1a64:887ee163d92faa57` | **`cardguild.m7@0.4.0` `fnv1a64:8795c80164042fbf`** |
| M3 fixture pack | `cardguild.m4@0.6.0` | `cardguild.m4@0.6.1` `fnv1a64:26f357ebff19b85c` |
| M6 fixture pack | `cardguild.m6@0.9.0` | `cardguild.m6@0.9.1` `fnv1a64:0824a8be8a08630b` |
| Wire protocol | v6 | **v7** |
| Adventure / Session / Combat state | v3 / v3 / v4 | 유지 |
| Campaign Save / DB schema | v1 | 유지 |

## 4. 성장 계산과 승리 확정

```ts
applyExperience(
  progression: CharacterProgressionState,
  amount: number,
): { readonly progression: CharacterProgressionState; readonly levelsGained: number };
```

`total = experience + amount`, `levelsGained = floor(total / 1000)`, 잔여는 `total % 1000`.
입력 객체를 바꾸지 않고, 안전하게 표현할 수 없는 산술 결과는 거절한다.

`accept-combat-result`의 승리 분기:

1. phase·Encounter·seed 검사, **이미 완료된 Encounter는 거절**
2. 해당 Encounter의 authored EXP 조회 (없으면 content 오류로 throw)
3. PartyMember를 seat 순서로 순회하여 같은 EXP를 각각 지급
4. 완료 Encounter·Party progression·다음 phase를 하나의 결과 상태로
5. `assertAdventureInvariants()` 후 이벤트 반환

패배와 보상 선택은 EXP를 지급하지 않는다. 명시적 0 EXP는 성장 이벤트를 만들지 않는다.

### 이벤트 순서

```text
기존 전투 종료 이벤트
→ ENCOUNTER_COMPLETED
→ EXPERIENCE_GAINED: member seat 순서
→ LEVEL_UP: member seat 순서, 각 Level 증가마다 하나
→ REWARD_OFFERED 또는 ADVENTURE_COMPLETED
```

| 이벤트 | 필드 |
|---|---|
| `EXPERIENCE_GAINED` | `encounterId`, `memberId`, `amount`, `previous`, `next` |
| `LEVEL_UP` | `encounterId`, `memberId`, `previousLevel`, `level` |

`finalizeCombat()`이 만드는 **마지막 전투 명령과 Adventure 확정의 단일 candidate**는 그대로다.
EXP 전용 명령도, 별도 저장 단계도 없다. M9-3의 공통 경로가 이 candidate를 COMMIT한 뒤에야
ACK와 이벤트가 공개된다. 그래서 클라이언트가 본 성장은 항상 DB가 이미 가진 성장이다.

레벨업은 기존 Combat 객체의 profile·HP·수치·hash를 수정하지 않는다. 완료된 전투는 현재처럼
`combat: null`로 정리되고, 갱신된 progression은 Loadout 파생 수치와 다음
`buildAdventureEncounter()`부터 쓰인다.

## 5. 직전 Campaign Save의 명시적 이관

### 등록된 이관 한 쌍

```text
cardguild.m7@0.3.0  fnv1a64:887ee163d92faa57
      ↓
cardguild.m7@0.4.0  fnv1a64:8795c80164042fbf
```

`EXPERIENCE_AUTHORING_MIGRATION.verify()`는 **현재 pack**에서 `experienceAwards`만 제거하고
이전 manifest를 적용했을 때 원본 fingerprint가 나오는지 확인한다. 나오지 않으면 pack이 EXP
authoring 외의 것도 바뀐 것이므로 이관은 성립하지 않고, save는 기존 오류 정책으로 거절된다.
즉 이번 이관은 **EXP authoring 추가에 한정**되며 전투 콘텐츠 변경을 조용히 통과시키지 않는다.

### 원본 검증과 변환 결과 검증의 분리

```ts
interface CampaignRestoreResult {
  readonly projection: SessionGameplayProjection;
  readonly migration: { readonly save: CampaignSaveV1; readonly snapshotHash: string } | null;
}
```

1. JSON shape, metadata/payload identity 일치, save schema 검증
2. 저장된 Combat identity가 save identity와 일치하는지 검사 (불일치는 `SAVE_CORRUPT`)
3. **현재 identity**면 기존 의미 검증 → Session invariant → 저장 hash 대조 → `migration: null`
4. **등록된 원본 identity**면 원본 hash를 먼저 대조한 뒤 복제본을 변환하고, 목표 콘텐츠로
   의미 검증과 Session invariant를 적용해 새 hash를 낸다
5. 함수 자체는 DB에 쓰지 않는다

hash 대조 순서가 두 분기에서 다른 이유는 하나다. 이관된 projection은 더 이상 저장 hash로
해싱되지 않으므로, 변환 뒤에 저장 hash를 확인하면 **잘못된 대상**을 확인하게 된다. 반대로
현재 identity 분기에서 hash를 먼저 보면, 손상된 save가 전부 "hash 불일치"로만 보고되어
무엇이 실제로 잘못됐는지 사라진다.

이관은 Party·Level/EXP·완료 목록·Collection·Loadout·pending reward를 그대로 유지한다.
바뀌는 것은 content identity와 그 identity를 포함하는 `setupFingerprint` 둘뿐이다.

진행 중 Combat은 저장된 actor·HP·turn·RNG·effects·reaction·commandLog를 보존한다.
`migrateCombatSetupFingerprint()`는 저장된 Party·Loadout·Level로 Encounter 정의를 다시
구성해 **원본** setup fingerprint를 먼저 재현하고, 일치할 때만 같은 정의를 목표 identity로
다시 fingerprint한다. 이 정의는 검증과 fingerprint 계산에만 쓰이며 저장된 전투를 새로
생성하거나 replay로 대체하지 않는다.

### Continue와 COMMIT 순서

```text
소유권 확인
→ 원본 검증 및 이관 사전 계산 (DB write 없음)
→ 기존 writer 종료 (queue barrier)
→ 최신 save 재조회·재검증·이관 계산
→ 필요한 경우 migration CAS COMMIT
→ 새 revision으로 durability 구성
→ 새 Resume Lobby 등록
→ 성공 응답
```

- 이관 저장은 기존 `commitSave()`로 payload·identity·hash·revision을 한 번에 갱신한다.
- 성공한 이관만 `campaignRevision`을 1 증가시킨다. 이후 Continue와 Resume은 추가 저장을 만들지 않는다.
- 저장 실패나 CAS 충돌이면 새 세션을 공개하지 않고 `PERSISTENCE_FAILED`를 반환하며, row는 보존된다.
- 손상·미지원 원본의 사전 검증 실패는 기존 live session과 DB row를 그대로 둔다.

## 6. 성장 표시

`src/dom/progression-view.ts`가 Level/EXP 표시의 유일한 출처다. Adventure의 각 PartyMember와
Loadout의 선택 캐릭터가 같은 함수를 쓰므로 두 화면의 문구가 갈라질 수 없다.

- `Lv. N · EXP X / 1000` 텍스트와 작은 progress bar. bar는 `role="progressbar"`로 캐릭터명·
  현재 EXP·다음 Level 비용을 접근 가능한 이름과 값으로 제공한다.
- 승리 요약은 보상 선택·다음 전투·Adventure 완료 화면에 `EXP +400`, `Lv.1 → Lv.2`, 현재 잔여
  EXP로 표시된다. 여러 Level을 얻으면 시작→최종 Level 하나로 묶는다. 별도 확인 버튼은 없다.
- Host와 Guest 모두 Party 성장 결과를 본다.

요약의 수명은 `trackGrowthSummary()` 순수 함수 하나가 정한다.

| 사건 | 결과 |
|---|---|
| 성장을 담은 COMMIT snapshot | 새 요약 |
| 성장이 없는 이후 snapshot (보상 선택, Loadout 왕복) | 기존 요약 유지 |
| 같은/이전 revision 재수신 (resync, control-only, 재렌더) | 기존 요약 유지, 재알림 없음 |
| 다음 Encounter 진입 (`combat` 존재) | 비움 |
| 다른 session ID | 비움 |
| 브라우저 재로드·새 Continue | 이벤트가 재생되지 않으므로 요약 없음 |

요약과 이벤트 이력은 Campaign Save에도 browser storage에도 저장하지 않는다.

## 7. 검증 결과

기준 커밋 `3c203b9`에 대해 아래를 모두 수행했다.

```bash
npm run check        # content + production + assets + 4x typecheck + lint + 583 unit tests
npm run build        # client + server
npm run test:network # 28 integration tests over real WebSocket/HTTP
npm run test:smoke   # 55 Playwright tests
npm run playtest -- --seeds 3
```

전부 통과했다. 단위 테스트는 M9-3 시점 559개에서 583개로 늘었다.

### 영역별 확인

| 영역 | 확인한 것 | 위치 |
|---|---|---|
| 콘텐츠 | EXP 누락·중복·외부 참조·음수/소수/비정상 수치 거절, 필드 부재의 구조 거절, 명시적 0 허용, 배열 재정렬의 fingerprint 불변, 지급량 변경의 fingerprint 변화 | `src/content/content.test.ts` |
| 성장 계산 | 999+1, 정확한 threshold, carry, 5 Level 동시 상승, 0 EXP, 입력 불변성, 표현 불가 총합 거절 | `src/adventure/experience.test.ts` |
| Adventure | seat 순서 지급, 이벤트 순서, 4전·7전 Level 확정, 다중 Level-Up 이벤트, 쓰러진 member 지급, 패배·보상 선택 무지급, 서로 다른 초기 progression, 중복 결과 거절, 다음 전투 Max HP | `src/adventure/experience.test.ts`, `src/adventure/progression.test.ts` |
| 전투 경계 | 레벨업 전 완료 Combat/hash/replay 보존, 다음 Encounter의 Level·Max HP·AC·Save·Skill·Perception·Strike·Class DC 일관성 | `src/adventure/progression.test.ts` |
| 멀티플레이 | Guest claim + 중도 이탈이 있는 세션과 Host 단독 세션의 지급 결과 동일 | `src/server/session-host.test.ts` |
| 저장 경계 | 승리 candidate COMMIT 실패 시 성장 이벤트·ACK 미공개, 상태 유지, 같은 요청 재시도 후 정확히 한 번 지급 | `src/server/session-host.test.ts` |
| 콘텐츠 이관 | mid-combat·between-encounters 이관, 진행·Level/EXP·Collection·pending reward·commandLog 보존, 소급 EXP 없음, setupFingerprint 재계산, 새 hash 일치 | `src/server/campaign-save.test.ts` |
| 이관 실패·경쟁 | 원본 hash 불일치 거절, setup 불일치 거절, save/battle identity 불일치 거절, 미등록 pack 거절과 row 보존, CAS 실패 시 미공개·row 보존·재시도 가능, 반복 Continue에서 재이관 없음 | `src/server/campaign-save.test.ts`, `src/server/campaign-service.test.ts` |
| Wire | 실제 WebSocket에서 8전 전부의 EXP 수신, 두 Level-Up 지점, 최종 progression | `tests/network/adventure-progression.integration.test.ts` |
| 브라우저 | 보상·다음 전투·완료 화면의 요약, 다중 Level 묶음 표시, 요약 없는 재렌더, progressbar aria 값, Loadout 왕복, 1440×900·1024×768·390px 도달성과 가로 스크롤 없음 | `tests/progression.browser.spec.ts` |
| 요약 수명 | 보상 선택·Loadout 유지, 같은/이전 revision 재수신 무변화, 다음 전투·다른 세션 비움, 재로드 시 없음 | `src/dom/progression-view.test.ts` |

### Playtest 비교 (36 조합 × seed 1~3 = 108 runs)

같은 조합·같은 seed로 변경 전후를 실행했다.

| | 완주 | 실패 |
|---|---:|---:|
| 변경 전 (`3c203b9`) | 35 | 73 |
| 변경 후 | **56** | 52 |

- **회귀 0건.** 변경 전 완주하던 35개 run은 전부 완주하고, 21개 run이 새로 완주한다.
- Party 크기별 완주: 1P 4→11 / 48, 2P 15→26 / 36, 3P 16→19 / 24.
- 완주한 56개 run 전부에서 seat 1의 Level 곡선이 `1,1,1,2,2,2,3,3`으로 동일하다. 전투 결과와
  무관하게 성장 시점이 고정돼 있다는 뜻이다.
- 실패 지점 분포:

  | Encounter | 변경 전 | 변경 후 |
  |---|---:|---:|
  | `ruined-gate` (3전) | 27 | 27 |
  | `goblin-chief` (4전) | 18 | 18 |
  | `spear-line` (2전) | 5 | 5 |
  | `cult-sanctum` (8전) | 8 | 2 |
  | `archer-perch` (7전) | 8 | 0 |
  | `bone-cellar` (5전) | 5 | 0 |
  | `wolf-run` (6전) | 2 | 0 |

  Lv.2 확정 **이전**(1~4전)의 실패 수가 한 건도 움직이지 않았다. 성장이 없는 구간의 전투가
  변경 전과 정확히 같다는 직접적인 증거다. 감소는 전부 5전 이후에서 나온다.

- Encounter별 평균 라운드 수도 같은 경계를 보인다: `road-ambush` 2.5→2.5, `spear-line`
  6.5→6.5, `ruined-gate` 5.5→5.5, `goblin-chief` 5.8→5.8, `bone-cellar` 6.6→5.3,
  `wolf-run` 4.5→4.3, `archer-perch` 6.5→5.3, `cult-sanctum` 9.0→6.8.

- Level별 시작 Max HP (playtest 기록):

  | 캐릭터 | Lv.1 | Lv.2 | Lv.3 |
  |---|---:|---:|---:|
  | `hero.aerin` | 21 | 34 | 47 |
  | `hero.brom` | 26 | 42 | 58 |
  | `hero.lyra` | 17 | 26 | 35 |
  | `hero.nera` | 18 | 28 | 38 |

`tools/playtest/run-playtest.ts`의 `EncounterReport`에 `startingLevels`, `startingMaxHp`,
`experienceAwarded`, `levelsGained`, `finalLevels`, `finalExperience`가 추가되어 위 수치는
`--json` 리포트에서 바로 읽을 수 있다. 같은 정리로 playtest의 loadout 점수 계산과 network
helper의 Loadout 계산이 runtime effective profile을 전달하도록 바뀌었다. 이전에는 Lv.1
수치로 장비를 평가해, 성장한 파티의 장비 선택이 자기 수치와 무관하게 결정됐다.

**완료 기준 충족:** 새 Campaign의 4전·7전 승리에서 각각 Lv.2·Lv.3이 확정되어 서버에 저장되고,
다음 전투가 해당 Level의 수치를 사용한다. 직전 버전 Campaign은 진행 상태와 기존 EXP를 보존한
채 이관되며, 저장 실패·재시도·재접속으로 EXP가 중복 지급되지 않는다.
