# 피난문 파괴 목표 식별

목표 나무·바위가 일반 장애물과 똑같아 보이던 문제를 수정했다. 지정된 파괴 목표만 **금색/검정 이중 타일 윤곽선 + 마름모 아이콘 + `파괴 1`/`파괴 2` 라벨**로 표시한다. 색을 구분하지 않아도 문자·번호·윤곽선으로 식별할 수 있다. 표식은 기존 전장 오버레이에 붙고 화면 픽셀 크기를 유지하며 카메라와 높이 투영을 따른다. 아트·깊이 정렬·지형 투명화는 변경하지 않았다.

상단 Objective HUD에는 `파괴 목표 0/2 완료 · 남은 2`가 표시된다. 타일에 마우스를 올리거나 링을 열면 기존 행동 상세/링 제목에 `파괴 목표 1 · 서쪽 피난문 나무`처럼 이름과 목표 여부를 표시한다. 일반 나무/바위에는 목표 표식이나 목표 접두사를 붙이지 않는다.

표시·진행 수는 전투 상태의 `rules.victory.objectIds`와 해당 오브젝트의 `used`에서 도출한다. 별도 목표 목록이나 저장 필드를 추가하지 않았다. 실제 승리 판정과 같은 ID를 사용하고, 서버 snapshot으로 파괴가 확정되면 그 목표 표식만 제거한다. 번호는 완료 여부와 무관하게 원래 목표 순서를 유지한다. 남은 바위는 나무 파괴 후에도 `파괴 2`이다. 콘텐츠·전투 규칙·프로토콜을 변경하지 않아 이 변경으로 기존 콘텐츠 fingerprint가 바뀌지 않는다.

## 검증

- 선택 Domain: 실제 정상 파괴 명령, 일반 장애물 제외, 목표 상태/번호, save/Resume 복원.
- 선택 Interaction: 현재 배포 build, 1024×768 Chromium/Canvas. 목표 두 곳의 실제 픽셀, 일반 오브젝트와 목표의 호버 문구, 목표 링 입력, ACK만 수신했을 때 기존 값 유지, snapshot 이후 `남은 1`과 첫 표식 제거, 새 페이지 Resume에서 두 번째 표식 유지. 화면에서 직접 읽기 확인.
- 중간 진단: 대각선 장애물은 기존 파괴 인접 조건에 맞지 않아 테스트 준비 이동을 수정했다. 링의 절대 배치 컨테이너는 면적이 없으므로 visible 검사 대신 실제 파괴 버튼의 enabled 상태를 확인했다. timeout·전투 규칙은 변경하지 않았다.
- 최종 로컬 전체 gate: `CI=true npm run check && CI=true npm run test:all` 한 번의 연속 실행이 종료 코드 0으로 통과했다. Domain 170 + Integration 33 + Interaction 85 + Journey 5 = **293개 통과**. 기존 스탠디 사각형/union/숨김/이동/카메라/높이 0 회귀도 포함한다. [전체 실행 로그](visual/destruction-objectives/final-gate.log). GitHub CI는 실행하지 않았다.
- GPU 브라우저·실제 기기의 터치 조작은 미검증이다. 화면 자료는 최종 전체 gate 실행에서 수집했다.

[파괴 전](visual/destruction-objectives/gate-targets-before.png) · [첫 목표 파괴 후](visual/destruction-objectives/gate-targets-after.png) · [Resume 후](visual/destruction-objectives/gate-targets-resumed.png)

실제 게임의 챕터 1-3 `피난문 봉쇄`에서 확인한다. 개발 미리보기는 `npx vite --host 127.0.0.1 --port 4195 --strictPort`로 실행하고 [피난문 봉쇄 미리보기](http://127.0.0.1:4195/terrain-preview.html?renderer=canvas&scenario=encounter.willow-gate)를 연다. 최종 확인 시 4195 서버를 실행해 두었다. 미리보기는 전장 표식을 확인하는 용도이며 HUD 진행 상태·저장 복원은 실제 게임 UI 검증 화면에 보존했다. 개발 DB를 열거나 삭제하지 않았으며 커밋·푸시·배포하지 않았다.
