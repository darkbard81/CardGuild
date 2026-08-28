# Issue #1 M0 리뷰 판정

검토 대상: [CodeScarlett 리뷰](https://github.com/darkbard81/CardGuild/issues/1#issuecomment-5448834942)

## 수정

- **P0-1 Step Reaction**: 타당함. Step은 Move이지만 이동 Reaction을 유발하지
  않도록 `triggersReactions` 규칙 데이터로 분리했다. Stride/Fly는 기존처럼
  Reaction 후보를 조회한다.
- **P0-2 Preview/Dispatch legality**: 타당함. `validateActionIntent()`가 전투 종료,
  pending Reaction, 현재 턴, Action 비용·잠금, source와 target을 한 번에 검증하며
  action/target query, preview와 command dispatch가 이를 공유한다.
- **P1-1 Trait provider**: v2 설계와 일치하는 지적이다. Equipment의 중복
  `cardGrants`/`actionGrants`를 제거하고 `TraitDefinition` registry가 Trip/Fly 카드와
  Raise Shield 행동을 공급한다. 생성 카드의 equipment/trait provenance는 보존한다.
- **P1-2 Condition recovery provider**: v2 설계와 일치하는 지적이다. Condition의
  Trait가 Recovery Action을 공급하며 DOM에서는 `Escape` 메뉴 아래 Stand/Escape
  variant를 표시한다.
- **P1-3 degree outcome**: 타당함. Escape는 `DegreeOutcomeMap`으로 결과별 effect를
  선언한다. Critical Success/Success는 Grabbed를 제거하고, Critical Failure는
  같은 턴의 Escape 재시도를 잠근다.
- **Facing 명시**: 현재 Facing arc와 후방 AC -2는 의도된 CardGuild 규칙이다.
  PF2e Off-Guard/Flanking 구현으로 오해하지 않도록 README의
  `CardGuild Rules Override`에 명시했다.

Step과 Escape 판정은 Player Core의 [Basic Actions](https://2e.aonprd.com/Rules.aspx?ID=2343)를
규칙 근거로 삼았다.

## 보류

- **다중 Reaction candidate 순차 처리**: 현재 M0는 플레이어 캐릭터 1명과 Reaction
  1종을 검증하는 범위이므로 기능 결함을 만들지 않는다. M4 Server-authoritative
  Co-op 착수 전에 candidate priority, use 이후 남은 후보, reactor가 mover를
  쓰러뜨린 경우의 continuation 정책을 함께 설계한다.
- **Escape Critical Success의 선택적 5ft 이동**: M0는 degree별 outcome 경계와
  재시도 잠금을 검증한다. 추가 이동은 입력 대기형 follow-up command가 필요하므로
  M5 Rules Expansion에서 reaction과 같은 pause/resume 경계로 구현한다.
- **GitHub CI status**: 로컬 필수 검증은 유지하되 workflow 도입은 별도 인프라
  작업으로 분리한다. M0 규칙 수정의 blocker로 보지 않는다.
