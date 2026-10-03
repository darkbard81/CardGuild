# 높이 지형 미리보기

기존 상단 source 256×256 / runtime 128×128, 중심 anchor와 one-cell footprint는 유지한다. 높이는 전투 규칙과 분리된 presentation 데이터이며 jump·고저차 이동·LOS는 후속 범위다. 기존 캠페인 저장 형식, content identity와 DB는 변경하지 않는다.

## 열기와 작성

`npx vite --host 127.0.0.1 --port 4195 --strictPort` 실행 후 `http://127.0.0.1:4195/terrain-preview.html`을 연다. 개발용 페이지는 production build의 진입점에 포함되지 않는다. 실제 게임의 BattleView, 배우·상단 타일·카메라와 입력 경로를 사용한다.

맵을 고르고 타일을 클릭하여 0~8 정수 높이를 입력한다. 한 단계는 카메라 scale 1에서 수직 32px이다. 예제는 0/1/2/4를 배치한다. 휠은 확대, Alt+드래그 또는 가운데 버튼은 이동이다. 노출된 측면은 선택되지 않는다. JSON을 내보내고 다시 불러올 수 있으며 잘못된 파일은 현재 미리보기를 변경하지 않는다.

내보낸 JSON을 `presentation/m3/terrain-elevations.json`에 저장하면 게임에 적용된다. `maps`의 키는 scenario ID이고 값은 row-major, width×height 길이의 높이 배열이다. 비어 있는 maps와 생략한 맵은 기존 높이 0을 유지한다. 이 파일은 authored 입력이므로 assets:build가 덮어쓰지 않는다. 상단 재질은 기존 tilemap palette/layer와 타일 상태를 따른다. 미리보기는 게임 서버에 연결하지 않고 개발 DB를 읽거나 쓰지 않는다.

## 면과 깊이

south 면은 화면 왼쪽(어두움), east 면은 오른쪽(밝음)이다. 노출 길이는 max(0, 자기 높이−앞 이웃 높이)이며 바깥 이웃은 0이다. 각 기둥은 자기 상단 지형의 재질만 사용한다. 층을 반복하거나 높이에 따라 세로 텍셀을 늘리지 않고, 128×256 긴 시트의 (0,0)에서 노출 길이×32만큼 자른다. 높이가 바뀌어도 상단에 닿은 무늬의 기준과 픽셀 밀도가 유지된다.

높이가 있는 맵은 타일·소품·배우를 지면 기준 깊이로 함께 정렬한다. 화면의 올려진 y를 정렬 기준으로 사용하지 않는다. 타일 강조도 같은 깊이에 붙인다. 선택은 앞 타일부터 상단과 노출 측면을 검사하여 가려진 뒤 타일이 선택되는 것을 막는다. 배우는 기존 이동 이벤트를 따라 보간하며 표시 높이만 보간한다. 규칙의 이동 비용·경로는 유지한다.

## 측면 아트 교체

현재 측면은 기존 stone/rubble/chasm/wall/gate 색에 맞춘 **절차적 석재 아트 초안**이다. 상단 원본 이미지를 변경하거나 복제해 세로로 늘리지 않는다. 별도 이미지 생성은 실행하지 않았다.

독립 측면 이미지는 128×256 PNG 또는 WebP(투명 여부 자유), 수직 연속 무늬, 위쪽 y=0이 타일과 맞닿는 기준이다. 좌우는 같은 중립 이미지에 renderer tint를 적용하므로 두 파일을 만들 필요가 없다. `/public/assets/terrain-sides/`에 두고 `presentation/m3/terrain-sides.json`의 `materials`에 상단 asset ID → `/assets/terrain-sides/name.png`를 등록한다. 예: `terrain.stone-floor`, `terrain.rubble`, `terrain.chasm`, `terrain.wall-block`, `terrain.gate.closed`, `terrain.gate.open`. 빈 materials는 절차적 초안을 사용한다. 측면은 기존 정사각 상단 atlas/validator와 독립적이며 check-assets와 런타임이 규격을 검사한다.

참조 상단 파일은 `art/source/terrain/{stone-floor,rubble,chasm,wall-block,gate-closed,gate-open}.png`다. 최대 8단을 지원하므로 시트 전체 높이가 256px이며 더 높은 기둥은 파일 검증에서 거부한다.

## 검증

Domain은 기본값·파일 왕복/거부·재질 참조·노출면·높이 좌표/pan/zoom을, Interaction은 실제 화면 입력과 JSON 복원을 소유한다. 기존 빈 maps의 게임 흐름은 기존 Journey 및 전체 gate로 확인한다. 실물 touch 장치/Safari는 별도 미검증이며 Chromium 1024×768 화면 검수는 실물 장치 검증을 대신하지 않는다.


## 캐릭터 앞 지형 투명화

선택 여부와 관계없이 표시 중인 모든 캐릭터의 스탠디 이미지 **전체 사각형**(투명 여백 포함)을 사용한다. 각 지형 기둥보다 먼저 그려지는 캐릭터의 사각형만 합쳐, 그 영역 안의 상단/측면을 alpha 0.15로 그린다. 영역 밖과 캐릭터 뒤의 지형은 원래대로 유지한다. 알파 실루엣·타원·캐릭터 복사본은 사용하지 않는다. 서로 겹치는 캐릭터 사각형은 비중첩 영역으로 합쳐 같은 지형에 투명도가 두 번 적용되지 않는다. 여러 앞쪽 지형층은 각자의 draw 순서에서 한 번씩 합성된다.

숨긴 display/body(visible·renderable·alpha 0, 부모 포함)는 마스크 입력에서 제외한다. 이동 보간과 pan/zoom 시 깊이 정렬 후 마스크를 갱신하고, 방향·크기는 현재 body bounds에 따른다. 같은 재질/노출면의 기둥 RenderTexture는 공유·재사용하며, 지형 교체/높이 0 복귀/destroy에서 사용이 끝난 RT를 해제한다. 사각형 안/밖을 명시적으로 나누므로 Canvas에서도 GPU filter나 inverse mask 없이 작동한다.

미리보기의 **모든 캐릭터 가림 예제**, **예제 캐릭터 방향**, **캐릭터 앞 지형 투명화** 체크박스로 두 캐릭터의 ON/OFF를 비교할 수 있다. `?renderer=canvas`는 Canvas를 강제하며, 기본 URL은 WebGL을 우선한다. 화면의 현재 렌더러 표시로 실제 경로를 확인한다.

2026-10-03 재검증의 실제 전장 정면·후면·반전 ON/OFF와 카메라 화면은 [docs/visual/terrain-elevation](visual/terrain-elevation/)에 보존한다. 숫자 픽셀 검사는 두 스탠디 중첩에서도 `[217,0,38]`(붉은 캐릭터 위 파란 지형 15%), 투명 여백에서 `[0,217,38]`, 영역 밖 불투명 파란색을 확인한다. 실제 아트의 ON→OFF→ON은 같은 전장 픽셀로 복원되고 높이 0에서는 ON/OFF 차이가 없다.

이 환경의 Chromium은 WebGL 컨텍스트 생성에 실패했다(`BindToCurrentSequence failed`; 일반 Chromium/SwiftShader 설정 모두). **Canvas 검증은 완료 대상이며 실제 GPU/WebGL·WebGPU·실물 touch·Safari 비교는 미검증**이다. 해당 환경에 대한 통과로 해석하지 않는다.


### 지형 작업 단계의 로컬 gate (2026-10-03)

Node 24.18.1 / npm 11.16.0, 챕터 1 첫 맵 추가 이전의 `issue-62` 미커밋 코드 상태에서 `CI=true npm run check && CI=true npm run test:all`을 한 번 연속 완주했다. 콘텐츠·에셋·TypeScript·ESLint·클라이언트/서버 build 통과, Domain **149**, Integration **27**, Interaction **75**, Journey **4**로 총 **255개 통과**, 실패·skip 없음. 해당 코드/테스트는 실행 중 변경하지 않았다. 이후 챕터 1 첫 맵이 추가되었으며, 이를 포함한 최신 전체 gate는 [챕터 1 완성 기록](chapter1-complete.md)을 따른다. `git diff --check`도 통과했다. 이는 GitHub CI 결과를 대신하지 않는다.

- [정면 ON](visual/terrain-elevation/production-south-on.png) / [정면 OFF](visual/terrain-elevation/production-south-off.png)
- [후면 ON](visual/terrain-elevation/production-north-on.png) / [후면 OFF](visual/terrain-elevation/production-north-off.png)
- [후면 반전 ON](visual/terrain-elevation/production-west-on.png) / [후면 반전 OFF](visual/terrain-elevation/production-west-off.png)
- [실제 휠 확대·pan 후 ON](visual/terrain-elevation/production-camera-on.png)
- [사각형/알파 수치 검사 장면](visual/terrain-elevation/standee-canvas-pixels.png)

위 화면은 이번 최종 gate의 Interaction 실행에서 생성한 1024×768 Canvas 증거다(수치 fixture는 deviceScaleFactor 2). 정면·후면·반전에서는 선택된 캐릭터가 없고, 전장 픽셀의 ON/OFF 차이 및 다시 ON으로 복원했을 때 차이 0을 검사했다. 기존 높이 0 게임은 기존 Interaction/Journey를 포함한 전체 gate로 확인했다. 스크린샷 육안 검수에서도 원본 캐릭터, 사각형 경계 및 영역 밖 불투명 기둥을 확인했다.
