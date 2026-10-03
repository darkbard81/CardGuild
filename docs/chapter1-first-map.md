# 챕터 1 첫 맵: 버드나무 숲길

`encounter.willow-rescue`는 기존 네 Android 튜토리얼 바로 다음에 들어가는 20×20 숲 전투다. Aerin의 고향 윌로우브룩 피난길을 황동잎 용병대로부터 확보한다. 네 튜토리얼의 HP 보호·협공 조건·지식 보장 판정은 유지되며 숲에는 적용되지 않는다. 이 문서는 첫 맵 단계의 기록이다. 후속 구현에서 첫 맵을 포함한 총 4전투와 새 카드/장비 보상을 완성했으며, 현재 범위와 최신 검증은 [챕터 1 완성](chapter1-complete.md)을 따른다.

## 콘텐츠와 동작

- 잔디·흙·낙엽의 지면 3종과 보행 불가 연못. 양쪽 우회로로 모든 시작 배치에 접근 가능하다.
- 별도 스탠디 나무 31개와 바위 6개. 인접한 오브젝트의 Ring에서 **장애물 파괴**를 선택하면 1행동을 사용하고 해당 칸만 열린다. 공격/피해/도구 내구도 규칙을 추가하지 않는다. 여러 번 누르거나 떨어져서 파괴하는 명령은 거부한다.
- `used` 오브젝트는 저장에 남고 화면에서 사라진다. 타일은 원래 지면을 유지한다. 파괴 상태와 통행은 replay/save/Resume에서 유지된다.
- 성인 여성 다크엘프 전사·척후병·궁수·마법사, 모두 level 1. 요청한 큰 가슴 체형과 어깨·가슴선·허리 등의 적당한 노출 의상으로 제작했다. 앞·뒤를 별도로 생성하고 같은 셀 규격으로 정규화했다. 2–3인 파티에는 네 역할 모두, 1인에는 전사·마법사가 등장한다.
- 전체 맵을 보는 초기 카메라에서 휠로 확대, Alt+드래그/가운데 버튼 또는 터치 제스처로 이동한다. 기존 카메라·깊이·높이 규칙을 사용한다.
- 기존 탐욕 이동이 연못/U자 장애물에서 정체하므로, 적 AI와 QA 자동 플레이 정책은 기존 격자 탐색의 유효 보행 경로를 따라 접근한다. 실제 이동 비용과 권한 판정은 바뀌지 않는다.

## 에셋과 근거

- 원본 및 캐릭터·오브젝트 생성 프롬프트: `art/source/chapter1-originals/`.
- 생성 계획: `art/source/generation-plan.json`. 지면 재질은 trait→asset 매핑이다.
- 런타임 스탠디: `public/assets/actors/enemy/dark-elf-{warrior,rogue,archer,mage}/{front,back}.webp`.
- 배경: `public/assets/backgrounds/willow-forest.webp`, 시나리오 연결은 `presentation/m3/encounter-backgrounds.json`.
- [캐릭터 앞·뒤](visual/chapter1-first-map/cast-front-back.png), [게임 화면](visual/chapter1-first-map/gameplay.png), [나무 제거 후 통행](visual/chapter1-first-map/tree-cleared.png), [전체 미리보기](visual/chapter1-first-map/overview.png).

미리보기: 기존 Vite 서버에서 <http://127.0.0.1:4195/terrain-preview.html?renderer=canvas&scenario=encounter.willow-rescue>. 서버가 없으면 `npx vite --host 127.0.0.1 --port 4195 --strictPort`. 개발 전용 미리보기는 저장/개발 DB를 변경하지 않는다. 실제 게임은 새 모험에서 튜토리얼 1–4 후 진입한다.

## 검증 기록 (2026-10-03)

- 선택 Domain: 지도 연결성과 지형, 나무/바위 각각의 비용·거부·국소 통행·replay/save/Resume, U자 우회 통과. 기존 지식 회상 테스트는 새 맵의 열린 시야에서 전사를 대상으로 자연 판정을 확인한다.
- 선택 Interaction: 고향 안내 취소→재진입→출발, 나무 Ring 파괴 요청과 ACK/snapshot 반영, 열린 칸으로 실제 Step 통과. 1024×768 Chromium/Canvas.
- 제한 자동 플레이: 전사·궁수·마법사 + Aerin, seed 1–3, 기존 탐욕 정책에 보행 경로 접근을 적용. 최종 9건은 5승 4패, 모두 300명령 이내에 종료. [상세 결과](visual/chapter1-first-map/balance.json). 정체 검출과 대략적인 난도 참고이며 승률 추정이나 모든 직업/인원 조합의 밸런스 보증은 아니다.
- 최종 **`CI=true npm run check && CI=true npm run test:all` 연속 완주, exit 0**. Node 24.18.1 / npm 11.16.0. 콘텐츠·에셋·TypeScript·ESLint·클라이언트/서버 build 통과. Domain **153**, Integration **27**, Interaction **76**, Journey **4** — 총 **260건 통과**, 실패·skip 없음. 코드/테스트는 이 실행 중 변경하지 않았다. 이후에는 문서·화면 증거만 저장했다.
- 최종 콘텐츠: `cardguild.m7@0.15.0`, `fnv1a64:b8b5fd8189e9ca4d`. [전체 실행 로그](visual/chapter1-first-map/final-gate.log). Journey는 실제 튜토리얼 승리→고향 안내→숲 진입과 기존 서버 재시작/Resume를 포함한다. 로컬 결과는 GitHub CI를 대체하지 않는다.
- 중간 실패는 기존 생성 템플릿의 외형 검증 구분, 지식 회상의 나무 너머 대상, 완료 화면의 이전 모험 이름 기대값이었다. 원인을 수정하고 실패 사례를 재검사한 뒤 위 최종 전체 실행으로 확인했다. 제한 시뮬레이션에서 발견한 U자 우회 되돌아가기 또한 별도 회귀로 확인했다.

GPU WebGL/WebGPU와 실제 태블릿은 이 환경에서 검증하지 못했다. Canvas 렌더링을 확인했다. 현재 콘텐츠의 저장 복원은 검증하지만, 기존 정책대로 이전 콘텐츠 fingerprint의 자동 마이그레이션은 등록하지 않았다. 이전 개발 DB는 열거나 삭제하지 않았다. 커밋·푸시·배포는 하지 않았다.
