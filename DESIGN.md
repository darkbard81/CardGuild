# DOM UI 디자인 관리

CardGuild의 DOM UI는 **공통 테마 변수 → 공통 컴포넌트 → 화면별 배치 → 테마 확장**으로 관리한다. 기본 대상은 **iPad mini 1024×768 가로 모드**다. 더 넓은 화면에서는 공간을 활용하고, 세로·좁은 화면은 보조 반응형 조건으로 검증한다.

## 파일과 적용 순서

진입점은 `src/style.css`이며, 아래 CSS cascade layer 순서를 선언한다.

```css
@layer tokens, base, components, screens, theme;
```

| 파일 / layer | 책임 |
| --- | --- |
| `src/styles/tokens.css` / `tokens` | `:root`의 색상·표면·폰트·모서리·그림자·간격·포커스 변수 |
| `src/styles/base.css` / `base` | 문서 기본값, box sizing, 기본 글꼴, 접근성 유틸리티 |
| `src/styles/components.css` / `components` | `.ui-panel`, `.ui-button`, `.ui-input`, `.ui-status` 공통 외형과 상태 |
| `src/style.css` / `screens` | 화면별 grid/flex, 위치, 폭·높이, 여백, 반응형 배치 및 게임 전용 컴포넌트 |
| 추가 테마 파일 / `theme` | 선택적으로 추가하는 전체 테마 또는 명시적 외형 변경 |

일반 선언은 뒤쪽 layer가 앞쪽 layer보다 우선한다. **같은 layer 안에서는 선택자 구체성, 그다음 선언 순서**를 따른다. 클래스 이름의 접두사나 HTML의 클래스 나열 순서는 우선순위를 만들지 않는다.

새 CSS는 반드시 위 layer 중 하나에 넣는다. layer 밖의 일반 규칙은 모든 layer의 일반 규칙보다 우선하므로 테마 충돌의 원인이 된다. `!important`로 우선순위를 해결하지 않는다. 기존 `[hidden]`의 `display: none !important`는 표시/숨김 계약을 보장하는 예외이며 유지한다. 중요한 선언은 layer 우선순위가 반대이므로 테마에 `!important`를 추가하지 않는다.

## 클래스 규칙

공통 컴포넌트와 화면 역할을 같은 요소에 **명시적으로 함께** 붙인다.

```html
<section class="ui-panel session-card session-entry">
  <input class="ui-input session-input" />
  <button class="ui-button ui-button--primary session-primary">로그인</button>
</section>
```

- `ui-*`: 여러 화면에서 재사용하는 외형. 화면 이름이나 업무 동작을 넣지 않는다.
- `ui-컴포넌트--변형`: 동일 컴포넌트의 외형 변형. 기본 클래스도 반드시 함께 붙인다.
- `session-*`, `adventure-*`, `loadout-*`, `hud-*`: 화면이나 기능의 역할·배치. 기존 DOM 조회와 테스트 hook도 유지한다.
- 하위 요소가 필요하면 `ui-컴포넌트__요소`를 사용한다. 현재 존재하지 않는 하위 요소 클래스를 미리 만들지는 않는다.
- ID는 label 연결·접근성·정확한 동작 대상 식별에 사용한다. 신규 외형 규칙의 선택자로 사용하지 않는다.
- `[class^="ui-"]`처럼 접두사로 스타일을 추측하지 않는다. 문자열 클래스명으로 컴포넌트를 자동 분류하는 런타임도 만들지 않는다.

공통과 세부 규칙은 함께 적용된다. `.ui-button.ui-button--primary`는 같은 layer의 `.ui-button`보다 구체적이며, 충돌하는 속성만 재정의한다. **변형 클래스만 붙여서는 기본 클래스의 규칙을 받지 않는다.**

## 공통 컴포넌트

| 기본 클래스 | 변형 / 상태 | 적용 대상 |
| --- | --- | --- |
| `.ui-panel` | `--hud`, `--dialog`, `--workspace`, `--popover` | 진입·로비, 모험 패널, 전투 HUD, 모달, Loadout, 상세 설명, 성장 선택 패널 |
| `.ui-button` | `--primary`, `--secondary`, `--danger`, `--compact` | 일반 동작, 폼 제출, 페이지 이동, 탭, 참가자 제거 |
| `.ui-input` | `--compact` | 텍스트·비밀번호 입력과 select |
| `.ui-status` | `[data-kind="error"]` | 진입 화면의 진행·오류 안내, Loadout 상태 안내 |

기본 버튼과 입력은 최소 44px 높이를 사용한다. `--compact`는 기존 작은 조작부의 기하를 유지하는 예외이며, 기존 전투 턴 종료·참가자 제거·파티 select에만 적용한다. 새 조작부에는 기본 크기를 우선한다.

실제 비활성은 `disabled`, 비활성처럼 보여도 설명을 읽을 수 있는 전용 요소는 `aria-disabled`, 선택은 `aria-selected` / `aria-pressed`, 오류는 `aria-invalid`를 사용한다. 선택된 상태를 비활성처럼 표현하지 않는다. 시각 상태 변경만으로 동작 권한을 판단하지 않는다.

화면 CSS는 공통 컴포넌트의 배경·테두리·모서리를 같은 값으로 다시 선언하지 않는다. 폭, grid, padding, 최소 높이, 문맥별 글자 크기는 화면에서 설정할 수 있다. 여러 화면이 같은 외형을 요구하면 공통 변수나 재사용 가능한 변형으로 승격한다.

## 테마 바꾸기

기본 테마 수정은 `tokens.css`의 의미 있는 변수부터 변경한다. 공통 팔레트는 캐릭터 상세창 기준의 슬레이트 배경(`#171b20`), 패널(`#222a34`), 테두리(`#354457`), 주황색 강조(`#ff6338`)와 밝은 본문(`#f3f5f7`)이다. 진입·로비·준비·전투·상세가 같은 토큰을 공유한다. 상세창의 `--sheet-*`는 별도 팔레트가 아닌 공통 `--ui-*` 토큰의 별칭이다. 상태·위험·이동 범위의 의미 색상은 구분을 유지한다.

| 변수 묶음 | 용도 |
| --- | --- |
| `--ui-color-*` | 본문, 보조 설명, 강조, 성공·오류 등 의미별 색 |
| `--ui-surface-*`, `--ui-border-*` | 패널 종류, 입력, 기본·주요·위험 버튼의 배경과 테두리 |
| `--ui-font-*`, `--ui-radius-*`, `--ui-shadow-*` | 공통 글꼴, 모서리, 그림자 |
| `--ui-space-*`, `--ui-control-min-height` | 공통 간격 척도와 기본 조작 높이 |
| `--ui-focus-ring`, `--ui-opacity-disabled` | 키보드 포커스와 비활성 표시 |
| `--ui-card-*` | 게임 카드 앞면의 기본 색상·모서리 |

예를 들어 전체 주요 버튼 색과 공통 패널 모서리를 바꾸려면 다음처럼 테마 layer에서 `:root`를 재정의한다.

```css
@layer theme {
  :root {
    --ui-surface-primary: linear-gradient(#426d8a, #223e55);
    --ui-border-primary: #709fbd;
    --ui-radius-panel: 1rem;
    --ui-color-accent-bright: #bce6ff;
  }
}
```

별도 파일을 쓰면 `src/style.css`의 import 목록에 `@import "./styles/my-theme.css" layer(theme);`를 추가하고, 그 파일에는 layer를 다시 감싸지 않은 `:root` 규칙을 둔다. 테마 전환 UI나 런타임 테마 선택 기능은 현재 추가하지 않는다.

기존 `--ink`, `--gold`, `--panel` 등은 `tokens.css`의 **호환 별칭**이다. 새 공통 코드는 `--ui-*`를 직접 사용한다. 기존 게임 전용 스타일도 root의 의미 색상을 함께 받는다. 별칭은 선언 위치에서 계산되므로 전체 테마는 `:root`에 적용한다. 하위 화면에만 토큰을 덮어써서 기존 별칭까지 자동 갱신된다고 가정하지 않는다.

## 게임 전용 외형과 동적 스타일

`.card-face`는 손패·보상·Collection의 게임 카드이며, 일반 패널을 의미하지 않는다. 링 메뉴, 장비 타일, Trait chip, 캐릭터 선택 카드, 전투 조건·지형 색은 의미와 상호작용이 다르므로 일반 버튼/패널로 일괄 변경하지 않는다. 전용 클래스와 필요한 전용 색상을 유지하되, 공통 의미 색은 토큰을 사용한다. 따라서 현재 모든 장식 색상이 토큰화된 것은 아니다.

일반적인 색상·테두리·폰트·상태 외형을 TypeScript inline style로 지정하지 않는다. 단, 이미지/atlas 좌표, 보드·툴팁 위치, 진행률, 보상 개수에 따른 CSS 변수 등 **실행 중 계산되는 데이터**는 기존 inline style을 허용한다. PixiJS 캔버스·이미지 원본은 이 DOM CSS 체계의 적용 대상이 아니다.

## 변경 검증

- 1024×768 가로 모드에서 핵심 화면의 크기와 조작 영역을 확인한다. Entry는 입력이 제출보다 앞서고 폼이 화면 높이에 들어와야 한다.
- 1280px 이상, 768px 세로, 390px 폭은 확장·축소 회귀 조건이다. 390px를 기본 디자인 폭으로 삼지 않는다.
- 실제 입력·포커스·보드 검증은 `tests/interaction`이 소유합니다. 현재 assertion 범위는 `docs/test-risk-map.md`를 기준으로 하며 토큰별 전수 검증은 주장하지 않습니다.
- DOM 클래스 변경 시 기존 Browser Unit과 해당 E2E의 동작·선택자를 확인한다. 상태를 주입한 검사는 E2E로 분류하지 않는다.
- `npm run check`, `npm run build` 및 영향받는 브라우저 검사를 수행한다.

## 캠페인 목록과 재참가

- `campaign-*`는 넓은 요약 카드 목록의 배치, `resume-*`는 저장된 파티와 현재 참가자 관계의 배치를 담당한다. 기본은 1024×768 가로 모드이며 넓은 화면에서는 최대 76rem까지 확장한다.
- 요약 카드와 캐릭터 패널은 `ui-panel ui-panel--workspace campaign-card` 또는 `ui-panel ui-panel--workspace resume-character`처럼 기본·변형·화면 클래스를 함께 사용한다. 게임 카드의 `.card-face`와 구분한다.
- 동작은 `ui-button`과 기존 modifier를 사용한다. 카드 자체를 클릭 대상으로 만들지 않고 별도 버튼으로 실행한다. 특색 있는 외형이 필요하면 `ui-button ui-button--이름`으로 확장한다.
- 선택한 캐릭터는 `data-claim-state="mine"`으로 표시한다. 참가자의 선택과 실제 조작 담당자는 별도로 표시하며, 외형만으로 조작 권한을 판정하지 않는다.

## 캐릭터 상세 공통 기준 — 플레이어와 적

앞으로 추가하거나 개편하는 캐릭터 상세 화면은 [#59의 캐릭터 디테일 공용 UI 목업](https://github.com/darkbard81/CardGuild/issues/59#issuecomment-5709181501)을 기본으로 한다. 플레이어 캐릭터와 적 모두 동일한 상세 패널 구조를 재사용한다.

- 기본 `CORE` 탭은 이름·초상·HP와 HP 바, 주요 능력치, 레벨 등 정체성 정보, 내성·방어·이동 등 핵심 수치를 목업의 정보 계층에 맞춰 보여준다. 실제 표시 항목과 값은 CardGuild의 해당 캐릭터 데이터에 따른다.
- 추가 정보는 필요한 탭으로 확장한다. `SKILLS`를 비롯해 특성·행동·장비 등의 탭은 해당 기능과 표시할 정보가 있을 때 추가하며, 각 화면마다 별개의 상세 UI를 만들지 않는다.
- 클래스·XP처럼 캐릭터 유형에 따라 적용되지 않는 항목은 생략하거나 해당 유형에 맞는 정보로 구성한다. 목업의 수치·아이콘·항목을 맞추기 위해 존재하지 않는 데이터를 만들지 않는다. 적에게 표시할 정보의 공개 범위는 게임 규칙을 따른다.
- 목업의 세로 패널은 상세 컴포넌트의 기준이다. 전체 화면은 기존 1024×768 가로 모드 원칙을 유지하고, 사용 문맥에 맞게 패널을 배치한다. 정보가 많아지면 탭과 패널 내부 스크롤을 사용한다.
- 공통 패널·버튼·탭은 기존 `ui-*` 클래스와 테마 토큰을 사용한다. 캐릭터 유형별 차이는 공통 컴포넌트의 데이터와 필요한 modifier로 표현한다. 탭은 선택 상태와 키보드 탐색을 지원한다.

이 규칙은 향후 상세 UI 구현의 기준이며, 현재 화면이 모두 목업 구조로 전환되었다는 의미는 아니다.

## 파티·전투 준비·Loadout의 선택 계약

- 로비의 카드 선택은 호스트에게는 파티 초안이며 `파티 적용`으로 확정한다. 게스트는 자기 캐릭터를 선택·해제할 수 있다. 선택된 카드를 disabled 외형으로 표현하지 않는다. 재참가 파티 구성은 고정이다.
- 공통 상세 모달은 `ui-panel ui-panel--dialog ui-character-detail-dialog` 안에 `ui-character-detail` 콘텐츠를 사용한다. `CORE / SKILLS / TRAITS` 탭은 실제 제공되는 데이터로 구성하며, 준비 화면은 현재 HP 대신 최대 HP를 표시한다. 공개된 Character/Creature 데이터만 입력으로 받는다.
- Loadout의 Standee 주변 고정 사각 슬롯은 몸(`armor`), 주손(`weapon`), 보조손(`shield`), 악세서리(`feet`)다. `feet`는 저장 호환성을 위한 내부 키이며 화면에서는 악세서리로 표시한다.
- 탭/클릭과 드롭은 상세·비교 선택만 한다. `장착 / 교환 / 해제 / 준비 추가`가 실제 변경이며, `비교 취소`와 Esc는 미확정 입력만 취소한다. 해제한 장비는 공유 장비함에 남는다.
- `loadout-drag-handle`은 최소 44px 조작 영역과 `touch-action: none`을 사용한다. 일반 목록은 세로 스크롤을 허용한다. 드래그·잘못된 드롭·pointercancel은 서버 변경을 발생시키지 않는다.
- 적용 상태는 해당 요청의 ACK와 확정 revision의 snapshot으로 판정한다. `닫기`는 저장 버튼이 아니며 적용 중에는 비활성화한다. 재연결 중에는 저장 성공을 추정하지 않는다.
- 전투 준비 화면은 다음 목표, 필수 성장 선택, 전투 시작을 먼저 배치한다. 미사용 보상은 확인 경로를 제공하되 필수 준비 조건으로 취급하지 않는다. 전체 진행도와 Collection은 접을 수 있다.

## Combat HUD — 상단 목표·라운드, 우측 정보와 전체 화면 캐릭터 상세

- 기본 화면은 1024×768 가로다. 상단 `hud-status`는 Objective → Round·우선권을 한 줄로 표시한다. 긴 목표나 우선권은 내부에서 가로 스크롤한다. 우측 `ui-combat-sidebar`에는 현재 행동자·남은 Actions·요청 상태·상세 버튼·End Turn·대상 안내와 접이식 로그를 배치한다. 폭은 236–292px 범위에서 화면에 맞춘다.
- 행동 설명·예상 결과·실패 이유와 로그는 사이드바 안에서 펼친다. 긴 내용은 내부 스크롤하며 전장 크기를 바꾸지 않는다. 보드와 Ring 모두 실제 HUD gutter를 사용해 상단과 우측 패널을 피한다.
- 손패 소유자와 Hand/Deck/Discard는 전장 하단에 둔다. 부채꼴 손패의 펼침·접힘, 짧은 탭 실행과 상세 모드 열람 계약을 유지한다.
- 배치 클래스는 `ui-combat-sidebar`, `ui-combat-action-bar`, `ui-combat-action-preview`, `ui-combat-log`다. 공통 외형은 `ui-panel`, `ui-button`과 modifier·테마 토큰을 사용한다.
- 공통 `CharacterDetailPanel`은 로비·준비·전투의 전체 화면 DOM 모달에 재사용한다. `ui-character-detail-dialog--fullscreen`은 100vw × 100dvh를 사용한다. 첨부 레퍼런스에 맞춰 상단 좌측은 Level·XP·이름·능력치·AC·HP·방패·내성, 상단 우측은 Traits·Condition, 하단 좌측은 Class DC·Perception·Initiative·Skills, 하단 중앙부터 우측은 장비·카드를 배치한다. 탭 전환이나 큰 Standee 없이 정보를 함께 읽는다.
- `ui-character-detail--sheet` 변형과 `ui-character-detail__*` 하위 클래스로 공통 스타일을 적용한다. 앱 전체 색상은 공통 `--ui-*` 토큰에서 수정한다. 상세창의 `--sheet-background`, `--sheet-panel`, `--sheet-border`, `--sheet-accent`, `--sheet-muted`는 해당 토큰의 별칭이며, 상세창만의 명시적 변형이 필요할 때에만 theme layer에서 재정의한다. 각 영역은 독립 스크롤하고 카드 면은 2:3을 유지한다.
- 모든 수치는 공통 resolver에서 가져온다. 준비에서는 최대 HP, 전투에서는 현재 HP·Condition·Facing·Reaction·방패 올림 상태를 표시한다. Creature에 없는 능력치·숙련도·XP와 미지원 Size·방패 내구도는 임의로 만들지 않는다. 장비와 카드 목록은 현재 장착·덱 기여에서 읽으며 이 창에서는 변경하지 않는다.
- 우측 상세 버튼·우선권 초상·Ring의 캐릭터 상세로 연다. 대상 선택은 조작 캐릭터·손패 소유자·공격 대상을 바꾸지 않는다. 닫기/Esc는 열람 전 입력으로 복귀하되, 서버 상태 변경으로 무효화된 선택은 복원하지 않는다.
- 상세창은 최신 snapshot으로 갱신하며 온라인 전투를 일시정지하지 않는다. 본인이 응답할 Reaction과 전투 종료 시 닫는다. 관전자는 대기 중에도 열람할 수 있다. 모달 입력은 뒤쪽 전장으로 전달하지 않으며 닫을 때 진입 버튼으로 포커스를 돌린다.
- **적 상세는 Recall Knowledge 성공 이후에만 공개한다.** 상세 버튼·초상·Ring·모달 대상 선택이 공통 `canInspectActor`를 사용한다. 성공은 현재 전투의 파티 전체에 공유하며 실패한 캐릭터는 같은 적에게 재시도할 수 없다. 판정과 해금은 서버 상태가 소유한다. 규칙·저장 호환성은 [구현 기록](docs/issue-59-combat-sheet.md)을 따른다.


## 전투 입력·보상·종료의 확정 계약 (#59 7–11)

- 손패의 `카드 상세 보기`와 Ring의 `행동 상세 보기`는 명시적인 읽기 모드다. 해당 모드의 tap은 실행하지 않으며 사용 불가 카드도 읽을 수 있다. 일반 모드에서는 즉시 실행/대상 선택 문구로 다음 입력의 의미를 안내한다.
- 잘못된 대상은 선택을 해제하지 않는다. 공용 `validateActionIntent`가 거리·대상 종류·가림·이동 불가 이유를 반환한다.
- 남은 Action이 있을 때 End Turn은 계속 행동/턴 종료 확인을 거친다. 취소는 기존 선택을 보존한다. 0 Action에는 이 확인을 생략한다. 마지막 제자리 Step은 서버가 선택된 facing을 유지하며 같은 명령에서 턴을 넘긴다.
- Reaction 결정권자만 결정 모달을 받는다. 관전자는 담당자 이름을 포함하는 비차단 대기 표시와 공통 상세를 사용한다. 재연결·처리 대기는 별도 상태로 표시한다.
- 보상 tap은 초안 선택이다. 공용 Loadout 미리보기로 캐릭터별 준비 가능 여부와 변화를 확인하고 `이 보상 획득`으로 확정한다. 획득 후에도 자동 장착하지 않으며 ACK와 적용 snapshot 전에는 성공을 표시하지 않는다.
- 성장 선택은 필요 수와 modifier/DC 등 공용 계산기의 실제 변화를 보여준다. 관전자에게는 성장 담당자를 표시한다.
- 완료·패배는 `시작 화면으로`를 제공한다. 브라우저의 재접속 자격만 해제하고 저장된 모험은 삭제하지 않는다. 초기화 실패는 보이는 오류와 페이지 재시도를 제공한다.

## 상태 효과와 수치 변화

- 공통 `conditionEffects()`가 Grabbed → Immobilized·Off-guard, Prone → Off-guard를 파생한다. 하위 효과는 독립 저장 상태나 삭제 가능한 Condition이 아니다. 상위 상태를 해제하면 함께 사라진다.
- Off-guard의 AC −2는 공통 modifier stack을 통한다. Grabbed·Prone·후방·협공이 겹쳐도 같은 circumstance 패널티는 중첩되지 않는다. Prone의 기존 Stand 후 이동 규칙을 유지한다.
- 상세창 Condition은 상위 이름과 간략한 하위 효과 목록을 표시한다. 실제 수치 계산은 기존 공통 resolver를 사용한다.
- 현재 장비·레벨은 유지하고 Condition·Raised Shield를 제외한 값을 비교 기준으로 삼는다. AC·내성·Class DC·Perception·Initiative·스킬·공격·피해 보정에서 감소는 빨강, 증가는 초록, 최종 차이가 없으면 기존 글자색이다. HP 소모와 능력치 원본은 버프/패널티로 해석하지 않는다.
- `ui-stat-change[data-change="decrease|increase"]`는 공통 의미 색상 `--ui-color-error-text` / `--ui-color-status-text`를 사용한다. 방향 화살표를 함께 보여주며, hover 또는 탭·키보드 활성화로 기준값 → 현재값과 실제 적용된 원인을 읽는다. 중첩에서 제외된 보정은 적용 원인으로 표시하지 않는다.
- Frightened의 기존 값·판정은 유지한다. 이번 변경에 수치 증감이나 상태 수동 추가/삭제 버튼은 포함하지 않는다.

## 우측 전투 요약의 Condition / Saves

- 현재 행동자의 Condition 칩과 `Fort / Ref / Will` 보정치를 상세 버튼 바로 위에 배치한다. 상위 Condition만 칩으로 표시하고 상태가 없으면 해당 줄을 숨긴다. 내성은 3열 한 줄을 유지한다.
- 칩을 탭하면 파생 효과 또는 현재 보정 설명을 읽는다. 내성을 탭하면 전체 이름, 기준값 → 현재값, 적용 근거를 읽는다. 설명은 패널 내부에서 열고 닫으며 게임 명령을 보내지 않는다.
- `actor-effect-view.ts`의 공통 수치 비교·색상·버튼·Condition 설명을 전체 상세창과 공유한다. 내성도 감소는 빨강, 증가는 초록, 변화가 없으면 기본 글자색이다.
- 요약은 최신 snapshot을 따라가며 손패 소유자와 별도로 현재 행동자 정보를 표시한다. 아직 Recall Knowledge로 해금하지 않은 적의 요약은 숨긴다.
- 배치는 `ui-combat-actor-summary`와 `__conditions / __saves / __note`, 수치 표현은 공통 `ui-stat-change`를 사용한다. 상태 칩과 내성 버튼은 최소 44px 입력 높이를 유지한다.

## Condition과 내성의 외형 구분

- Trait은 기존 작은 캡슐형을 유지한다. Condition은 공통 `ui-condition-chip`으로 모서리 4px의 사각형과 4px 좌측 색상 띠를 사용한다. HUD와 전체 상세창이 같은 외형을 공유한다.
- 적용 효과에 이동 제한 또는 음수 보정만 있으면 `data-tone="harmful"`(어두운 적색 배경·밝은 적색 띠), 양수 보정만 있으면 `beneficial`(어두운 녹색 배경·녹색 띠)이다. 혼합·불명·효과 없음은 중립색으로 표시한다. 분류는 표시 용도이며 판정을 변경하지 않는다.
- HUD 내성은 공통 `ui-save-tile` 3개로 표시한다. `__label`은 상단 11px FORT/REF/WILL, `__value`는 하단 굵은 22px 숫자다. 높이는 66px 이상이고 타일 전체를 탭할 수 있다. 숫자의 점선 밑줄은 제거한다.
- 타일 배경은 `--ui-save-surface`(`#344457`), 테두리는 `--ui-save-border`를 공유한다. 숫자의 감소·증가 색상과 방향 표시는 기존 공통 `ui-stat-change`를 유지한다. 공통 외형은 components layer, HUD 배치는 screens layer가 소유한다.

## 캠페인 삭제

캠페인 행의 이어하기 옆에 `.ui-button.ui-button--danger` 삭제 버튼을 둔다. 비어 있거나 읽을 수 없는 저장도 삭제 가능하다. `.ui-panel.ui-panel--dialog.campaign-delete-dialog` 확인창은 모험 이름, 영구 삭제와 참가자 연결 종료를 안내하며 최초 포커스는 취소에 둔다. Escape/취소는 요청 없이 닫고 원래 버튼으로 돌아간다. 확정 요청 중에는 목록 조작을 잠그며 실패 시 재시도할 수 있다. 성공 시 해당 행을 제거하고 마지막 행이면 빈 목록 안내를 표시한다.

삭제 API는 소유자만 허용하며, 이어하기와 같은 캠페인별 직렬 큐를 사용한다. 이미 수락한 저장 작업과 세션 종료를 기다린 뒤 캠페인 행 및 그 안의 저장 데이터를 삭제한다. 저장소 오류로 삭제가 실패하면 행은 유지되지만 종료된 세션은 복구하지 않는다. 사용자는 삭제를 재시도하거나 유효한 저장으로 이어갈 수 있다.
