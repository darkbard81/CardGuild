# M12-6 상태 대응 훈련 (#68)

Production `adventure.goblin-trouble`의 두 번째 전투는 `encounter.prone-training`이다. 기존 encounter를 삭제하지 않고 첫 연습전 뒤에 삽입한다. 9개 encounter 중 1-1/1-2는 솔로 학습 구간이며, 1-2의 `rules.partySize`가 Solo를 강제한다. EXP 50을 추가하고 기존 Lv.2/Lv.3 milestone의 승리 횟수를 5/8로 옮겼다. 1-2 승리 보상 `reward.training-aerin`은 기존 `companion.aerin`을 atomic recruitment로 합류시킨다. 이후 준비 화면에서 동료의 Co-op 조작권을 허용할 수 있다. 1-3 Flanking 제작은 이 변경에 포함하지 않는다.

## 전투와 저장 계약

`ScenarioRules.opening`은 actorId, innate actionId, 단일 targetTeam, 지정 degree, sceneId를 선언한다. 정상 initiative roll/RNG를 소비하고 원래 순서를 보존한 뒤 첫 라운드만 지정 Actor를 맨 앞으로 둔다. 지정된 첫 command만 허용하며 일반 Trip 판정·효과 경로가 실제 Prone을 적용한다. 실제 굴림과 원래 degree도 CHECK_ROLLED의 rolledDegree로 남기고 Combat Log에 지정 결과임을 표시한다. 수치를 부풀리거나 클라이언트 조건을 삽입하지 않는다.

Opening progress는 `pending → dialogue → complete`다. 서버는 첫 action을 저장·발행한 뒤 dialogue에서 멈춘다. Host의 `complete-scene` intent가 저장되면 첫 Actor의 opening turn을 끝내고 다음 Actor로 진행한다. 이 opening은 첫 턴을 지정 action 하나로 구성한다. 둘째 라운드부터 원래 initiative 순서와 일반 AI를 사용한다. 일반 AI는 적 ID나 tutorial ID를 알지 않는다.

`partyHpFloor: 1`은 1-1과 1-2에만 선언하며 일반 전투에 적용하지 않는다. 기존 보호 필드를 옮겨 전체 저장 형식을 바꾸는 대신 새 modifier들은 `rules`에 묶었다. Scenario/Combat/setup fingerprint/replay/save에 동일 계약이 전달된다. 저장 복구는 authored rules와 일치하는지 검사하고 opening combat의 command log를 replay하여 변조된 phase·순서·조건을 거부한다. pending 저장은 Resume 후 아직 실행하지 않은 첫 action을 한 번 실행하고, dialogue 저장은 안내 완료를 기다리며 complete 저장은 opening을 재실행하지 않는다.

Wire protocol은 14, content pack은 0.13.0이다. CampaignSave v5 / Combat v6의 선택적 필드를 확장했으며, 이전 pack 저장은 기존 content identity 검사에 따라 거부한다. 자동 migration이나 삭제는 하지 않는다.

## 안내와 Stand

실제 Prone snapshot 뒤 기존 전투 화면 위에 미네르바의 반투명 DOM 대화창을 표시한다. Prone의 파생 Off-Guard AC −2, 이동 제한, 자기 칸 Ring의 Stand를 설명한다. 클릭·터치·Enter/Space로 진행하고 Next/Back 버튼은 없다. 완료·건너뛰기·Escape 모두 이 adventure gate에서는 같은 서버 완료 요청이며 Prone은 제거하지 않는다. Pre-game Escape는 기존처럼 시작 화면으로 돌아간다.

완료 중에는 overlay를 유지하고 ACK와 snapshot이 모두 도착해야 닫는다. 저장 실패는 같은 완료 화면에서 재시도하며 Trip이나 안내 첫 페이지를 다시 실행하지 않는다. 연결 복구도 열린 페이지를 유지한다. 재입장 시 아직 미완료인 gate만 표시한다. 완료된 gate와 일반 전투, Guest에는 이 안내를 삽입하지 않는다. 실제 회복은 기존 `listLegalActions/listLegalTargets → Ring → Stand` 한 번으로 1 action을 소비한다. 별도 Stand 버튼이나 오디오는 없다.

## 안드로이드 에셋

`enemy.android-trainee`: 성인 여성형 길드 훈련 안드로이드, Lv −1 / HP 12 / AC 12 / speed 15ft / Perception 0 / Athletics +2 / Strike +2, 1d4 bludgeoning. `trip`은 innate capability이며 opening 이후에는 일반 판정을 사용한다.

내장 image_gen으로 front를 먼저 생성한 뒤 실제 front PNG를 참조하여 back을 생성했다. `art/source/actors/enemy/android-trainee/`에 두 원본, front-left/back-right packaging sheet, prompts.json을 보존했다. `art/processed/actors/enemy/android-trainee/`의 256×384 RGBA front/back과 `public/assets/actors/enemy/android-trainee/`의 개별 WebP를 사용한다. 기존 standalone pipeline과 catalog/check를 따르며 atlas actor로 되돌리지 않는다. 정규화된 두 면의 인물/복장, 전체 실루엣, 발 기준점, 투명 여백과 흰 외곽선을 시각 검수했다.

## 검증 책임

- G-PRONE: 9 presets × 2 genders × 6 seeds, opening 결과·일반 순서 복귀·이동/Stand 연결·replay·save/Resume·모집. Prone arithmetic과 HP floor 스트레스는 기존 G-CONDITION/G-OPENING에 남긴다.
- B-PRONE: 서버의 Trip commit 후 gate 정지, Resume 중복 방지, 완료 request 재전송의 멱등성.
- U-PRONE: 실제 시작 → snapshot Prone → 안내, 완료/skip/Escape, 오류 재시도·재연결, ACK/snapshot 양순서, 기존 Ring Stand intent 한 번.
- J-PROGRESS: 기존 첫 전투 near-victory checkpoint에서 1-1 승리·성장 → 1-2 → 실제 Stand → 승리 → Aerin 합류를 한 번 연결한다. J-COOP는 모집 완료 checkpoint를 사용한다.

기존 authored-party Domain/Interaction fixture는 시작 API의 새 Solo/recruitment 계약과 분리해 이전 adventure definition을 테스트 내부에서만 유지한다. 실제 production 시작·저장·Journey는 생성 주인공과 기존 모집 절차를 사용한다.

## 최종 로컬 결과

2026-09-26 최종 상태에서 `CI=true npm run check && CI=true npm run test:all` 완주: Domain 133, Integration 25, Interaction 67, Journey 4 — 총 229개 통과. 콘텐츠·에셋·타입·ESLint·client/server build도 통과했다. 실물 iPad/Safari는 미검증이며 GitHub CI는 push 이후 별도 결과다.
