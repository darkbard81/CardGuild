# UI/UX 리뷰 캡쳐

CardGuild의 현재 화면을 화면별 대표 이미지로 남겨, 개선 전(**원본**)과 개선 후(**변경**)를
같은 자리에서 비교하기 위한 폴더입니다. 캡쳐는 실제 앱을 solo host로 한 판 돌리면서
찍으므로, 목업이 아니라 지금 코드가 실제로 그리는 화면입니다.

## 폴더 구조

```
docs/ui-review/
├── baseline/          원본 — 개선 전 화면 (한 번 찍고 고정)
│   ├── 1440x900/      데스크톱 기준 해상도 + manifest.json
│   └── 1024x768/      지원 최소 해상도 + manifest.json
├── current/           변경 — 개선안을 적용한 뒤 다시 찍는 자리
└── index.html         원본 ↔ 변경 좌우 비교 페이지 (브라우저로 바로 열기)
```

`manifest.json`은 각 캡쳐의 화면 ID, 한글 제목, 무엇을 봐야 하는지, 그리고 찍지 못한
화면과 그 이유를 담습니다. 비교 페이지는 파일 이름이 아니라 이 화면 ID로 원본과 변경을
짝지으므로, 개선 과정에서 캡쳐 순서가 달라져도 짝이 어긋나지 않습니다.

## 사용법

```bash
npm run ui:capture            # 변경 캡쳐 → docs/ui-review/current/ 를 갱신하고 비교 페이지 재생성
npm run ui:capture:baseline   # 원본 캡쳐 → docs/ui-review/baseline/ 를 다시 찍음
npm run ui:compare            # 이미 찍힌 캡쳐로 index.html 만 다시 생성
```

캡쳐는 `playwright.capture.config.ts`가 `npm run dev:coop`을 `CARDGUILD_ADVENTURE_SEED=1`로
띄운 뒤 `tests/ui-capture.capture.ts`를 실행합니다. 이미 개발 서버가 떠 있으면 그것을
재사용합니다. `npm run test:smoke`는 이 설정을 쓰지 않으므로, 스모크 테스트가 리뷰
자료를 덮어쓰는 일은 없습니다.

UI를 고친 뒤에는 `npm run ui:capture`만 다시 돌리고 `docs/ui-review/index.html`을 열면
화면마다 왼쪽 원본과 오른쪽 변경이 나란히 보입니다. **`baseline/`은 개선 전 기준이므로
개선 작업 중에는 다시 찍지 않습니다.**

## 담고 있는 화면

| # | 화면 ID | 화면 | 리뷰 포인트 |
| --- | --- | --- | --- |
| 01 | `session-lobby` | 세션 로비 (진입 화면) | 첫 화면에서 무엇을 먼저 해야 하는지, Create/Join의 무게 배분 |
| 02 | `party-builder` | 호스트 로비 · 파티 편성 | Session ID 공유, seat 상태, 1–3인 캐릭터 편성과 시작 게이팅 |
| 03 | `adventure-brief` | Adventure 진행 화면 | 8단계 진행 레일, 보상 표시, 소유 Collection, 다음 Encounter 브리핑 |
| 04 | `loadout-builder` | Loadout Builder 기본 상태 | Collection · 장비 · 덱 미리보기 3열 배치와 파생 스탯 패널 |
| 05 | `loadout-card-picker` | 준비 카드 추가 | Prepared Cards 후보 목록이 덱 미리보기와 어떻게 연결되는지 |
| 06 | `loadout-preview-diff` | 적용 전 변화 미리보기 | Apply 전에 보여주는 스탯 diff의 가독성 |
| 07 | `combat-turn` | 전투 화면 · 내 턴 시작 | 보드 위 반투명 HUD 배치, 액션 pip, 이니셔티브, 핸드 독 |
| 08 | `combat-action-ring` | 타겟 선택 후 액션 링 | target-first 라디얼 메뉴와 Detail 패널의 명중/피해 설명 |
| 09 | `combat-hero-sheet` | 캐릭터 상세 시트 | 상세 버튼이 펼치는 시트 — 세이브 DC, Strike, 장비 수치가 요약 카드 대신 여기 모인다 |
| 10 | `reward-choice` | 보상 선택 화면 | 보상 카드가 스스로를 설명하는 방식과 선택 압박 |
| 11 | `adventure-after-reward` | 보상 수령 후 Adventure | 미장착 보상 안내(loadout nudge)와 다음 단계 유도 |
| 12 | `adventure-outcome` | Adventure 실패 화면 | 패배 후 재도전 동선 |

## 찍지 못한 화면

- `reaction-window` — 리액션 창. 이기는 플레이와 지는 플레이를 모두 돌렸지만 이 시드에서는
  반응 기회가 열리지 않았습니다. 캡쳐가 필요하면 반응이 실제로 발생한 판에서 수동으로
  찍어 `baseline/<해상도>/`에 넣고 `manifest.json`에 항목을 추가하세요.
- `encounter-result` — 전투 결과 모달. Adventure 흐름에서는 전투가 끝나는 즉시 Adventure
  화면으로 넘어가기 때문에 이 모달이 화면에 남지 않습니다. 승패 안내는 보상 화면(10)과
  실패 화면(12)이 대신하고 있습니다.

두 항목은 `manifest.json`에도 이유와 함께 남아 있고, 비교 페이지에서는 빈 칸으로 표시됩니다.
