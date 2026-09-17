# #59 Human Interface 구현 점검

기준: 2026-09-17의 issue #59 본문·후속 코멘트와 현재 `feat-human-interface` 작업 트리. 이 문서는 GitHub 이슈의 체크박스나 실제 기기 검증을 대신하지 않는다.

| 범위 | 현재 구현 근거 | 검증 근거 |
| --- | --- | --- |
| 1 Entry / Login / Join | `SessionLobbyUi`의 목적별 진입, 라벨·form, `AdventureController`의 요청/복귀 처리 | U-ENTRY, J-START |
| 2 Campaign list / Continue | `renderCampaigns`의 진행·파티·저장 시각·도착 화면·저장 오류 표시, Resume Lobby | B-RESUME, J-CONTINUE 및 현재 렌더러 검토 |
| 3 Lobby / Party Builder | `PartyBuilderUi`의 초안/적용·선택/해제, 담당자·접속·준비 관계, 성공 후 clipboard 안내 | G-AUTHORITY, J-COOP 및 현재 렌더러 검토 |
| 4 Adventure / Between Encounters | 다음 목표·필수 성장·출발을 먼저 표시하고 전체 진행/Collection을 접음 | U-FEEDBACK, J-PROGRESS |
| 5 Loadout / Prepared Cards | Standee 고정 슬롯, 비교와 장착/해제 분리, 서버 확인 후 저장 상태 | G-LOADOUT, U-PREPARE |
| 6 Combat HUD | 현재 행동자·손패 소유자·열람 대상 구분, 우측 공통 상세, 부채꼴 손패, 접는 로그 | U-BATTLE, U-BOARD, 전투 캡처 |
| 7 Card / Ring | 명시적 상세 모드, 즉시 실행/방향/대상 선택 안내, invalid target 후 선택 유지와 공용 검증 이유 | U-INSPECT(터치), U-TARGET |
| 8 Facing / End Turn | 남은 Action 확인·취소, 0 Action 확인 생략, 마지막 제자리 Step의 서버 내 턴 종료 | U-END-TURN, G-FACING(명령 중복·replay 포함) |
| 9 Reaction / Waiting | owner 결정 모달과 실제 카드·기본 Strike 수치·cost/consequence, 원인/반응 캐릭터 강조, observer 담당자 대기 문구·상세 열람 | U-BATTLE Reaction, U-REACTION |
| 10 Reward / Level-Up | 보상 초안·캐릭터별 공용 Loadout 비교·명시적 획득·ACK+snapshot, 성장 필요 수·modifier/DC 변화·담당자 | U-REWARD 양쪽 응답 순서, U-FEEDBACK growth, J-PROGRESS |
| 11 Result / Failure | 완료·패배의 시작 화면 복귀 및 재접속 자격 해제, 연결/요청/대기 상태 구분, 초기화 실패 재시도 | U-FEEDBACK exit/reload, U-STARTUP, U-PREPARE reconnect, J-CONTINUE |

7–11의 변경 규칙은 루트 DESIGN.md, assertion 소유 계층은 test-risk-map.md에 기록했다. 결과 화면의 미구현 Replay/Retry 버튼과 불가능한 재도전 안내는 제거했다. 시작 화면 복귀는 저장 삭제가 아니며, 새 모험이나 다른 캠페인 선택으로 이어진다.

## 화면 확인

- 1024×768 가로에서 남은 Action 확인창과 두 버튼의 표시를 확인했다.
- 보상 세 개를 한 줄로 배치하고 선택 설명·비교·획득 버튼이 같은 화면에 보이는 캡처를 확인했다. 보상 목록의 기존 1100px 이하 세로 배치는 이 화면에서 해제했다.
- 좁은 화면에서는 후보를 두 열로 재배치한다. 이번에 모든 좁은 해상도를 별도로 반복 검증하지 않았다.
- 터치 상세 모드와 pinch 입력은 Chromium 에뮬레이션이다. **실제 iPad/WebKit에서 글자·터치 감각을 확인한 결과는 없으며 별도 확인이 필요하다.**

## 최종 검증

최종 코드에서 `CI=true npm run check && CI=true npm run test:all`을 완주했다(exit 0). 콘텐츠·에셋·TypeScript·ESLint·클라이언트/서버 build와 Domain 46, Integration 11, Interaction 26, Journey 4, 총 87개 검사가 통과했다. 성공 횟수에 선택 실행의 미선택 항목은 포함하지 않았다. Reaction의 처리 중 설명 유지·실제 카드 이름·공용 Strike 수치·보드 강조 보완 이후에도 같은 전체 gate를 다시 완주했다. 로그는 `/tmp/cardguild-59-final-gate.log`에 있다. 이후에는 이 검증 기록 문서만 갱신했다. 이 기록은 로컬 검증 결과이며 GitHub CI 및 실기기 검증을 대신하지 않는다. 커밋·push·이슈 코멘트는 별도의 게시 요청에 따라 진행한다.


## 실기기 확인 절차 (미실행)

실제 iPad에서 현재 작업 트리로 만든 클라이언트에 접속하고 기기 모델·iPadOS/Safari 버전·화면 방향을 기록한다. 1024×768은 설계 기준이며 실제 기기의 CSS viewport도 함께 기록한다.

1. 가로 모드에서 카드 이름·비용·상세·로그를 확대 없이 읽고 손패 접기/펼치기와 상세 모드를 조작한다.
2. 카드 및 Ring의 상세 모드에서 탭이 실행되지 않는지 확인한다. 일반 모드로 전환해 대상 선택/방향 선택/즉시 실행의 안내와 결과를 비교한다.
3. 카드 선택 후 잘못된 대상을 누르고, 선택 유지와 이유 표시를 확인한 뒤 올바른 대상으로 수정한다.
4. Action이 남은 End Turn의 취소·확정, 마지막 제자리 Step의 추가 방향 질문 없는 종료를 확인한다.
5. 서로 다른 두 클라이언트에서 Reaction 결정권자는 원인·카드·비용·수치를 읽고, 관전자는 대기 이유를 보며 상세를 조작할 수 있는지 확인한다.
6. 보상 세 개의 비교·명시적 획득, 성장 선택, 완료/패배 후 시작 화면 복귀를 확인한다. 글자 잘림이나 가려진 버튼이 있으면 화면과 재현 동작을 기록한다.

이 절차가 실행되지 않았으므로 실기기 acceptance를 통과했다고 표시하지 않는다.
