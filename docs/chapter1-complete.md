# 챕터 1 · 윌로우브룩 구출

기본 모험 `adventure.willowbrook`은 기존 Android 튜토리얼 4개 다음에 아래 **4개 필드 인카운터**를 진행하고 마지막 보상을 받으면 완료된다. 챕터 도중 파티·적 모두 레벨 1을 유지한다. 이전 장기 탐험 `adventure.goblin-trouble`과 콘텐츠는 삭제하지 않고 staged/reserve로 보존했다. 출시 정책의 도달성 하한은 이 완결 범위를 명시하며 범용 콘텐츠 검증은 유지한다.

| 전투 | 목표·동선 | 보상 |
| --- | --- | --- |
| 1-1 버드나무 숲길 | 기존 숲길의 용병 전멸, 연못 우회·장애물 지름길 | Sickle |
| 1-2 연못 둑 사격진지 | 연못 양 끝으로 우회하여 두 궁수 격파. 호위병 생존 허용 | Needle Darts |
| 1-3 피난문 봉쇄 | 서쪽 피난문 나무와 동쪽 피난문 바위를 모두 파괴. 전멸만으로 완료되지 않음 | Dueling Cape |
| 1-4 윌로우브룩 광장 | 골목·광장의 전사 지휘관과 마법사 격파. 잔여 용병 철수 | Shield |

모든 필드 맵은 20×20, 잔디·흙·낙엽과 보행 불가 연못, 파괴 가능한 나무·바위로 구성한다. 마지막 맵의 집은 보호할 보금자리이며 비파괴 장애물이다. 기존 성인 여성 다크엘프 4종의 앞·뒤 스탠디와 사용자 요청 체형·투피스 의상은 그대로 사용한다. 1–3인 배치에서 필수 목표는 항상 존재한다. 튜토리얼의 HP 하한·보장 판정은 필드에 적용하지 않는다.

목표는 `ScenarioRules.victory`의 적·오브젝트 ID 집합이며 모든 목표를 AND로 평가한다. 생존 영웅이 없으면 패배가 우선한다. 기존 행동/피해 처리의 결과 판정, 저장과 리플레이를 사용한다. ID 누락·빈 목표·필수 적의 인원별 누락·이미 사용한 목표는 콘텐츠 검증에서 거부한다.

각 보상은 기존 authoritative reward 명령으로 한 번만 받는다. 마지막 보상 이전에는 reward 단계이고 이후 complete가 된다. 완료 화면에서 주민 귀환과 Aerin의 감사가 표시된다. **보상·장비 정리**에서 소유 장비와 카드를 편성하고 저장할 수 있으며 전투를 다시 시작하거나 경험치를 추가로 받을 수 없다. 원래 조작권·소유량·중복 준비 제한은 유지한다.

## PF2e 근거와 CardGuild 적용 범위

2026-10-03 Archives of Nethys의 원문 항목을 확인했다. Paizo 원본 그림을 복사하지 않고 새 이미지를 생성했다.

- [Sickle — Player Core p.277](https://2e.aonprd.com/Weapons.aspx?ID=364): 단순 한손 근접 무기, 1d4 베기, Agile/Finesse/Trip. 게임은 기존 주손 슬롯·민첩/기교 계산을 사용하며 Trip 특성이 Trip 카드를 덱에 추가한다. 가격·무게·손 점유는 모델링하지 않는다.
- [Needle Darts — Rage of Elements p.144](https://2e.aonprd.com/Spells.aspx?ID=1375): 1랭크 캔트립, 2행동, 60ft, 주문 공격으로 3d4 관통, 치명타 두 배. 기존 게임의 주문 공격 경로인 Arcana(INT) 대 AC를 사용한다. 원문의 지속 출혈, 사용 금속에 따른 약점, Heighten은 구현하지 않았고 카드에 명시했다. PF2e의 클래스별 주문 시전자 능력치/전통별 습득 규칙을 재현하지 않는다.
- [Dueling Cape — Player Core p.288](https://2e.aonprd.com/Equipment.aspx?ID=2721): 0레벨 장비. 원문은 팔에 두른 망토를 1행동으로 세워 다음 턴까지 AC와 Feint에 상황 +1을 준다. 게임은 준비 시 방어구 보조 슬롯에 장착하고 기존 Raise Shield로 AC +1만 적용한다. Feint·팔에 두르는 별도 Interact·가격/무게는 생략한다.
- [Shield — Player Core p.356](https://2e.aonprd.com/Spells.aspx?ID=1671): 1행동, 손 없이 다음 자기 턴 시작까지 AC 상황 +1. 게임은 기존 `warded` 상태의 만료·보너스 중첩 규칙을 사용한다. 원문의 Shield Block, Hardness 5, Block 후 10분 재시전 제한, Heighten은 구현하지 않는다. 카드에 Shield Block 미제공을 명시한다.

동일한 종류의 AC 상황 보너스는 기존 modifier stack에 따라 중복 가산하지 않는다. 새 카드 두 장은 클래스별 주문 목록을 도입하지 않고 기존 보유/준비 카드 규칙을 따른다.

## 에셋·미리보기

새 낫·망토·두 주문 카드·집·마을 배경 원본과 실제 생성 프롬프트는 `art/source/chapter1-completion-originals/`에 보존했다. 주문은 인물 없는 금속 바늘/마법 방패 장면이다. 카드 원본 1024×1536 PNG → 512×768 WebP(기존 Lanczos3, quality 85, effort 6); 런타임은 WebP만 필요하다. 생성 도구 메타데이터는 직접 사용한 built-in image_gen으로 기록했다.

Vite가 켜져 있으면 다음 주소로 지형과 전장을 바로 볼 수 있다. 4195 서버가 없으면 `npx vite --host 127.0.0.1 --port 4195 --strictPort`를 실행한다. 실제 새 모험에서는 네 튜토리얼을 마친 뒤 순서대로 진입한다.

- <http://127.0.0.1:4195/terrain-preview.html?renderer=canvas&scenario=encounter.willow-rescue>
- <http://127.0.0.1:4195/terrain-preview.html?renderer=canvas&scenario=encounter.willow-dike>
- <http://127.0.0.1:4195/terrain-preview.html?renderer=canvas&scenario=encounter.willow-gate>
- <http://127.0.0.1:4195/terrain-preview.html?renderer=canvas&scenario=encounter.willow-square>

## 검증 기록

최종 **`CI=true npm run check && CI=true npm run test:all` 연속 완주, exit 0** (2026-10-03 02:46 UTC). Node 24.18.1 / npm 11.16.0. Domain **161**, Integration **28**, Interaction **80**, Journey **4**, 합계 **273건 통과**, 실패·skip 없음. 코드/콘텐츠/테스트는 실행 중 변경하지 않았고 이후에는 문서와 화면 증거만 저장했다. 최종 콘텐츠는 `cardguild.m7@0.15.0`, `fnv1a64:7e76bb1c603c45da`이다. [전체 로그](visual/chapter1-complete/final-gate.log).

Domain 6.19초, Integration 13.41초, Interaction 4.5분, Journey 24.7초였다. 이 장비의 `test:all` 실측은 총 약 5분 20초로 현재 GitHub CI의 5분 step 상한보다 길다. CI 자체는 실행하지 않았으므로 CI 통과를 주장하지 않는다. 개별 timeout이나 worker 수를 늘려 실패를 숨기지 않았으며 CI 환경의 실행 시간은 별도 확인이 필요하다.

[연못 전투](visual/chapter1-complete/chapter-2.png) · [피난문 전투](visual/chapter1-complete/chapter-3.png) · [광장 전투](visual/chapter1-complete/chapter-4.png) · [엔딩](visual/chapter1-complete/chapter-ending.png) · [완료 후 Shield 준비/저장](visual/chapter1-complete/chapter-shield-prepared.png). 전체 지형 화면도 같은 디렉터리에 보존했다. 모든 화면은 실제 Chromium/Canvas 실행에서 캡처했다.

- Domain: Shield의 1행동·AC 상황 +1/망토와 비중첩·다음 턴 만료, 목표 AND/잔여 적 생존, 잘못된 목표 참조·인원별 누락, 지형·연결성, 각 보상 한 번 지급, 완료 후 소유량·조작권·덱 편성 및 재출발 거부. 피난문 두 개를 실제 명령으로 파괴하여 승리·리플레이 확인.
- Integration: 독립 임시 SQLite에 각 보상 대기 상태와 완료 후 편성을 저장하고 close/reopen/Resume로 복원.
- Interaction: 새 전투 세 곳의 안내→출발, 마지막 보상 획득 ACK/snapshot→엔딩→Shield 편성 저장. Journey 4건은 기존 실제 튜토리얼/숲길 진입·협동·서버 재시작/Resume 연결을 검증한다. 네 필드 전투 전체의 연속 완료는 아래 엔진 자동 플레이이며 브라우저로 네 전투를 모두 수동 입력한 검증과 구분한다.
- 제한 연속 플레이: [실행 결과](visual/chapter1-complete/playthrough.json). 전사·레인저·위저드 + Aerin, seed 1–3, 실제 행동/AI/RNG/리플레이. 튜토리얼 완료만 테스트 사전조건이며 필드 HP/주사위는 바꾸지 않았다. 9회 중 5회는 네 전투·보상·완료를 통과, 4회는 첫 숲길에서 패배, 정체 0. 마지막 보상까지 실제 지급하며 기존 시작 장비를 유지했다. 승률 추정이나 모든 직업/인원 조합의 밸런스 보증은 아니다.

이전 콘텐츠 fingerprint의 자동 저장 마이그레이션은 기존 정책대로 등록하지 않았다. 기존 개발 DB는 열거나 삭제하지 않았다. GPU 브라우저/실제 태블릿 검증은 미실행이며 Canvas를 사용한다. 커밋·푸시·배포는 하지 않는다.
