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

기본 테마 수정은 `tokens.css`의 의미 있는 변수부터 변경한다.

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
- `tests/unit/browser/ui-theme.spec.ts`는 실제 컴포넌트에 root 토큰을 바꿔 공통 적용, 변형, 상태, layer 우선순위를 검증한다.
- DOM 클래스 변경 시 기존 Browser Unit과 해당 E2E의 동작·선택자를 확인한다. 상태를 주입한 검사는 E2E로 분류하지 않는다.
- `npm run check`, `npm run build` 및 영향받는 브라우저 검사를 수행한다.

## 캠페인 목록과 재참가

- `campaign-*`는 넓은 요약 카드 목록의 배치, `resume-*`는 저장된 파티와 현재 참가자 관계의 배치를 담당한다. 기본은 1024×768 가로 모드이며 넓은 화면에서는 최대 76rem까지 확장한다.
- 요약 카드와 캐릭터 패널은 `ui-panel ui-panel--workspace campaign-card` 또는 `ui-panel ui-panel--workspace resume-character`처럼 기본·변형·화면 클래스를 함께 사용한다. 게임 카드의 `.card-face`와 구분한다.
- 동작은 `ui-button`과 기존 modifier를 사용한다. 카드 자체를 클릭 대상으로 만들지 않고 별도 버튼으로 실행한다. 특색 있는 외형이 필요하면 `ui-button ui-button--이름`으로 확장한다.
- 선택한 캐릭터는 `data-claim-state="mine"`으로 표시한다. 참가자의 선택과 실제 조작 담당자는 별도로 표시하며, 외형만으로 조작 권한을 판정하지 않는다.
