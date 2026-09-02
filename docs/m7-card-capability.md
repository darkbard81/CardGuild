# M7 Card Capability Matrix

M7-2(#13)의 **Rule Backflow 판단 기록 source of truth**입니다. 새 AoN reference나 production
card 후보는 구현 전에 여기에서 판정하고, 상태와 근거를 남깁니다.

Baseline: `content/m7` production pack (#12), `#7`~`#10` resolver / ActionPlan 계약.

## 판정 상태

| Status | 의미 |
|---|---|
| `SUPPORTED` | 현재 #7~#10 contract만으로 핵심 combat semantics 표현 가능 |
| `EXTEND` | 기존 abstraction에 작은 additive primitive를 더하면 가능. #13에서 구현 |
| `ADAPTED` | 비핵심 subsystem을 의도적으로 생략. 생략 내용을 Fidelity Note에 기록 |
| `DEFER` | 새 subsystem/state domain 필요. #13에서 구현 금지 |

`EXTEND` 자격은 §12.2 기준을 모두 만족해야 하며, **한 primitive는 최소 2개 이상의 서로 다른
reference pattern 또는 content family를 열어야 합니다.**

AoN 원본 이름은 핵심 전투 semantics가 보존될 때만 production card에 사용합니다. 그렇지 않으면
CardGuild 고유 이름으로 만들고 reference pattern만 여기에 기록합니다.

---

## 1. Basic Actions

| Reference | Kind | Lv | Cost | Target | Check / DC | Primary Effect | Required capability | Status | Card ID | Fidelity Note |
|---|---|---|---|---|---|---|---|---|---|---|
| Strike | Basic | — | 1 | enemy | attack vs AC | weapon damage | 기존 `strike` resolution | SUPPORTED | *(basic action)* | #9 resolver 그대로 |
| Stride | Basic | — | 1 | tile | — | Speed 이동 | 기존 `move` resolution | SUPPORTED | *(basic action)* | — |
| Step | Basic | — | 1 | tile | — | 5ft, reaction 미유발 | 기존 `move` resolution | SUPPORTED | *(basic action)* | — |
| Stand | Basic | — | 1 | self | — | Prone 제거 | `direct` + remove-condition | SUPPORTED | *(context action)* | — |
| Escape | Basic | — | 1 | self | Athletics vs DC | Grabbed 제거 | 기존 `check` resolution | SUPPORTED | *(context action)* | 현재 fixed DC 15. 원본은 grabber DC |
| Raise a Shield | Basic | — | 1 | self | — | shield AC circumstance | `raise-shield` primitive | SUPPORTED | *(context action)* | — |
| Interact | Basic | — | 1 | object | — | 물체 조작 | `interact` primitive | SUPPORTED | *(context action)* | map object 한정 |
| Take Cover | Basic | — | 1 | self | — | +2 circumstance AC | 자기 condition + **E7 expiry policy** | EXTEND | `card.brace-behind-cover` | ADAPTED: 실제 cover 지형 판정 없이 자세로만 모델링 |
| Aid | Basic | — | 1(+R) | ally | 준비 후 reaction check | 동료 판정에 보너스 | generic pre-roll reaction | DEFER | — | §6 Generic Pre-roll Reaction |
| Ready | Basic | — | 2 | — | — | trigger 예약 | triggered-action framework | DEFER | — | 새 command flow |
| Delay | Basic | — | 1 | — | — | initiative 재배치 | initiative 재정렬 subsystem | DEFER | — | turn order state domain |
| Seek | Basic | — | 1 | — | Perception vs Stealth DC | hidden 대상 탐지 | detection state (hidden/undetected) | DEFER | — | 새 per-observer state domain |
| Point Out | Basic | — | 1 | ally | — | 탐지 정보 공유 | detection state | DEFER | — | 위와 동일 |

## 2. Skill Actions

| Reference | Kind | Lv | Cost | Target | Check / DC | Primary Effect | Required capability | Status | Card ID | Fidelity Note |
|---|---|---|---|---|---|---|---|---|---|---|
| Trip (Athletics) | Skill | — | 1 | enemy | Athletics vs Reflex DC | Prone | 기존 `check` resolution | SUPPORTED | `card.trip` | exemplar. crit fail 시 자신 Prone은 미구현 |
| Grapple (Athletics) | Skill | — | 1 | enemy | Athletics vs Fortitude DC | Grabbed | 기존 `check` + `equipped-slot` requirement | ADAPTED | `card.grapple` | free-hand 규칙 없음. Restrained 승급/자동 만료 생략 |
| Demoralize (Intimidation) | Skill | — | 1 | enemy | Intimidation vs Will DC | Frightened 1 (crit 2) | valued condition | EXTEND | `card.demoralize` | 언어 이해/10분 면역 생략 |
| Battle Medicine | Feat/Skill | 1 | 1 | ally | Medicine vs fixed DC | HP 회복 | `restore-hp` + ally target | EXTEND | `card.battle-medicine` | 1일 면역 생략(ADAPTED). crit fail 자해 생략 |
| Escape (Acrobatics) | Skill | — | 1 | self | Acrobatics vs DC | Grabbed 제거 | 기존 `check` resolution | SUPPORTED | `card.slip-free` | Athletics 변형과 동일 계약 |
| Shove (Athletics) | Skill | — | 1 | enemy | Athletics vs Fortitude DC | 강제 이동 | forced movement | DEFER | — | §6 Forced Movement |
| Reposition (Athletics) | Skill | — | 1 | enemy | Athletics vs Fortitude DC | 대상 재배치 | actor+destination selection | DEFER | — | §6 Forced Movement |
| Disarm (Athletics) | Skill | — | 1 | enemy | Athletics vs Reflex DC | 무기 이탈 | 장비 탈착/낙하 state | DEFER | — | 새 inventory state domain |
| Feint (Deception) | Skill | — | 1 | enemy | Deception vs Perception DC | 공격자 한정 Off-Guard | attacker-relative condition | DEFER | — | §6 Relative Condition |
| Create a Diversion | Skill | — | 1 | enemy | Deception vs Perception DC | 관측자 한정 Hidden | detection + relative state | DEFER | — | 위와 동일 |
| Tumble Through (Acrobatics) | Skill | — | 1 | tile | 이동 중 Acrobatics vs Reflex DC | 적 칸 통과 | compound movement + 중간 check | DEFER | — | §6 Compound Activity |
| Hide / Sneak (Stealth) | Skill | — | 1 | self | Stealth vs Perception DC | Hidden/Undetected | detection state | DEFER | — | 새 state domain |
| Recall Knowledge | Skill | — | 1 | enemy | Lore/skill vs level DC | 정보 획득 | 정보 노출 subsystem | DEFER | — | 전투 state 변화 없음 |
| Treat Wounds (Medicine) | Skill | — | 탐험 | ally | Medicine vs DC | 대량 회복 | 탐험 모드 시간 축 | DEFER | — | encounter 밖 행동 |

## 3. Feats (Level 1–3)

| Reference | Kind | Lv | Cost | Target | Check / DC | Primary Effect | Required capability | Status | Card ID | Fidelity Note |
|---|---|---|---|---|---|---|---|---|---|---|
| Vicious Swing | Feat | 1 | 2 | enemy | attack vs AC | 추가 weapon die, MAP 2단계 | `extraWeaponDice` + `mapAttackCount` | EXTEND | `card.vicious-swing` | ADAPTED: `flourish` 1/turn 제한은 usage-limit system 부재로 미적용 |
| Intimidating Strike | Feat | 2 | 2 | enemy | attack vs AC | 명중 시 Frightened 1, crit 2 | valued condition + ordered outcome | EXTEND | `card.intimidating-strike` | 원본 semantics 보존 |
| Combat Grab | Feat | 1 | 1 | enemy | attack vs AC | 명중 시 Grabbed | 기존 `strike` + `weapon-mode` requirement | ADAPTED | `card.combat-grab` | free-hand 규칙 없음. 지속 조건(잡은 손 유지) 생략 |
| Dueling Parry | Feat | 1 | 1 | self | — | +2 circumstance AC | `equipped-slot` requirement + **E7** | ADAPTED | `card.dueling-parry` | handedness 모델 없음 |
| Sudden Charge | Feat | 1 | 2 | tile→enemy | attack vs AC | Stride×2 후 Strike | sequence continuation | DEFER | — | §6 Compound Activity |
| Snagging Strike | Feat | 1 | 1 | enemy | attack vs AC | 공격자 한정 Off-Guard | relative condition + free hand | DEFER | — | §6 Relative Condition |
| Reactive Shield | Feat | 1 | R | self | — | 공격 roll 후 shield AC | pre-roll/post-roll reaction | DEFER | — | §6 Generic Pre-roll Reaction |
| Nimble Dodge | Feat | 1 | R | self | — | 공격에 -2 circumstance | pre-roll reaction | DEFER | — | 위와 동일 |
| Shield Block | Feat | 1 | R | self | — | 피해 경감 + shield 손상 | damage-time reaction + item HP | DEFER | — | 새 damage continuation |
| Assurance | Feat | 1 | — | — | — | 판정 결과 고정 | fixed-result / fortune framework | DEFER | — | §6 Fortune |
| Mobility | Feat | 2 | — | — | — | 짧은 Stride가 reaction 미유발 | *(passive)* | DEFER | — | passive feat. Card Action 강제 변환 금지. `step` 패턴 참고만 |
| Quick Draw | Feat | 1 | 1 | enemy | attack vs AC | 무기 교체 후 Strike | inventory swap + compound | DEFER | — | §6 Compound Activity |
| Battle Cry | Feat | 7 | — | — | — | initiative 시 Demoralize | initiative trigger hook | DEFER | — | Lv 범위 밖. Demoralize 패턴만 참고 |

## 4. Spells (Cantrip / Rank 1–2 / Focus)

| Reference | Kind | Rank | Cost | Target | Check / DC | Primary Effect | Required capability | Status | Card ID | Fidelity Note |
|---|---|---|---|---|---|---|---|---|---|---|
| Telekinetic Projectile | Cantrip | C | 2 | enemy | spell attack vs AC | 물리 피해 | `check` + `armor-class` DC | SUPPORTED | `card.telekinetic-projectile` | 별도 Spell Attack statistic 없이 skill vs AC로 표현 |
| Frostbite | Cantrip | C | 2 | enemy | Fortitude vs actor DC | cold 피해 | `cold` damage type | EXTEND | `card.frostbite` | crit fail weakness rider 생략(DEFER) |
| Ignition / Produce Flame | Cantrip | C | 2 | enemy | spell attack vs AC | fire 피해 | `fire` damage type | EXTEND | `card.ember-lash` | persistent damage 생략. CardGuild 고유 이름 |
| Daze | Cantrip | C | 2 | enemy | Will vs actor DC | mental 피해 (+Stunned) | `mental` damage type | ADAPTED | `card.daze` | Stunned(행동 소모) 미구현으로 피해분만 |
| Electric Arc | Cantrip | C | 2 | enemy×2 | Reflex vs actor DC | electricity 피해 | multi-target | DEFER | — | §6 Multi-target |
| Shield | Cantrip | C | 1 | self | — | +1 circumstance AC | 자기 condition + **E7** | ADAPTED | `card.arcane-ward` | Shield Block 반응 생략. CardGuild 고유 이름 |
| Magic Missile / Force Barrage | Spell | 1 | 1–3 | enemy | 판정 없음 | force 피해 자동 명중 | 기존 `direct` + damage | SUPPORTED | `card.force-barrage` | 가변 action/미사일 수는 1-action 고정으로 ADAPTED |
| Heal | Spell | 1 | 1 | creature | 판정 없음 | HP 회복 | `restore-hp` + creature target | EXTEND | `card.heal` | 1-action touch(5ft)만. 3-action burst와 undead 피해 분기 생략. 원본대로 적도 대상이 될 수 있음 |
| Harm | Spell | 1 | 1–3 | enemy | Fortitude vs actor DC | void 피해 | `void` damage type | EXTEND | `card.harm` | single-target variant만. 가변 action/area DEFER |
| Fear | Spell | 1 | 2 | enemy | Will vs actor DC | Frightened 2 / 1 | valued condition | EXTEND | `card.fear` | crit success 시 fleeing 생략 |
| Soothe | Spell | 1 | 2 | ally | 판정 없음 | HP 회복 + 정신 저항 | `restore-hp` + ally target | EXTEND | `card.soothe` | status bonus 지속시간 축약 |
| Runic Weapon | Spell | 1 | 2 | ally | 판정 없음 | 무기 status 보너스 | ally target + attack status modifier + **E4 decay** | EXTEND | `card.runic-weapon` | 1분 지속을 대상의 다음 턴 종료까지로 축약 |
| Bless | Spell | 1 | 2 | aura | 판정 없음 | 아군 공격 status 보너스 | aura / multi-target lifecycle | DEFER | — | §6 Aura |
| Sure Strike | Spell | 1 | 1 | self | 판정 없음 | 다음 공격 fortune | fortune reroll framework | DEFER | — | §6 Fortune |
| Grim Tendrils / Burning Hands | Spell | 1 | 2 | area | save vs actor DC | 광역 피해 | burst/cone area model | DEFER | — | §6 Area |
| Command | Spell | 1 | 2 | enemy | Will vs actor DC | 강제 행동/이동 | forced movement + action denial | DEFER | — | §6 Forced Movement |
| Lay on Hands | Focus | 1 | 1 | creature | 판정 없음 | HP 회복 + AC 보너스 | `restore-hp` + creature target | EXTEND | `card.lay-on-hands` | Focus Point 자원 없음(ADAPTED). undead 피해 분기 생략 |
| Spirit Beacon *(CardGuild)* | Focus | — | 1 | self | 판정 없음 | Sustain 가능한 표식 | 기존 `create-sustained-effect` | SUPPORTED | `card.spirit-beacon` | CardGuild 고유. AoN 원본 없음 |
| Spirit Lance *(CardGuild)* | Focus | — | 1 | enemy | Reflex vs actor skill DC | force 피해 + Prone | 기존 `check` resolution | SUPPORTED | `card.spirit-lance` | CardGuild 고유. AoN 원본 없음 |

## 5. 기존 5 카드 fidelity audit

| Card | 현재 상태 | 판정 | 조치 |
|---|---|---|---|
| `card.trip` | Athletics vs Reflex DC → Prone | SUPPORTED | 유지. AoN 이름 사용 정당 |
| `card.fly` | Difficult/Impassable 무시 이동 | ADAPTED | 유지. 고도(3차원) 없음을 description에 명시 |
| `card.spirit-beacon` | Sustain 가능한 자기 효과 | SUPPORTED | 유지. CardGuild 고유 이름이라 fidelity 문제 없음 |
| `card.reactive-strike` | movement trigger 한정 reaction | ADAPTED | 유지. **movement-trigger subset**임을 description/여기 명시. 원본의 manipulate/ranged trigger 미구현 |
| `card.spirit-lance` | Reflex save vs Arcana DC, force 피해 | SUPPORTED | 유지. CardGuild 고유 이름 |

`knockdown` action은 카드가 없는 상태로 존재합니다. Strike + Prone outcome 패턴의 exemplar이므로
production card로 승격합니다.

---

## 6. DEFER Backflow 기록

각 항목은 §12.3이 요구하는 5개 필드를 갖습니다. **production 후보 2개 이상이 같은 capability를
요구하면 별도 Rules Expansion issue 후보**입니다.

### D1. Forced Movement — Rules Expansion 후보 ✅

- **Backflow Reason** — 대상 actor를 지정한 뒤 목적지까지 강제로 옮기는 모델이 없음
- **Required capability** — actor target + destination selection, forced path legality, 이동 중
  reaction 유발 정책
- **Affected references** — Shove, Reposition, Command, Telekinetic Maneuver
- **왜 부족한가** — `ActionTarget`은 actor 하나 또는 tile 하나만 고른다. 두 입력을 동시에 받는
  command shape가 없고, `MoveContinuation`은 이동 주체가 곧 actor임을 전제한다
- **Rules Expansion 경계** — multi-input target model + 강제 이동 경로 resolver

### D2. Compound / Subordinate Activity — Rules Expansion 후보 ✅

- **Backflow Reason** — 한 카드가 순차적 하위 action을 실행하는 모델이 없음
- **Required capability** — sequential selection, subordinate action traits/MAP 누적,
  이동 경로 중간 check
- **Affected references** — Sudden Charge, Tumble Through, Quick Draw
- **왜 부족한가** — `ActionResolution`은 단일 resolution이고 `useAction`은 한 번의 target으로
  끝난다. 중간 판정 결과에 따른 분기 continuation이 없다
- **Rules Expansion 경계** — `SequenceResolution` + multi-step command UX

### D3. Attacker-relative Condition — Rules Expansion 후보 ✅

- **Backflow Reason** — Condition이 actor-global이라 "이 공격자에게만" 상태를 표현할 수 없음
- **Required capability** — source-relative condition state, 판정 시 관측자별 modifier 조회
- **Affected references** — Feint, Snagging Strike, Create a Diversion, Off-Guard 전반
- **왜 부족한가** — `ConditionInstance`는 `sourceId`만 갖고 modifier stack은 관측자를 모른다.
  global `off-guard`로 근사하면 원본과 다른 게임이 된다(§12.4 금지)
- **Rules Expansion 경계** — relative condition state domain + modifier 조회 시 관측자 전달

### D4. Generic Pre-roll / Post-roll Reaction — Rules Expansion 후보 ✅

- **Backflow Reason** — 현재 pending reaction은 `enemy-move` + `MoveContinuation` 한 종류뿐
- **Required capability** — 공격 roll 직전/직후에 끼어드는 generic continuation
- **Affected references** — Aid, Reactive Shield, Nimble Dodge, Shield Block, Ready
- **왜 부족한가** — `PendingReaction.type`은 `"enemy-move"` 리터럴이고 continuation은 이동
  전용이다. check continuation을 넣으려면 새 command flow가 필요하다
- **Rules Expansion 경계** — generic pending-action/check continuation framework

### D5. Multi-target / Area / Aura — Rules Expansion 후보 ✅

- **Backflow Reason** — 하나의 카드가 여러 대상에 동시에 작용하는 모델이 없음
- **Required capability** — burst/cone/emanation 기하, 다중 대상 판정, 이동하는 aura lifecycle
- **Affected references** — Electric Arc, Bless, Burning Hands, Grim Tendrils, 3-action Heal
- **왜 부족한가** — `ActionTarget`이 단수이고 `ResolvedActionPlan`은 `targetActorId` 하나만 갖는다.
  다중 single-target command로 위장하는 것은 §12.4 금지
- **Rules Expansion 경계** — area/target-set selection model

### D6. Detection State (Hidden / Undetected)

- **Backflow Reason** — 관측자별 인지 상태가 없음
- **Required capability** — per-observer detection state, Seek/Hide 판정 파이프라인
- **Affected references** — Seek, Hide, Sneak, Point Out, Create a Diversion
- **왜 부족한가** — D3와 같은 근본 원인(관측자별 state)이며 line-of-sight만으로는 표현 불가
- **Rules Expansion 경계** — D3와 통합 검토 권장

### D7. Fortune / Misfortune

- **Backflow Reason** — 재굴림/결과 고정 framework 없음
- **Required capability** — roll 소비 시점 개입, 일시적 면역 lifecycle
- **Affected references** — Sure Strike, Assurance, Bit of Luck
- **왜 부족한가** — `rollCheck`는 단일 굴림이고 deterministic RNG contract가 재굴림을 모른다
- **Rules Expansion 경계** — roll interception + consumable modifier lifecycle

### D8. Resistance / Weakness / Immunity / Persistent Damage

- **Backflow Reason** — damage type이 event/identity로만 보존되고 방어 측 반응이 없음
- **Required capability** — 방어 프로필, 지속 피해 turn lifecycle
- **Affected references** — Frostbite crit rider, Ignition, 대부분의 원소 주문
- **왜 부족한가** — `applyDamage`는 type을 event에만 기록한다
- **Rules Expansion 경계** — damage 파이프라인 확장 (#13 §5.6이 metadata만 먼저 확보)

### D9. Spellcasting Resource Subsystem

- **Backflow Reason** — slot/focus point/tradition progression 없음 (§6에서 명시적 금지)
- **Affected references** — 모든 spell/focus 카드
- **판정** — #13은 spell-tagged card를 기존 resolver로만 표현한다. 자원 관리는 후속 milestone

### D10. Inventory / Handedness

- **Backflow Reason** — 손 점유·무기 교체·장비 낙하 모델 없음
- **Affected references** — Grapple, Combat Grab, Snagging Strike, Disarm, Quick Draw, Dueling Parry
- **판정** — free-hand 요구는 `equipped-slot` requirement로 **근사하지 않고** Fidelity Note에
  생략으로 기록한다. §5.1 union에 handedness를 넣지 않는다

---

## 7. 제안 EXTEND primitive (Phase B 후보)

각 primitive는 §12.2의 "2개 이상 재사용" 기준을 만족해야 합니다.

| # | Primitive | 여는 reference | 재사용 근거 |
|---|---|---|---|
| E1 | `ActionRequirement` (`weapon-mode` / `equipped-slot` / `skill-rank`) | Vicious Swing, Combat Grab, Dueling Parry, Grapple, Battle Medicine | 5개 이상. #9 `ResolvedStrikeProfile`과 #7 Character source를 그대로 읽음 |
| E2 | `ally` / `creature` targeting | Heal, Soothe, Lay on Hands, Runic Weapon, Battle Medicine | 5개. `ActionTarget` wire shape 불변, selector 의미만 확장 |
| E3 | `restore-hp` outcome primitive | Battle Medicine, Heal, Soothe, Lay on Hands | 4개, 3개 content family(feat/spell/focus). #8 current/max HP 경계 재사용 |
| E4 | valued `ConditionInstance` + `frightened` | Demoralize, Intimidating Strike, Fear | 3개 reference, 2개 family(skill action/feat/spell). #7/#8/#9 typed modifier stack 그대로 |
| E5 | `extraWeaponDice` + `mapAttackCount` | Vicious Swing, Intimidating Strike, Knockdown | 별도 feat executor 없이 `StrikeResolution` family 유지 |
| E6 | DamageType 확장 (`cold`/`fire`/`electricity`/`mental`/`void`/`acid`/`poison`/`sonic`/`spirit`/`vitality`) | Frostbite, Ignition, Daze, Harm, Electric Arc | metadata만. Resistance/Weakness subsystem은 D8로 backflow |

### E7 (추가 판정 필요) — Condition expiry policy

Take Cover / Dueling Parry / Arcane Ward 같은 **1턴 자기 버프**는 PF2e에서 "다음 자기 턴이
시작될 때까지" 지속합니다. E4의 `endTurnDelta: -1`로는 이것을 표현할 수 없습니다. 자기 턴
종료 시 value가 0이 되어 **적 턴 동안 효과가 없어지므로** 방어 버프로서 의미가 사라집니다.

현재 이 지속시간을 아는 것은 `ActorState.shieldRaised` 플래그 하나뿐이고, `advanceTurn()`이
해당 actor를 active로 만들 때 `false`로 되돌립니다. Raise Shield 전용 하드코딩입니다.

| | 내용 |
|---|---|
| 제안 | `ConditionDefinition`에 optional `expiry: "actor-turn-start"` 추가 |
| 동작 | `advanceTurn()`이 actor를 active로 만들 때 해당 policy를 가진 condition 제거 |
| 여는 카드 | `card.brace-behind-cover`, `card.dueling-parry`, `card.arcane-ward`, `card.runic-weapon` (4장, 3개 family) |
| §12.2 적합성 | existing Condition + Turn state domain 안에 머무름. 새 executor/command flow 없음. `shieldRaised` 하드코딩의 일반화 |
| §12.1 step 4 위험 | "기존 actor/condition/effect/turn 경계를 넘어서는 새로운 persistent lifecycle"에 해당하는지 여부가 판단 지점 |

**판정 결과 — 승인(EXTEND).** `ConditionDefinition.expiry`로 구현했고 `advanceTurn()`이 actor를
active로 만드는 지점에서 제거합니다.

구현하며 확인된 사실: **E4 decay와 E7 expiry는 서로 다른 지속시간을 표현하며 둘 다 필요합니다.**

| 지속 | 메커니즘 | 이유 | 카드 |
|---|---|---|---|
| 시전자의 다음 턴 시작까지 (방어 버프) | E7 `expiry: actor-turn-start` | 자기 턴에 걸고 **적 턴 동안** 효과가 있어야 함 | `brace-behind-cover`, `dueling-parry`, `arcane-ward` |
| 대상의 다음 턴 종료까지 (아군 공격 버프) | E4 `endTurnDelta: -1` | 아군이 **자기 턴에 쓴 뒤** 사라져야 함 | `runic-weapon` |

`runic-weapon`에 E7을 쓰면 대상의 턴이 시작될 때 사라져 버프가 무의미해집니다. 반대로 방어
버프에 E4를 쓰면 자기 턴 종료 즉시 사라져 적 턴을 못 막습니다.

---

## 8. Production card 후보 (24–32)

`#14`(starter grant)와 `#19`(reward placement)는 이 issue의 범위가 아닙니다. #13은
**카드가 존재하고 동작하는 것**까지 책임집니다.

| # | Card ID | Resolution | Cost | Target | 주요 축 |
|---|---|---|---|---|---|
| 1 | `card.trip` *(기존)* | Check | 1 | enemy | Skill vs Save DC → Prone |
| 2 | `card.fly` *(기존)* | Move | 1 | tile | 지형 무시 이동 |
| 3 | `card.spirit-beacon` *(기존)* | Direct | 1 | self | Sustained effect |
| 4 | `card.reactive-strike` *(기존)* | Strike | R | enemy | Reaction |
| 5 | `card.spirit-lance` *(기존)* | Check | 1 | enemy | 대상 Save + 피해 + 조건 |
| 6 | `card.knockdown` | Strike | 2 | enemy | Strike + 조건 outcome |
| 7 | `card.vicious-swing` | Strike | 2 | enemy | extraWeaponDice + MAP 2 + melee requirement |
| 8 | `card.intimidating-strike` | Strike | 2 | enemy | Strike + valued Frightened |
| 9 | `card.combat-grab` | Strike | 1 | enemy | Strike + Grabbed |
| 10 | `card.precise-jab` | Strike | 1 | enemy | agile/finesse requirement, MAP 완화 축 |
| 11 | `card.shield-bash` | Strike | 1 | enemy | shield slot requirement |
| 12 | `card.grapple` | Check | 1 | enemy | Athletics vs Fortitude DC |
| 13 | `card.demoralize` | Check | 1 | enemy | Intimidation vs Will DC → Frightened |
| 14 | `card.slip-free` | Check | 1 | self | Acrobatics escape |
| 15 | `card.battle-medicine` | Check | 1 | ally | Medicine vs fixed DC → restore-hp |
| 16 | `card.frostbite` | Check | 2 | enemy | 대상 Fortitude save, cold |
| 17 | `card.fear` | Check | 2 | enemy | 대상 Will save → Frightened 2/1 |
| 18 | `card.harm` | Check | 1 | enemy | 대상 Fortitude save, void |
| 19 | `card.telekinetic-projectile` | Check | 2 | enemy | skill vs 대상 AC |
| 20 | `card.ember-lash` | Check | 2 | enemy | skill vs 대상 AC, fire |
| 21 | `card.daze` | Check | 2 | enemy | 대상 Will save, mental |
| 22 | `card.overwhelming-presence` | Check | 2 | enemy | **Class DC** 사용 (대상 Will vs actor Class DC) |
| 23 | `card.force-barrage` | Direct | 1 | enemy | 판정 없는 자동 피해 |
| 24 | `card.heal` | Direct | 1 | creature | restore-hp, creature target |
| 25 | `card.soothe` | Direct | 2 | ally | restore-hp, ally target |
| 26 | `card.lay-on-hands` | Direct | 1 | creature | Focus restore-hp |
| 27 | `card.runic-weapon` | Direct | 2 | ally | ally 공격 status 보너스 |
| 28 | `card.brace-behind-cover` | Direct | 1 | self | AC circumstance + turn decay |
| 29 | `card.dueling-parry` | Direct | 1 | self | weapon slot requirement + AC |
| 30 | `card.arcane-ward` | Direct | 1 | self | AC + turn decay (cantrip 축약) |
| 31 | `card.tactical-step` | Move | 1 | tile | reaction 미유발 5ft |
| 32 | `card.bounding-stride` | Move | 1 | tile | 이동 후 자세 정리 |

### Coverage 확인

| 요구 | 최소 | 후보 충족 |
|---|---|---|
| MoveResolution | 3 | 3 (`fly`, `tactical-step`, `bounding-stride`) |
| StrikeResolution | 6 | 6 (`reactive-strike`, `knockdown`, `vicious-swing`, `intimidating-strike`, `combat-grab`, `precise-jab`, `shield-bash` = 7) |
| CheckResolution | 7 | 11 |
| DirectResolution | 3 | 8 |
| Reaction | 1 | 1 (`reactive-strike`) |
| Target-side Save | 3 | 5 (`spirit-lance`, `frostbite`, `fear`, `harm`, `daze`, `overwhelming-presence`) |
| Skill vs Statistic DC | 3 | 5 (`trip`, `grapple`, `demoralize`, `telekinetic-projectile`, `ember-lash`) |
| Class DC | 1 | 1 (`overwhelming-presence`) |
| HP Restore | 2 | 4 (`battle-medicine`, `heal`, `soothe`, `lay-on-hands`) |
| Valued Condition | 2 | 3 (`demoralize`, `intimidating-strike`, `fear`) |

---

## 9. 승인 상태

| 항목 | 상태 |
|---|---|
| Phase A matrix | 완료 (reference 59개 분류) |
| E1–E6 EXTEND 판정 (issue §5 명시) | **승인 · 구현 완료** |
| E7 condition expiry policy (issue 미명시) | **승인 · 구현 완료** |
| Phase B generic capability | 완료 |
| Phase C content production | 완료 (production card 32장) |
| Phase D/E validation | 완료 |

Pack version은 gameplay data가 늘었으므로 `cardguild.m7@0.1.0` → `@0.2.0`으로 올렸습니다.

## 10. 구현 중 변경된 판정

| 항목 | 초안 | 최종 | 이유 |
|---|---|---|---|
| `card.precise-jab` | agile 무기 요구 Strike | **`card.aimed-shot`** (ranged 요구, 2-action, +1 die) | `ActionRequirement` union에 weapon-trait kind가 없고, 카드 하나를 위해 추가하는 것은 §12.4 금지. `weapon-mode`가 이미 여는 축으로 대체 |
| `card.shield-bash` | AoN 원본 이름 | **`card.shield-press`** | shield weapon profile이 없어 장착 무기 damage를 쓴다. 핵심 semantics가 다르므로 CardGuild 고유 이름 |
| `card.tactical-step` / `card.bounding-stride` | Move 2장 | **`card.careful-advance` / `card.hover-step`** | 초안 2장은 기존 `step`/`stride` basic action과 mechanical duplicate였다. 최종 3장은 `movementMode × step × triggersReactions` 조합이 모두 다름 |
| `creature` targeting | "self 포함 가능" | self·아군·**적 포함** | issue §5.2의 "any non-defeated Actor" 정의를 그대로 따름. PF2e Heal도 대상을 "living creature"로 지정하므로 fidelity에 부합 |
| Phase B 구현 | 승인 후 착수 |
