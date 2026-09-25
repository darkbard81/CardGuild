# 미네르바와 독립 씬 다이얼로그

미네르바는 성인 엘프 길드 접수원이며, 전투 Actor·Class·PartyMember가 아닌 씬 화자다. `src/scene`은 게임 상태나 저장 형식에 의존하지 않는다. #67 Tutorial 제작·production 전환은 이번 작업에 포함하지 않는다.

## 대화와 진입

`SceneDefinition`은 ID와 순서 있는 텍스트·선택적 화자/표정/오디오 지시를 담는다. `SceneSpeakerDefinition`의 faceSetId를 페이스 목록에서 해석한다. `ScenePlayer`는 시작, 페이지 revision을 받는 다음, 건너뛰기, 취소와 단 한 번의 종료 통지만 담당한다. 목적지 이동은 `AdventureController`가 맡는다. 오디오는 BGM/voice/SFX 참조를 전달하는 `SceneAudioPort.apply`와 종료 시 `stop`만 있다. 기본 구현은 무음이며 오디오 오류도 대화를 막지 않는다.

새 모험 → 필요한 인증 → 환영 3페이지 → 캐릭터 생성. 명시적 새 모험 선택마다 client-memory의 welcomePending을 초기화한다. 완료·건너뛰기 후 같은 생성 시도의 오류/재로그인에서는 다시 표시하지 않는다. 기존 CreationDraft를 유지하고 생성 폼의 이름 입력으로 포커스를 보낸다. 돌아가기/Escape는 시작 화면의 새 모험 버튼으로 돌아간다. 이어하기, Guest 참가, 빈 로비 재접속에는 삽입하지 않는다. 계정·Save·프로토콜에는 필드를 추가하지 않았으며, 대화는 Campaign/캐릭터 생성 요청을 보내지 않는다.

DOM 모달은 왼쪽 페이스, 오른쪽 이름/즉시 표시되는 텍스트, 하단 버튼으로 구성한다. 기본 1024×768과 좁은 터치 화면을 지원한다. 페이지 revision, 제거된 버튼 거부, 마우스 다중 클릭 및 키 반복 차단으로 중복 진행을 막고 독립된 터치 탭은 각각 처리한다. 분기, 자동 진행, 타이핑, 실제 음원/재생, 립싱크는 포함하지 않는다.

## 아트 결과물과 재현

| 파일 | 역할 |
| --- | --- |
| `art/reference/scenes/minerva.svg`, `.png` | 2048×2048, 512×512의 4×4, 좌상단 마젠타/파랑 교차, 감정 이름과 구도 가이드 |
| `art/source/scenes/minerva-prompt.txt` | 내장 image_gen에 전달한 실제 프롬프트 |
| `art/source/scenes/minerva.png` | 내장 image_gen 생성 원본, **1254×1254** |
| `art/processed/scenes/minerva.png` | 크로마 제거 후 전체를 동일 배율로 정규화한 2048×2048 투명 PNG |
| `art/processed/scenes/minerva/*.png` | 동일 512×512 캔버스의 16개 표정. 개별 자동 크롭/재정렬 없음 |
| `public/assets/scenes/minerva.webp` | quality 90, alpha 100 게임용 시트 |
| `src/scene/minerva-faces.json` | 이미지 크기와 행 우선 표정별 좌표/한글 이름 |

표정 순서는 기본, 환영미소, 활짝웃음, 윙크 / 설명, 생각, 의문, 놀람 / 걱정, 슬픔, 눈물, 당황 / 부끄러움, 불만, 단호함, 응원이다. 환영 대화는 환영미소 → 설명 → 응원을 사용한다. 원본은 2048 네이티브가 아니며 이를 보존하고 정규화 결과와 구분한다.

참조 생성: `npx tsx tools/assets/build-minerva-reference.ts`. 그 PNG를 참조로 내장 image_gen을 호출했다. API/CLI 대체 모델을 사용하지 않았다. 후처리: `npx tsx tools/assets/build-minerva-faces.ts`. 은발/녹색 의상의 색역 밖인 두 크로마 색을 제거하고 가장자리 색 번짐을 정리하며 전체 시트에 같은 변환을 적용한다. 셀 경계의 리샘플링 번짐은 각 셀에 동일한 2px 투명 여백으로 제거한다. 아트 원본과 프롬프트는 재현 입력으로 보존하며 build/check가 이미지를 새로 생성하지 않는다.

시각 검수에서 16종 감정, 동일 인물/복장, 얼굴 위치, 귀/정수리의 셀 내 배치, 텍스트·격자 제거를 확인했다. 투명 PNG와 게임용 시트는 고정 좌표로 표시한다. `check`에 포함된 scene asset 검사가 크기/알파/프레임 범위·중복/16종/크로마 잔여/대사 참조를 검사한다.

## 검증 책임

D-SCENE은 캐릭터 데이터 없는 재생, 오래된 입력, 단 한 번의 종료와 오디오 장애 격리를 검증한다. U-SCENE은 실제 DOM 버튼, 표정, 키보드·터치, 포커스, 취소·재진입과 생성 요청 부재를 검증한다. U-CREATE가 생성 실패/재인증 후 draft 보존을, U-ENTRY가 로그인 목적지/이어하기를 소유한다. J-START는 실제 가입과 환영 대화를 거쳐 생성·전투까지 연결한다. 나머지 생성 헬퍼도 실제 건너뛰기 버튼을 사용한다. 실물 iPad/Safari와 GitHub CI 결과는 로컬 Chromium 결과와 별도로 보고한다.

## #67 전투 전 안내 설계

생성 전 환영과 별도로, 신규 1-1 시작 직전 미네르바가 카드 구성·행동 수·길드 보호를 설명하는 대화를 [M12-5 첫 전투 안내](m12-5-tutorial-opening.md)에 정의했다. `guild-first-battle-briefing`은 2장 초기 덱·슬라임·실제 HP 보호가 있는 첫 연습전에 연결한다. 완료/건너뛰기 전에는 전투를 시작하지 않으며, 취소 시 준비 화면으로 돌아간다. #67 전체 Tutorial 전환은 별도 범위다.
