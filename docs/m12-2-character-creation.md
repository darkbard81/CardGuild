# M12-2 — Human 캐릭터 생성 (#64)

출시 목록은 Bard, Champion, Cleric, Druid, Fighter, Ranger, Rogue, Witch, Wizard 9개입니다. 제외된 후보는 없습니다. `creationPresets.json`이 실제 선택 allowlist이며 Class 레지스트리 추가만으로 UI에 노출되지 않습니다.

## 출시 매트릭스

모두 Human, Lv1, EXP 0, 빈 advancement history로 생성합니다. 아래 free boosts와 trained skills는 기존 Character resolver가 검증합니다. 장비 숙련도와 카드 Class/Level 자격은 production/content gate가 검증합니다. 준비 용량은 4이며 3장을 준비해 첫 보상 카드를 위한 한 칸을 남깁니다. 모든 클래스에 기본 Careful Advance 2장이 있고, 표의 추가 기본 카드는 2장씩 부여됩니다.

| Class / preset | Free boosts | Trained skills | 시작 장비 | 추가 기본 카드 | 준비 카드 |
|---|---|---|---|---|---|
| human.bard | cha, dex, con, wis | performance, diplomacy | light-blade, leather-armor | daze | soothe, fear, careful-advance |
| human.champion | str, dex, con, wis | athletics, religion | guardian-mace, scale-mail, shield | lay-on-hands | shield-press, demoralize, battle-medicine |
| human.cleric | wis, dex, con, str | religion, medicine | staff, scale-mail, shield | spirit-lance | heal, harm, battle-medicine |
| human.druid | wis, dex, con, str | nature, survival | staff, leather-armor, shield | frostbite | heal, arcane-ward, careful-advance |
| human.fighter | str, dex, con, wis | athletics, intimidation | halberd, scale-mail | reactive-strike | vicious-swing, demoralize, careful-advance |
| human.ranger | dex, str, con, wis | survival, stealth | composite-shortbow, leather-armor | 없음 | aimed-shot, battle-medicine, careful-advance |
| human.rogue | dex, str, con, wis | stealth, thievery | light-blade, leather-armor | 없음 | slip-free, grapple, battle-medicine |
| human.witch | int, dex, con, wis | arcana, occultism, medicine, stealth | staff | daze | fear, soothe, arcane-ward |
| human.wizard | int, dex, con, wis | arcana, occultism, crafting, society | staff | telekinetic-projectile | force-barrage, arcane-ward, battle-medicine |

장비 trait에서 오는 카드(할버드 Trip 등)는 `deriveTacticalDeck()`가 추가합니다. UI는 기본/장비/준비 출처와 실제 장수를 이 공통 resolver에서 읽으며 별도 덱 계산표를 갖지 않습니다. Staff는 기존 무기 primitive로 작성한 simple 근접 1d6 bludgeoning 무기이며 신규 주문 시스템이 아닙니다.

### 현재 지원하는 역할

- **human.bard**: 정신 주문으로 적을 압박하고 Soothe로 자신이나 아군을 회복합니다. 검으로 근접 공격도 할 수 있습니다.
- **human.champion**: 방패를 들고 철퇴로 싸우며 Lay on Hands로 회복합니다. Shield Press로 적을 밀어내고 Demoralize로 위협합니다.
- **human.cleric**: Heal과 Battle Medicine으로 회복하고 Harm과 Spirit Lance로 피해를 줍니다. 지팡이와 방패로 가까운 적에 대응합니다.
- **human.druid**: Frostbite로 원거리 피해를 주고 Heal로 회복합니다. Arcane Ward와 방패로 방어를 보완합니다.
- **human.fighter**: 긴 할버드로 적을 공격하거나 넘어뜨립니다. Vicious Swing으로 강하게 때리고 Reactive Strike로 빈틈에 반응합니다.
- **human.ranger**: 단궁으로 거리를 유지하며 공격합니다. Aimed Shot과 이동 카드를 사용하고 Battle Medicine으로 회복합니다.
- **human.rogue**: 민첩한 검으로 근접 공격하고 Grapple로 적을 붙잡습니다. Slip Free로 자리를 바꾸며 Battle Medicine으로 회복합니다.
- **human.witch**: Daze와 Fear로 적을 압박하고 Soothe로 회복합니다. Arcane Ward로 방어를 보완합니다.
- **human.wizard**: Telekinetic Projectile과 Force Barrage로 원거리 피해를 줍니다. Arcane Ward와 Battle Medicine으로 생존을 보완합니다.

Spell slot, patron/familiar, Hunt Prey, Sneak Attack, 새 feat 시스템 등 미구현 직업 기능을 생성 UI에서 약속하지 않습니다.

## 생성과 저장

- 이름은 서버와 같은 `assertCharacterName()`으로 1~40 Unicode codepoint, 앞뒤 공백/제어 문자 금지를 적용합니다. 이름은 텍스트로만 렌더링합니다.
- 자동 모험 제목은 `<이름>의 모험`이며 서버의 제목 상한 60자도 Unicode codepoint로 검사합니다. 40개 이모지 이름도 HTTP 생성·저장 요약까지 잘리지 않고 전달됩니다.
- 선택은 로컬 draft입니다. Class 변경은 이름/성별을 보존하며 이미지에는 선택 시점의 manifest CSS를 즉시 적용합니다. 이전 이미지 load callback이 현재 선택을 덮어쓰는 경로가 없습니다.
- 명시적인 `생성하고 시작`만 빈 Campaign/session 생성 후 `create-character`를 보냅니다. 중복 submit과 선택 변경은 요청 중 잠급니다.
- 성공 ACK와 그 committed revision snapshot을 모두 적용한 뒤에만 준비 화면으로 이동합니다. ACK 먼저/snapshot 먼저 모두 Interaction으로 검증합니다.
- 저장 거절은 draft와 같은 빈 session을 보존하며 재시도합니다. 인증 만료는 로그인 후 생성 목적지와 draft로 복귀합니다.
- 저장된 주인공의 Continue는 기존 복구 경로를 사용하며 `create-character`를 다시 호출하지 않습니다.
- 생성 template은 authored Party Builder 후보에서 제외합니다. 기존 동료/Creature 그림과 Guest 선택 경로는 유지합니다.

## 외형 제작과 매핑

- 9개 gameplay template, 18개 성별/Class visual, 18개 front/back 원본 시트, 36개 개별 WebP 출력입니다.
- 원본: `art/source/actors/human-<class>-<gender>-front-back.png`. Built-in image generation으로 생성·보정했습니다. 전체 원본/수정 프롬프트는 `art/source/generation-plan.json`의 각 source가 보존합니다.
- 스타일은 2D hyper detailed anime, 실제 투명 alpha, 흰색 굵은 외곽선입니다. 사용자 요청에 따라 이미 생성된 스탠디를 사용하고, 그림의 추가 수정은 사용자 검수 후 클래스별 요청으로 진행합니다. 빌드 시 source cell 경계 접촉은 미술 검토 안내로 출력하며, runtime canvas/alpha/매핑 검증은 그대로 적용합니다.
- 이후 신규 제작·재생성은 앞면 단독 생성 → 완성된 앞면 이미지를 첨부한 뒷면 단독 생성 → 두 시점 검토 → front/back 빌드 입력 시트 구성 순서로 진행합니다. 원본 두 장과 실제 프롬프트·참조 경로를 보존하며, 세부 절차는 [프롬프트 규약](../art/reference/IMAGEGEN_PROMPT.md)을 따릅니다.
- 가공: `art/processed/actors/human/<class>/<gender>/{front,back}.png`. 배포: `public/assets/actors/human/<class>/<gender>/{front,back}.webp`.
- `npm run assets:build`가 source → normalized 256×384 canvas → bottom anchor `(0.5,1)` → WebP/manifest/ink bounds/QC를 생성합니다. 생성 manifest/processed 파일은 직접 수정하지 않습니다.
- 논리 키는 preset의 `appearance[gender]`이며 `resolvePartyMemberDefinition()`을 거쳐 생성/준비/상세/얼굴 picker/Campaign 요약/전투 HUD/보드에 전달됩니다. member별 이미지 복제나 누락 variant 대체는 없습니다.
- 초상화는 동일 front asset의 공통 ink crop입니다. 북쪽은 back, 나머지는 front와 방향 화살표라는 기존 계약을 유지합니다.
- `assertCreationVisualCoverage()`는 template/variant 중복, front/back 누락 및 잘못된 매핑을 거절합니다. 기존 에셋 검사가 실제 파일/alpha/ink/anchor/atlas 분리를 검증합니다.

## 첫 전투 실행 근거와 후속 범위

`npx tsx tools/playtest/creation-readiness.ts`는 실제 `create-character`/첫 encounter 생성과 기존 greedy hero policy를 사용합니다. 현재 Goblin Trouble 첫 전투에서 seed 1~3, 9개 클래스 27회 중 21회 승리했습니다. 모두 적어도 한 seed에서 동료 없이 승리했습니다. Bard/Witch는 1/3, Ranger/Rogue는 2/3, 나머지는 3/3입니다. 이는 목표를 수행할 수단의 실행 근거이며 무작위 seed 전체 승률이나 신규 Tutorial 밸런스 검증은 아닙니다.

신규 Tutorial 콘텐츠와 production 전환은 #67의 범위입니다. #64 생성 결과는 현재 adventure의 첫 전투 직전 준비 상태에 연결됩니다. J-START/J-CONTINUE는 생성 UI 변경에 맞춰 새 주인공으로 현재 첫 전투를 검증하고, 신규 Tutorial 시나리오 전환은 #67에서 수행합니다. J-COOP는 #65/#66의 모집/준비 Co-op 전환 전까지 authored 2인 파티를 실제 서비스 명령으로 준비한 뒤 기존 Guest UI를 검증합니다.

## 검증 상태

2026-09-21, Node.js 24.18.1 / npm 11.16.0에서 최종 실행 코드·콘텐츠·에셋·테스트 상태로 다음 전체 gate를 연속 완주했습니다. 콘텐츠 identity는 `cardguild.m7@0.10.0`, `fnv1a64:7c61d9bcd9e4ef64`입니다.

```sh
CI=true npm run check && CI=true npm run test:all
```

| 검사 | 최종 결과 |
|---|---|
| check | 콘텐츠·production policy·에셋·TypeScript·ESLint·클라이언트/서버 build 통과 |
| Domain | 86개 통과. 9개 production preset의 Lv1/solo/gender 비의존 계약 포함 |
| Integration | 17개 통과. 이모지 40자 이름의 실제 HTTP 생성·저장 요약, 저장 실패/재시도 및 복구 포함 |
| Interaction | 43개 통과. 생성 UI 6개: 지연 이미지, inert preview/공용 상세, reject/retry, ACK/snapshot 순서, 인증 복귀, 이름 정책 |
| Journey | 4개 통과. 생성 → 첫 전투, 서버 재시작 → 새 브라우저 Continue, 기존 보상/성장 및 Guest Co-op |

초기 전체 검사에서는 구 로스터 상세 테스트가 빈 로비에 Aerin 선택지를 기대해 실패했습니다. 이제 빈 로비는 생성 화면으로 연결되므로 해당 테스트는 authored 멤버가 배치된 로비를 준비합니다. 실패 사례의 선택 재검사 후 위 전체 gate를 처음부터 다시 완주했으며, 부분 통과 결과를 합산하지 않았습니다.

`npm run assets:build`로 원본에서 산출물을 생성했습니다. 18개 고유 appearance, 18개 원본 시트, 36개 processed PNG와 36개 runtime WebP의 실제 파일·매핑·bottom-center anchor를 확인했습니다. 남성 Witch 앞뒤 및 남성 Ranger 뒷면의 source cell 경계 접촉은 미술 검토 안내로 남겨 두었습니다. 사용자 지시에 따라 기존 생성물을 사용하며 추가 그림 생성·보정은 수행하지 않습니다.

1024×768 Chromium에서 Fighter/Ranger 남녀의 앞면·뒷면·초상화와 확인/취소 버튼의 화면 내 배치를 확인했습니다. Fighter 여성의 실제 전투 보드·initiative·공용 상세에도 선택한 외형과 이름이 연결됩니다. 그림 자체의 최종 검수와 클래스별 수정 요청은 사용자가 진행합니다. 실제 iPad 검증과 이 구현 변경분의 GitHub CI는 수행하지 않았습니다.

### 요구사항별 확인 근거

| 요구사항 | 근거 |
|---|---|
| Human 고정, 9개 Class allowlist, 합법적인 Lv1 starter와 현재 역할 | 출시 매트릭스, `creationPresets.json`, `m7-production-policy.ts`, content/production check |
| 성별 선택은 gameplay에 영향 없음 | production preset 9개 Domain 사례의 stats/Collection/deck 비교 |
| 명시적 생성만 저장, draft 유지, 중복 방지, ACK와 snapshot 이후 완료 | `creation.spec.ts` 6개 및 기존 `contracts/creation.test.ts` 저장 경계 |
| 공용 상세·초상화·준비·전투·Continue identity 일치 | 공통 member resolver/asset catalog, Interaction 생성 후 준비/전투 상세, HTTP 요약 및 J-CONTINUE |
| 18 visual / 36 출력, 누락·중복·잘못된 매핑 거절 | `assertCreationVisualCoverage()`, production canonical appearance 검사, assets build/check |
| 새 게임에서 구 로스터/Guest 준비 강제 없음, 기존 authored 경로 보존 | 새 생성 흐름의 J-START, authored 로비 상세 Interaction, J-COOP |
| solo 시작 수단 및 후속 Tutorial 경계 | 현재 첫 전투 seed 1~3의 27회 실행 결과; 신규 Tutorial 콘텐츠/전환은 #67 |
