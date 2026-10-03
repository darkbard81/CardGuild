# 챕터 1 지형 높이

높이 원본은 `presentation/m3/terrain-elevations.json`이다. 각 맵은 20×20이며 배열 한 줄이 맵의 한 행이다. 좌표는 `(x, y)`, 북쪽은 작은 `y`다.

| 스테이지 | 배치 의도 | 미리보기 |
| --- | --- | --- |
| 1-1 버드나무 숲길 | 남쪽 진입부 1, 연못 수면 0, 북쪽 능선 2~3과 동쪽 언덕 2 | [숲길](willow-rescue.png) |
| 1-2 연못 둑 사격진지 | 수면 0, 서쪽 진입부 1, 동쪽 둑 2~3. 두 목표 궁수의 위치는 모두 3 | [연못 둑](willow-dike.png) |
| 1-3 피난문 봉쇄 | 남쪽 진입부 1, 두 갈래 접근로와 봉쇄선 2, 북쪽 진지 3. 남서 연못은 0, 북동 연못은 1 | [피난문](willow-gate.png) |
| 1-4 윌로우브룩 광장 | 남쪽 거리 1, 주변 대지와 광장 앞 계단 2, 지휘관·마법사가 있는 중앙 광장 3 | [광장](willow-square.png) |

모든 타일은 0~3, 인접 타일의 단차는 대각선을 포함해 최대 1이다. 각각 연결된 연못은 평평하다. 세 명의 시작 위치는 모두 높이 1이다. 높이는 표시·피킹·가림 처리에만 적용되며 이동 비용, 사거리, 시야, 승리 조건에는 영향을 주지 않는다.

숲의 풀·흙길·낙엽 타일에는 각각 생성한 흙층 측면 이미지를 적용했다. 원본·프롬프트·배포 파일 재생성 방법은 `art/source/terrain-sides/README.md`, 재질 연결은 `presentation/m3/terrain-sides.json`에 있다.

이미지는 개발 전용 `terrain-preview.html?renderer=canvas&scenario=encounter.willow-…`에서 1440×1000으로 촬영했다. 미리보기는 기본 파티 규모를 사용한다. 실제 전투 UI의 1024×768 숲길 장애물 파괴·이동도 Interaction으로 확인했다. 이 캡처는 WebGL 또는 실제 iPad 검증을 의미하지 않는다.

2026-10-03 최종 검증: 높이 배치의 관련 Interaction 6개 통과. 측면 이미지 추가 후 최종 `CI=true npm run check && CI=true npm run test:all`도 통과했다. Domain 162, Integration 28, Interaction 78, Journey 4개가 모두 통과했다. GitHub CI는 실행하지 않았다.
