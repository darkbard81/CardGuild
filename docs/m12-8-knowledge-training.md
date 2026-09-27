# M12-8 — Android 훈련과 지식 회상

[#70](https://github.com/darkbard81/CardGuild/issues/70)의 1-1~1-4는 기존 `enemy.android-trainee`와 front/back 아트를 공유한다. 신규 적이나 이미지는 없다. 이전 슬라임 정의와 아트는 reserve로 보존한다.

| 전투 | 보호 | 시나리오 규칙 |
| --- | --- | --- |
| 1-1 기본 연습 | HP 1 | 안드로이드 innate action을 빈 목록으로 제한하여 Trip 없음 |
| 1-2 상태 회복 | HP 1 | 기존 강제 Trip opening |
| 1-3 협공 | HP 1 | 주인공 임시 Training Dagger, 협공 없는 피해 0 |
| 1-4 지식 회상 | HP 1 | 첫 Recall Knowledge 판정 success |
| Spear Line | 없음 | tutorial modifier 없음 |

1-4는 주인공+Aerin 두 명과 안드로이드 하나, 기존 3×3 열린 훈련장을 사용한다. 저장된 원래 무기와 준비 카드를 사용하며 단검이나 협공 피해 정책은 이월하지 않는다. EXP 50만 지급하고 다음 Spear Line으로 진행한다. 모험은 11개 전투, 기존 tutorial prefix는 7개, Lv.2/Lv.3 검증 지점은 7/10승이다.

`ScenarioRules.guaranteedCheck`는 `actionId`, 배치된 `targetActorId`, `degree`, `uses: 1`을 선언한다. `opening`과 독립적이며 턴이나 명령을 강제하지 않는다. 공통 check 실행부가 실제 주사위/RNG를 소비한 다음 일치하는 첫 판정의 effective degree만 바꾼다. `CHECK_ROLLED.roll/baseDegree/rolledDegree`가 자연 결과를, `degree`가 적용 결과를 나타낸다. 기존 action/effect 경로가 행동 1을 소비하고 `KNOWLEDGE_RECALLED` 및 파티 공유 지식을 기록한다. 클래스 능력치, DC, 일반 Knowledge/AI에는 특수 분기가 없다.

`CombatState.guaranteedCheckConsumed`는 초기 false, 판정 사용 후 true다. 규칙은 setup fingerprint에 포함되고 소비 상태는 hash/save/snapshot에 포함된다. 저장 복구는 원래 setup과 command history의 replay와 전투 상태를 비교하여 소비 상태 위조를 거부한다. 잘못된 대상·비판정 action·존재하지 않는 innate capability는 콘텐츠 검증에서 거부한다. `innateActionOverride`는 해당 전투의 배치 actor가 가진 innate action의 부분집합만 허용한다.

미네르바 5페이지는 마지막 보호 훈련, 잠긴 상세, Ring Recall Knowledge, 행동 비용과 파티 공유, 첫 성공 보장 및 직접 상세 열기를 안내한다. 기존 반투명 presenter와 클릭/터치/Enter/Space/건너뛰기 동작을 재사용한다. 대화는 Knowledge intent를 전송하지 않으며 Host 출전 시에만 표시한다. 성공 후 상세창을 자동으로 열지 않는다. 실제 플레이어가 Ring을 다시 열어 `캐릭터 상세`를 선택한다. Guest 및 진행 중 전투 재접속에는 출전 대사를 넣지 않는다.

Protocol 17, content pack 0.15.0. Combat 6 / Save 5는 유지한다. 이전 pack의 저장은 기존 content identity 정책에 따라 거부하며 자동 변환하거나 개발 DB를 삭제하지 않는다.

검증 소유권: Domain은 네 훈련의 경계·모든 생성 preset·실패 주사위의 보정·한 번 소비·자연 판정·replay/save·참조 오류, Integration은 SQLite reopen/Resume, Interaction은 Host/Guest Ring 입력·ACK와 snapshot 구분·수동 상세·재접속을 검증한다. 기존 J-PROGRESS만 연장하여 1-3 승리 → 원래 무기 → 1-4 실제 Recall/상세/승리 → 보호 없는 Spear Line 연결을 검사한다.

2026-09-27 최종 로컬 gate `CI=true npm run check && CI=true npm run test:all` 완주(exit 0): 콘텐츠·에셋·TypeScript·ESLint·client/server build, Domain 143, Integration 27, Interaction 72, Journey 4 — 총 246개 통과. 1024×768 안드로이드 상세 화면을 시각 확인했다. 기존 bundle 크기 경고는 비차단이며 실물 iPad/Safari는 미검증이다. GitHub CI는 push 이후 별도 결과다.
