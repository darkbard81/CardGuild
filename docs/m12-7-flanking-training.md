# M12-7 협공 훈련 (#69)

Production 순서는 `guild-practice → prone-training → Aerin 모집 → flanking-training → spear-line ...`이다. 기존 encounter를 유지하고 세 번째에 3×3 open grid를 추가했다. 기존 `enemy.android-trainee` 한 체와 `companion.aerin → hero.aerin`을 재사용하며 신규 Actor/아트는 없다. 초기 두 아군은 같은 편에서 시작하므로 이동 없이 협공이 성립하지 않는다. 출발은 2인만 허용한다.

1-3 보상은 EXP 50이며 별도 선택 보상은 없다. 승리하면 Spear Line 준비로 이동한다. 전체 10 encounter, tutorial prefix 6개, 기존 Lv.2/Lv.3 milestone은 6/9승으로 이동했다. 두 캐릭터의 실제 identity·성장 및 기존 Host/Guest 조작권을 그대로 전달한다. 저장 loadout은 유지하고 아래 임시 무기 규칙만 Combat에 적용한다.

## 피해와 보호

`ScenarioRules.damageRequiresFlanking: "enemies"`를 이 encounter에만 선언한다. 피해를 주는 Actor와 받는 Actor의 관계를 기존 `resolveOffGuardTo()`로 평가하며 `flanking` 원인이 없으면 최종 피해를 0으로 만든다. 위치 조건, melee threat, LOS/LOE/range, Facing 판정은 기존 resolver가 소유한다. Rear 또는 Prone의 Off-Guard만으로는 피해 면역을 해제할 수 없다. 별도 Flanking condition, 강제 성공이나 전용 gameplay action을 만들지 않는다.

기본 Strike, 카드 Strike, 판정형/직접 피해 주문, 반응 공격은 공통 피해 적용 경로를 사용한다. 면역은 피해만 막는다. 행동/카드/반응 소비와 명중·피해 RNG는 그대로이며 비피해 효과는 그대로 처리한다. 피해마다 현재 관계를 확인하고 `DAMAGE_DEALT.amount: 0`, `preventedBy: "requires-flanking"`을 기록한다. Preview와 실행은 같은 피해 정책을 공유한다. 무효인 Strike는 Damage 0–0과 한국어 이유를 표시하고 주문도 이유를 표시한다. 전투 로그에도 협공 필요를 표시한다.

`partyHpFloor: 1`은 주인공과 Aerin 모두에게 적용한다. 다음 Spear Line에는 피해 면역과 HP 보호가 모두 없다. 안드로이드의 AI와 능력치는 1-2의 기존 정의 그대로다.

## 안내와 임시 훈련용 단검

전투 시작 버튼은 실제 게임 화면을 배경으로 기존 반투명 Minerva dialogue를 연다. Aerin과 협력, 반대편 근접 위협, Off-Guard AC −2, 비협공 피해 전부 무효, 공격 Preview 확인을 4페이지로 설명한다. 화면 클릭/터치·Enter/Space와 건너뛰기를 재사용하며 Next/Back 버튼은 없다. 안내를 보는 동안 이동·공격·전투 시작 요청은 발생하지 않는다. 완료/건너뛰기 후 기존 `start-encounter`를 보내고, Escape는 준비로 돌아간다. 실행 중인 전투의 Resume나 Guest 참가에 출발 안내를 새로 넣지 않는다.

[후속 UX 코멘트](https://github.com/darkbard81/CardGuild/issues/69#issuecomment-5846479629)에 따라 `rules.partyWeaponOverride: { seat: 1, equipmentId: "training-dagger" }`를 1-3에 선언한다. 클래스와 관계없이 주인공에게 동일한 Training Dagger를 빌려주고 Aerin의 Halberd는 유지한다. 단검은 simple melee / 5ft / 1d4 piercing / agile·finesse 무기이며 기존 quick-cut 카드와 blade 아이콘을 재사용한다. 협공 resolver에 클래스나 무기 예외를 추가하지 않는다.

Combat bridge는 실제 loadout을 먼저 검증한 뒤, 전투 구성에만 쓰는 복사본의 weapon을 단검으로 지정한다. Actor의 유효 장비·무기 카드·공격 수치는 이 복사본으로 함께 산출한다. AdventureState의 파티 장비, 원래 활, inventory, 준비 카드는 변경하지 않는다. 원래 무기의 자동 카드는 이 전투 동안 단검의 자동 카드로 대체되고, 저장된 준비 카드는 유지되어 무기 조건에 따라 사용 가능 여부가 결정된다. 단검은 보상이나 영구 소유 장비로 지급하지 않는다.

미네르바는 단검 대여와 원래 무기로의 복귀를 안내한다. Ranger는 활 해제 없이 출발한다. 저장/Resume는 이미 확정된 CombatState의 단검과 덱을 그대로 복구하며, 다음 Spear Line을 구성할 때 원래 저장된 무기와 덱을 다시 사용한다. 준비 화면의 장비는 계속 원래 무기를, 전투 상세는 현재의 Training Dagger를 표시한다. 동료가 근접 위협을 만들지 못하는 별도 loadout을 선택한 경우의 출발 검사는 유지한다.

## 저장과 검증

Protocol 16, content pack 0.14.1. Save 5 / Combat 6의 선택적 rules와 event 계약을 확장한다. rules는 setup fingerprint·snapshot·save·replay에 포함된다. 저장 복구 시 authored rules 일치뿐 아니라 이 훈련의 command log 재생 결과를 비교한다. 면역 제거/HP 변조를 저장 상태로 우회할 수 없다. 이전 content pack 저장은 기존 content identity 정책으로 거부하며 자동 migration·삭제는 하지 않는다.

- Domain: 모든 생성 클래스에서 서로 다른 두 이동 경로, 협공·Preview·해제, 기본 Strike/직접 피해/Save 피해의 무효와 정상 피해, 비용·RNG·replay, 두 아군 HP 1, 파티/모집 admission, 모든 클래스의 임시 장비·원래 장비/인벤토리 보존·save/Resume·Spear Line 원복, 잘못된 override 참조/seat 검증.
- Interaction: Host/Guest 각각 실제 Aerin 이동, 화면의 Off-Guard/Flanking/협공 아군/Target AC, stale preview 제거, 안내의 무행동, Ranger의 장비 변경 없는 출발·대여 안내·전투 상세의 단검 표시.
- Integration: SQLite 파일 저장·reopen·Resume에서 단검 Combat과 저장된 Ranger 활을 함께 보존.
- Journey: 기존 J-PROGRESS를 1-2 승리·모집부터 1-3 실제 이동·공격·승리와 Spear Line 준비까지 연장한다. J-COOP는 같은 훈련장에서 기존 양 브라우저 조작권을 검증한다.

일반 geometry/stacking, 모집 atomicity, Co-op claim/reconnect의 상세 매트릭스는 기존 테스트가 소유한다. 실물 iPad/Safari 검증은 수행하지 않는다.

## 초기 구현 검증 기록

초기 커밋 `77ef3ea`에서 `CI=true npm run check && CI=true npm run test:all` 완주(exit 0): Domain 137, Integration 25, Interaction 70, Journey 4 — 총 236개 통과. 콘텐츠·에셋·타입·ESLint·client/server build 통과. Node 24.18.1 / npm 11.16.0. GitHub CI는 push 후 별도 결과다.

## 임시 단검 후속 수정 검증

2026-09-26 `CI=true npm run check && CI=true npm run test:all` 최종 전체 gate 완주(exit 0): Domain 139, Integration 26, Interaction 70, Journey 4 — 총 239개 통과. 콘텐츠·에셋·타입·ESLint·client/server build 통과. 기존 1-2 모집부터 1-3 승리와 Spear Line 준비, Co-op 여정도 통과했다. GitHub CI는 push 후 별도 결과다.
