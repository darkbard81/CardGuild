# M11-2 Character Progression Foundation

[#55](https://github.com/darkbard81/CardGuild/issues/55)는 #54의 canonical Trait ID 기반 위에서
Character의 완성형 스탯 authoring을 Build와 선택 이력으로 교체합니다. 기준 commit은
`ebcf52d66b4617ef1da285f020a7e28373bd3d92`입니다.

## 확정 범위

사용자 결정은 Player Core 8종에 **Champion만 예외로 추가한 9종**, 기존 네 캐릭터의 아래
identity, 클래스별 고정 preset입니다. Alchemist/Barbarian/Investigator/Monk/Oracle/Sorcerer/
Swashbuckler 등 나머지 Player Core 2 클래스는 추가하지 않습니다.

| Character | Ancestry | Class | Free boosts | Starting trained skills |
|---|---|---|---|---|
| Aerin | Human | Fighter | STR DEX CON WIS | Athletics, Intimidation |
| Lyra | Elf | Rogue | DEX CON INT WIS | Acrobatics, Athletics, Stealth, Thievery |
| Brom | Dwarf | Champion | STR CON WIS CHA | Athletics, Intimidation |
| Nera | Human | Cleric | DEX CON INT WIS | Medicine, Religion, Diplomacy |

각 Attribute는 0부터 ancestry fixed 2개 + class key 1개 + free 4개로 계산합니다.
Starting skill 수는 **Level 1 INT + 2**이며 이후 INT 상승으로 추가 skill을 지급하지 않습니다.
Background, flaws, Lore, feat/spell slot/spell DC progression, class feature tree, specialization
피해, natural attack, Character Creator와 dynamic party registry는 이 범위에 없습니다.
원전의 Rogue 추가 skill cadence도 사용하지 않습니다. 기존 playable roster는 유지합니다.

| Ancestry | HP | Speed | CardGuild fixed boosts | 원전 |
|---|---:|---:|---|---|
| Dwarf | 10 | 20 ft | CON WIS | [Player Core p43](https://2e.aonprd.com/Ancestries.aspx?ID=59) |
| Elf | 6 | 30 ft | DEX INT | [Player Core p47](https://2e.aonprd.com/Ancestries.aspx?ID=60) |
| Human | 8 | 25 ft | STR WIS | [Player Core p63](https://2e.aonprd.com/Ancestries.aspx?ID=64) |

HP/speed는 원전을 따릅니다. Dwarf/Elf의 ancestry free boost와 flaw를 제외하고 두 fixed boost만
사용하며 Human의 두 free boost는 STR/WIS preset으로 고정합니다. 이 ancestry boost 방식은
CardGuild 제품 규칙이며 원전 Character Creation의 전체 구현이 아닙니다.

## 클래스 preset과 출처

2026-09-13 Archives of Nethys Remaster 페이지의 proficiency 수치를 기준으로 작성했습니다.
모든 starting 표는 Perception/세 Save/네 Armor/네 Weapon/Class DC를 완전히 갖습니다.
`classes.json`은 바뀌는 rank만 milestone에 저장하며 같은 rank나 downgrade는 거절합니다.

| Class | HP/level | Key | 고정 preset 및 근거 |
|---|---:|---|---|
| [Bard](https://2e.aonprd.com/Classes.aspx?ID=32) | 8 | CHA | 공통 baseline; muse별 feature는 제외 |
| [Cleric](https://2e.aonprd.com/Classes.aspx?ID=33) | 8 | WIS | Warpriest, favored weapon = Fist |
| [Druid](https://2e.aonprd.com/Classes.aspx?ID=34) | 8 | WIS | 공통 baseline; order별 feature 제외 |
| [Fighter](https://2e.aonprd.com/Classes.aspx?ID=35) | 10 | STR | STR 선택, Brawling/Fist weapon-group preset |
| [Ranger](https://2e.aonprd.com/Classes.aspx?ID=36) | 10 | DEX | DEX 선택; hunter's edge feature 제외 |
| [Rogue](https://2e.aonprd.com/Classes.aspx?ID=37) | 8 | DEX | DEX 선택; racket별 feature 제외 |
| [Witch](https://2e.aonprd.com/Classes.aspx?ID=38) | 6 | INT | 공통 baseline; patron별 feature 제외 |
| [Wizard](https://2e.aonprd.com/Classes.aspx?ID=39) | 6 | INT | 공통 baseline; school별 feature 제외 |
| [Champion](https://2e.aonprd.com/Classes.aspx?ID=58) | 10 | STR | Player Core 2 예외, STR 선택; cause별 feature 제외 |

[Warpriest doctrine](https://2e.aonprd.com/Doctrines.aspx)의 Fortitude expert와 light/medium armor를
Lv1에 적용합니다. Martial trained는 Lv3, 무기 expert는 Lv7, Fortitude master는 Lv15입니다.
Favored Fist master만 Lv19에 반영합니다. Spellcasting proficiency는 Class DC와 다른 통계이므로
Class DC로 복사하지 않습니다. 이번 caster Class DC는 trained를 유지합니다.

Fighter의 Lv5/Lv13 선택 weapon group 상승을 모든 martial 무기에 확장하지 않습니다. 현재
Character unarmed가 shared Fist 하나뿐이므로 Brawling/Fist preset의 상승은 unarmed category에
반영하고, 다른 category는 공통 weapon legend/versatility 상승만 적용합니다. 따라서 Aerin의
Halberd는 Lv5에 자동 master가 되지 않습니다. 추후 weapon group이나 alternate unarmed를 넣으면
이 preset을 다시 세분화해야 합니다. Save degree-of-success upgrade는 단순 rank 상승과 분리하여
이번에는 제외합니다. Champion의 cause와 Cleric deity를 state에 추가하지 않습니다.

## 하나의 resolver와 상태 전이

`src/character`는 ActorDefinition ID를 요구하지 않습니다. Trait identity → 시작 Attribute →
시작 Skill → level순 advancement replay → class proficiency → CharacterStatProfile 순서로
계산합니다. Synthetic user Build와 authored NPC도 동일 함수로 검증·계산합니다.

`ActorSource`는 Character Build 또는 fixed Creature source이며 compiled `ActorDefinition`은
resolved profile과 원래 `character` Build를 유지합니다. `playable` 여부는 계산 분기가 아닙니다.
NPC도 ancestry/class exactly-one 및 authored level까지 완성된 history가 필요합니다.
`goblin` ancestry Trait을 가진 Creature에는 Class를 요구하지 않습니다.

Skill Increase는 Lv3/5/7/9/11/13/15/17/19에 하나이며 expert는 Lv3, master는 Lv7,
legendary는 Lv15부터입니다. Attribute boosts는 Lv5/10/15/20에 서로 다른 네 Attribute입니다.
+4 미만은 +1, +4 이상은 partial 다음 boost로 +1입니다. Profile에는 정수만 남기고 partial은
resolver 결과로 제공합니다. 최종 rank나 partial/pending을 저장하지 않습니다.

EXP는 level만 올리고 선택을 추측하지 않습니다. `advance-character`는 ready/between 단계에서
현재 effective controller만 보낼 수 있습니다. offline guest의 캐릭터는 기존 host fallback을
따릅니다. 가장 이른 pending 한 level의 모든 항목을 함께 commit하며 같은 level 재전송은
거절합니다. Party 중 하나라도 pending이면 다음 Encounter를 시작하지 못합니다.

Adventure UI는 선택을 preview하고 저장 중 재전송을 막습니다. 오류 시 draft를 유지하여 재시도할
수 있습니다. 상태·성장 event·ACK는 durable COMMIT 뒤에만 공개합니다. Class milestone은 선택과
독립적으로 새 level의 effective profile에 적용합니다. 이전 active/completed Combat은 그대로이며
다음 Combat과 Loadout가 같은 resolver 결과를 사용하고 새 전투는 새 max HP로 시작합니다.

## 버전과 기존 저장

| 경계 | 이전 | 이번 |
|---|---|---|
| Content schema / pack | 10 / 0.5.0 | 11 / 0.6.0 |
| AdventureState | 3 | 4 |
| SessionCoreState / CombatState | 3 / 4 | 3 / 4 |
| Campaign Save / wire protocol | 1 / 7 | 2 / 8 |

SQLite schema는 바뀌지 않습니다. Save v1→v2나 0.5.0→0.6.0 migration을 등록하지 않습니다.
이전 스탯은 새 Build로 정확히 역변환할 수 없습니다. `SAVE_SCHEMA_UNSUPPORTED` 또는
`SAVE_CONTENT_MISMATCH`로 거절하고 기존 row/JSON/hash/revision을 보존합니다.

## 수치와 밸런스 변화

| Character | Lv1 Attributes (STR/DEX/CON/INT/WIS/CHA) | HP 이전→현재 | AC 이전→현재 | Strike 이전→현재 | Class DC 이전→현재 |
|---|---|---|---|---|---|
| Aerin | 3/1/1/0/2/0 | 21→19 | 18→17 | 8→8 | 16→16 |
| Lyra | 0/3/1/2/1/0 | 16→15 | 18→17 | 7→6 | 17→16 |
| Brom | 2/0/2/0/2/1 | 26→22 | 20→18 | 6→5 | 16→15 |
| Nera | 1/1/1/1/3/0 | 18→17 | 16→15 | 5→1 | 19→16 |

기존 장비·카드·전투·보상은 유지했습니다. Brom의 Lv1 Athletics master를 trained로 낮추고,
Nera의 expert Class DC를 trained로 낮췄습니다. Nera는 Warpriest Lv1에 martial untrained이므로
기존 bow의 명중이 낮으며 Lv3 martial trained부터 개선됩니다. 지원 역할은 Medicine/Religion과
기존 카드로 유지합니다. Lyra의 낮아진 STR은 finesse 명중과 별개로 피해를 낮춥니다.
파티 선택 화면은 Champion Trait으로 guardian 역할을 표시하여 Brom의 낮아진 HP/AC가
역할 이름과 기본 로스터 순서를 바꾸지 않게 합니다.
이 숫자는 원래 final stats 보존 실패가 아니라 합법적 source로 교체한 결과입니다.

동일 seed 1, 동일 36개 spec(로스터/보상/장비 정책)의 플레이테스트를 전후에 실행했습니다.
전투 정책은 동일하며 이번 도구는 다음 전투 전에 명시적 성장 command를 추가로 보냅니다.
도구의 growth policy는 starting skill 순서에서 증가 가능한 첫 Skill, Attribute는 Build free boosts를
선택합니다. 제품 EXP transition에 자동 선택은 없습니다.

- 이전: 17/36 완주, 19/36 패배.
- 현재: 6/36 완주, 30/36 패배.
- 단일 seed 비교이므로 전체 승률 추정이나 균형 보장을 의미하지 않습니다.
- 실제 세션 완주 및 crash recovery의 Aerin/Brom/Nera 검증은 새 legal Build로 완주가 확인된
  seed 2를 사용합니다. 기존 전투 테스트 seed 8과 recovery seed 1의 실패를 숨기는 balance 결과로
  사용하지 않습니다. seed 1 비교 결과는 아래에 그대로 기록합니다.

실행: `npm run playtest -- --seeds 1 --json <output>`.
[기계 판독 비교 결과](evidence/m11-2-playtest-comparison.json)는 각 run의 종료 지점과 전투별 수치를
보관합니다. after는 같은 HEAD의 작업 트리 변경을 실행한 결과이며 별도 commit을 주장하지 않습니다.

| Spec (seed 1) | Before | After |
|---|---|---|
| `1P-aerin-first-authored` | ruined-gate | ruined-gate |
| `1P-aerin-first-adapt` | Complete | goblin-chief |
| `1P-aerin-last-authored` | ruined-gate | ruined-gate |
| `1P-aerin-last-adapt` | Complete | ruined-gate |
| `1P-lyra-first-authored` | goblin-chief | spear-line |
| `1P-lyra-first-adapt` | ruined-gate | ruined-gate |
| `1P-lyra-last-authored` | goblin-chief | spear-line |
| `1P-lyra-last-adapt` | ruined-gate | ruined-gate |
| `1P-brom-first-authored` | Complete | spear-line |
| `1P-brom-first-adapt` | goblin-chief | ruined-gate |
| `1P-brom-last-authored` | Complete | spear-line |
| `1P-brom-last-adapt` | goblin-chief | ruined-gate |
| `1P-nera-first-authored` | ruined-gate | ruined-gate |
| `1P-nera-first-adapt` | goblin-chief | spear-line |
| `1P-nera-last-authored` | ruined-gate | ruined-gate |
| `1P-nera-last-adapt` | spear-line | spear-line |
| `2P-aerin+lyra-first-authored` | ruined-gate | ruined-gate |
| `2P-aerin+lyra-first-adapt` | ruined-gate | wolf-run |
| `2P-aerin+lyra-last-authored` | ruined-gate | ruined-gate |
| `2P-aerin+lyra-last-adapt` | Complete | ruined-gate |
| `2P-aerin+nera-first-authored` | Complete | Complete |
| `2P-aerin+nera-first-adapt` | Complete | Complete |
| `2P-aerin+nera-last-authored` | Complete | Complete |
| `2P-aerin+nera-last-adapt` | Complete | ruined-gate |
| `2P-brom+lyra-first-authored` | Complete | ruined-gate |
| `2P-brom+lyra-first-adapt` | ruined-gate | ruined-gate |
| `2P-brom+lyra-last-authored` | Complete | ruined-gate |
| `2P-brom+lyra-last-adapt` | ruined-gate | ruined-gate |
| `3P-aerin+lyra+nera-first-authored` | ruined-gate | Complete |
| `3P-aerin+lyra+nera-first-adapt` | Complete | Complete |
| `3P-aerin+lyra+nera-last-authored` | ruined-gate | Complete |
| `3P-aerin+lyra+nera-last-adapt` | Complete | ruined-gate |
| `3P-brom+nera+lyra-first-authored` | Complete | spear-line |
| `3P-brom+nera+lyra-first-adapt` | Complete | goblin-chief |
| `3P-brom+nera+lyra-last-authored` | Complete | spear-line |
| `3P-brom+nera+lyra-last-adapt` | Complete | archer-perch |

## 완료 조건과 검증 위치

| 계약 | 검증 |
|---|---|
| Actor ID 없는 공통 Build 계산, 시작 skill pool, Lv20까지 partial replay와 rank gate | `src/character/rules.test.ts` |
| NPC와 synthetic PC의 동일 결과, Creature 예외, final-stat authoring 거절, 선언 순서 정규화 | `src/content/character-build.test.ts` |
| 9개 클래스 범위와 네 Character의 Lv1/Lv3/Lv5 profile·HP·AC·Strike | `src/content/character-build.test.ts`의 12개 snapshot |
| EXP 이후 pending, 이전 Combat object/hash 불변, 다음 전투와 Loadout의 같은 profile/full HP | `src/adventure/progression.test.ts`, `src/session/character-advancement.test.ts` |
| ready/between 제한, 1P/2P/3P effective controller, offline guest의 host fallback | `src/session/character-advancement.test.ts` |
| 선택 draft, 가장 이른 pending, 정확히 네 boost, partial 표시, 오류 재시도, 좁은 화면 | `tests/unit/browser/character-advancement.spec.ts` — component harness를 사용하는 Browser Unit |
| Save v2 history/pending/hash roundtrip, 불법 history 거절, Save v1과 이전 content row 보존 | `src/server/campaign-save.test.ts`, `tests/integration/campaign-service.test.ts` |
| protocol v7 거절, reconnect 후 history 유지 | `src/protocol/validate-message.test.ts`, `tests/integration/coop.test.ts` |
| COMMIT 대기/실패 중 미공개, 동일 request 재시도 1회 적용 | `src/server/session-host.test.ts` |
| 성장 COMMIT 직전/직후 SIGKILL 복구, history 중복 없이 8번째 전투 진입 | `tests/integration/restart-matrix.test.ts` |
| 실제 transport/authority를 거쳐 Lv3 성장 선택 후 8개 전투 완주 | `tests/integration/adventure-progression.test.ts` |
| 배포 client/server와 전용 DB/process를 사용하는 브라우저 restart 회귀 | `tests/recovery/campaign.recovery.ts` |

## 최종 검증 결과

2026-09-14, 위 기준 HEAD에 이 문서의 구현 변경을 적용한 작업 트리에서 순서대로 실행했습니다.
Content identity는 `cardguild.m7@0.6.0`, `fnv1a64:e6430ce79e65bbdd`입니다.

| 명령 / 계층 | 결과 |
|---|---|
| `npm run check` | exit 0 — content/production/assets, TypeScript 전체 project, ESLint |
| `npm run build` | exit 0 — client 및 `dist-server/main.js` 생성 |
| `npm test` / Unit | 51 files, 583 tests 통과; 네 Character의 12개 profile snapshot 포함 |
| `npm test` / Browser Unit | 43 tests 통과 |
| `npm test` / Integration | 11 files, 102 tests 통과 |
| `npm test` / E2E | 25 tests 통과 |
| `npm test` / Recovery | 4 tests 통과 — 위 build 결과 사용, worker 1 |
| `npm test` 전체 명령 | exit 0 — 5개 계층 총 757 tests 통과 |
| `git diff --check` | 통과 |

이는 수집된 test 수가 아니라 실제 실행 결과입니다. Build의 기존 chunk-size 안내는 남아 있습니다.
최종 실행 전 수정한 회귀는 새 HP/Reflex DC/version 기대값과 Champion guardian 표시입니다.
구현·밸런스 비교·완료 조건 대조 결과는 이 문서와 연결된 테스트·증거 파일에 기록했습니다.
