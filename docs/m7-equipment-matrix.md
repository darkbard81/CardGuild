# M7 Equipment Trade-off Matrix

M7-6(#17)의 equipment 설계 기록입니다. 목적은 **#19 Adventure가 고르게 할 reward/sidegrade
pool**을 만드는 것이며, #17 자체는 reward를 Adventure에 연결하지 않습니다.

- 최종 reward placement — #19
- reachability / reserve gate — #20 (`docs/m7-production-gate.md`)
- 최종 balance와 노출 확대 — #21 (`docs/m7-playtest-report.md`): `dueling-rapier`·`scout-leather`·`spiked-shield`가 보상으로 나가고 reserve는 4종으로 줄었습니다
- fixed starter kit — #14 (아래 `baseline` item을 그대로 사용)

#13과 같은 원칙입니다: 수량이 아니라 **resolver가 실제로 보는 차이**가 item을 정당화합니다.

---

## 1. 왜 이 pack에서 trade-off가 성립하는가

이 roster의 선택지는 세 영웅의 authored profile에서 나옵니다. 같은 item이 캐릭터마다 다른
값을 갖기 때문에 "상위호환"이 잘 생기지 않습니다.

| | Aerin | Lyra | Brom |
|---|---|---|---|
| key attribute | STR 3 | **DEX 4** | STR 3 |
| weapon proficiency | martial **expert** | martial trained | martial trained |
| | simple trained, advanced untrained | simple trained | simple trained |
| armor proficiency | light·medium trained, **heavy untrained** | **light만** trained | **heavy expert** |

따라서:

- `simple` 무기는 Lyra·Brom에게 공짜지만 Aerin에게는 expert→trained로 **-2 공격**입니다.
- `advanced` 무기는 세 명 모두 untrained(+0)입니다. 손해는 각자의 martial rank만큼이라
  Aerin은 **-5**(expert +5), Lyra·Brom은 **-3**(trained +3)입니다. 의도적으로 build-gated입니다.
- `dexCap`은 DEX 4인 Lyra에게만 실질 손실입니다.
- heavy armor는 Brom만 이득을 봅니다.
- `finesse`는 DEX가 STR보다 높은 Lyra에게만 공격 수치를 바꿉니다.

## 2. Production item 인정 기준

같은 slot에서 아래 조합이 사실상 동일하면 mechanically duplicate로 봅니다.

```text
weapon  category + attackMode + range + damage profile + effective traits/providers
armor   category + acItemBonus + dexCap + meaningful modifier
shield  shieldBonus + meaningful provider/modifier
feet    modifier/provider와 실제 build interaction
```

이름만 다르거나 의미 없는 ±1 변형은 수량 근거가 아닙니다.

---

## 3. Matrix (25 definitions)

### Weapons (10)

| ID | Slot | Role | Primary trade-off | Resolver-visible difference | Class | Builds | AoN ref | Fidelity note |
|---|---|---|---|---|---|---|---|---|
| `halberd` | weapon | reach control | 10ft·1d10 대신 5ft 무기 대비 무겁다 | martial / melee / **reach 10** / 1d10 S / `trip` provider | baseline | Aerin | Halberd | 기존 정의 유지 |
| `light-blade` | weapon | agile finesse | 최소 damage die | martial / melee 5 / 1d6 S / `agile`+`finesse` | baseline | Lyra | Shortsword | 기존 |
| `guardian-mace` | weapon | balanced melee | trait 없음 | martial / melee 5 / 1d8 B | baseline | Brom | Mace | 기존 |
| `composite-shortbow` | weapon | long range | ranged라 STR damage 절반(`propulsive`) | martial / **ranged 60** / 1d6 P / `propulsive` | baseline | Lyra | Composite Shortbow | 기존 |
| `dueling-rapier` | weapon | defensive duelist | `agile`을 포기하고 방어 카드를 얻음 | martial / melee 5 / 1d6 P / `finesse` + **`card.dueling-parry` ×2** | reward | Lyra, Aerin | Rapier | Dueling Parry feat을 무기 provider로 전달. handedness(D10) 미구현 |
| `throwing-axes` | weapon | short-range skirmish | 사거리 20ft로 짧음 | martial / **ranged 20** / 1d6 S / `thrown`+`agile` | reward | Lyra | Throwing Axe | `thrown`이라 DEX 공격 + **STR damage 전량** |
| `greatsword` | weapon | raw damage | trait·reach 전무 | martial / melee 5 / **1d12 S** | reward | Aerin, Brom | Greatsword | two-hand 규칙은 D10로 미구현 |
| `boar-spear` | weapon | budget reach | `simple`이라 Aerin은 -2 공격 | **simple** / melee **reach 10** / 1d8 P | reward | Lyra, Brom | Boar Spear | — |
| `executioner-axe` | weapon | build-gated power | **advanced** untrained — Aerin -5, Lyra·Brom -3 | advanced / melee 5 / **1d12 S** / `trip` provider | reserve | (없음) | Greataxe 계열 | 의도적으로 현재 party가 쓸 수 없음. proficiency 성장 후를 위한 예비 |
| `flick-mace` | weapon | DEX strike + trip access | die가 1d6으로 작음 | martial / melee 5 / 1d6 B / **`finesse`** + `trip` provider | reward | Lyra | Flail | **`finesse`는 Strike의 공격 능력치만 DEX로 바꿉니다.** Trip은 Action이 Athletics를 명시하고 `attributeOverride`가 없어 그대로 STR 기반입니다 — PF2e 원본도 동일 |

### Armor (5)

| ID | Slot | Role | Primary trade-off | Resolver-visible difference | Class | Builds | AoN ref | Fidelity note |
|---|---|---|---|---|---|---|---|---|
| `leather-armor` | armor | light baseline | AC +1로 낮음 | light / +1 / **dexCap 4** | baseline | Lyra | Leather | 기존 |
| `scale-mail` | armor | medium baseline | dexCap 2 | medium / +3 / dexCap 2 | baseline | Aerin | Scale Mail | 기존 |
| `half-plate` | armor | heavy baseline | dexCap 1, heavy 숙련 필요 | heavy / +5 / dexCap 1 | baseline | Brom | Half Plate | 기존 |
| `scout-leather` | armor | stealth light | Athletics에 -1 circumstance | light / +1 / dexCap 4 / **+1 item Stealth, -1 circumstance Athletics** | reward | Lyra | Leather (scout) | Athletics 판정(Trip/Grapple)을 실제로 깎음 |
| `brigandine` | armor | DEX-poor medium | **dexCap 0** — DEX를 전혀 못 쓴다 | medium / **+4** / **dexCap 0** | **reserve** | (없음) | Brigandine | scale-mail과의 교차점은 실재하지만(DEX 0 우세 / 1 동률 / 2+ 열세) **현재 세 영웅 모두에게 dominated**입니다 — Aerin -1, Lyra -4, Brom -3. §5 참고 |

### Shields (4)

| ID | Slot | Role | Primary trade-off | Resolver-visible difference | Class | Builds | AoN ref | Fidelity note |
|---|---|---|---|---|---|---|---|---|
| `shield` | shield | baseline | — | shieldBonus **2** | baseline | Aerin, Brom | Steel Shield | 기존 |
| `buckler` | shield | save-leaning | AC 보너스가 1로 낮음 | shieldBonus **1** + **+1 item Reflex** | reward | Lyra | Buckler | — |
| `tower-shield` | shield | maximum AC | **공격에 -1 circumstance** | shieldBonus **3** + -1 circumstance attack | reward | Brom | Tower Shield | 원본의 Take Cover 연동은 미구현 |
| `spiked-shield` | shield | offensive shield | AC는 기본 방패와 동일 | shieldBonus 2 + **`card.shield-press` ×2** | reward | Aerin, Brom | Spiked Shield | Shield Press는 장착 무기 damage를 쓰는 CardGuild 고유 카드(#13) |

### Feet / utility (6)

| ID | Slot | Role | Primary trade-off | Resolver-visible difference | Class | Builds | AoN ref | Fidelity note |
|---|---|---|---|---|---|---|---|---|
| `boots-of-fly` | feet | terrain bypass | — | `card.fly` ×2 + **+1 item Reflex** | baseline | 전원 | Boots of Elvenkind 계열 | 기존 |
| `striders-boots` | feet | safe movement | 회피형 이동 카드만 제공 | **+1 item Athletics** + **`card.careful-advance` ×2** | reward | Brom, Aerin | Boots | Mobility feat 패턴을 카드로 전달(#13 ADAPTED) |
| `medics-kit` | feet | party support | 방어·이동 이득이 없음 | **`card.battle-medicine` ×2** | reward | 전원(Medicine trained) | Healer's Toolkit | 카드 자체에 `skill-rank medicine trained` requirement가 걸려 있음 |
| `warding-charm` | feet | caster defence | AC/이동 이득 없음 | **+1 item Will** + **`card.arcane-ward` ×2** | reward | Lyra, Aerin | Ward talisman | — |
| `hexers-focus` | feet | caster offence | 방어 이득 없음 | **+1 item Arcana** + **`card.frostbite` ×2** | reward | Aerin, Lyra | Wand / focus | Arcana 보너스가 Frostbite의 save DC를 직접 올림 |
| `bloodied-talisman` | feet | cursed trade | **Will에 -1 circumstance** | +1 item Fortitude, -1 circumstance Will | reserve | (없음) | Cursed talisman | 저주 해제 lifecycle이 없어 reserve로 둠 |

---

## 4. Reward build directions

분류는 **baseline 9 + reward 13 + reserve 3 = 25**입니다(#21 이후 실제 노출은 12종, 미노출 reserve는 `boar-spear`·`executioner-axe`·`brigandine`·`bloodied-talisman` 4종입니다). `reward` 13개가 아래 **다섯
방향**을 지원하며, AC가 요구한 최소 2개를 넘습니다.

| Direction | 조합 | 무엇이 달라지는가 |
|---|---|---|
| Defensive duelist | `dueling-rapier` + `buckler` + `warding-charm` | AC circumstance 카드 2종(`dueling-parry`, `arcane-ward`)과 Reflex/Will item 보너스. `agile`을 포기해 MAP이 나빠짐 |
| Heavy breaker | `greatsword` + `tower-shield` (기존 `half-plate` 위에) | 1d12 damage와 shield +3. 공격 -1 circumstance를 감수. heavy expert인 Brom이 AC 20을 유지한 채 화력을 올리는 방향 |
| DEX controller | `flick-mace` + `scout-leather` + `striders-boots` | Strike는 DEX로 굴리면서 Trip 접근을 얻는 조합. **Trip 자체는 STR 기반 Athletics**라, scout-leather의 Athletics -1과 striders-boots의 Athletics +1이 그 판정 위에서 직접 상쇄됩니다 |
| Party support | `medics-kit` + `shield` + `scale-mail` | `battle-medicine`으로 회복 축을 여는 대신 공격 성장 없음 |
| Spell skirmisher | `hexers-focus` + `throwing-axes` + `leather-armor` | Arcana item 보너스가 `frostbite` DC를 올리고, 20ft thrown이 STR damage를 유지 |

## 5. 의도적 중복과 예비

| Item | 판정 |
|---|---|
| `executioner-axe` | `greatsword`와 같은 1d12지만 **advanced**라 Aerin -5 / Lyra·Brom -3 공격이고 `trip`을 제공합니다. 현재 party로는 쓸 수 없어 `reserve`이며, proficiency가 성장한 뒤를 위한 예비입니다 |
| `brigandine` | pairwise로는 scale-mail과 실제 교차점이 있지만(dexCap 0 vs 2), **그 교차점의 이득을 볼 영웅이 현재 roster에 없습니다.** DEX가 낮으면서 heavy 숙련이 없는 캐릭터가 필요한데, DEX 0인 Brom은 heavy expert라 half-plate로 AC 20을 냅니다. 아래가 실측값입니다 |
| `bloodied-talisman` | 저주를 해제하는 lifecycle이 없어 `reserve`. #19에 노출하면 되돌릴 수 없는 선택이 됩니다 |
| `scout-leather` ↔ `leather-armor` | AC는 같지만 Stealth +1 / Athletics -1이 붙어 Trip·Grapple 빈도가 다른 build를 만듭니다 |

### Brigandine 실측 (level 1, 각 영웅의 starter armor 대비)

| Character | starter armor | AC | brigandine AC | 차이 |
|---|---|---:|---:|---:|
| Aerin (DEX 2, medium trained) | scale-mail | 18 | 17 | **-1** |
| Lyra (DEX 4, **medium untrained**) | leather-armor | 18 | 14 | **-4** |
| Brom (DEX 0, **heavy expert**) | half-plate | 20 | 17 | **-3** |

세 명 모두에게 열세이므로 `reward`로 노출하면 고를 이유가 없는 선택지가 됩니다. 새 runtime을
만들어 억지로 살리는 대신 `reserve`로 내리고, medium 숙련만 있고 DEX가 낮은 캐릭터가 roster에
생기면 그때 `reward`로 올립니다. 이 조건은 회귀 테스트로 고정되어 있습니다.

---

## 6. Scope boundary

이 이슈에서 구현하지 않은 것입니다. 필요하면 #13 Rule Backflow 기준으로 후속 Rules
Expansion 후보가 됩니다.

| 미구현 | 이유 |
|---|---|
| Consumable (potion / bomb / scroll) | quantity·consume·replenish·persistent inventory lifecycle 필요 |
| hand occupancy / free hand / two-hand | source model 없음 (#13 D10) |
| draw / swap / drop action economy | subordinate action 필요 (#13 D2) |
| item HP / broken state | 새 persistent state domain |
| rune progression, temporary weapon enhancement | #13 D11 |
| item script / effect DSL | §12.4 금지 |

`greatsword`·`executioner-axe`의 양손 규칙과 `dueling-rapier`의 free-hand 요구는 위 이유로
생략했고 Fidelity Note에 적었습니다. AoN 이름을 그대로 쓴 item은 핵심 전투 semantics(무기
category·사거리·damage·trait)가 보존된 경우로 한정했습니다.

## 7. Visual coverage

production equipment 25개 전부 `presentation/m3/asset-manifest.json`의 `equipmentVisuals`에
매핑합니다. `AssetCatalog.equipmentVisual()`은 미매핑 시 `null`을 반환하고 Loadout UI가
텍스트로 대체하므로 런타임 오류는 아니지만, reward 선택 화면에서 아이콘이 비면 선택지가
읽히지 않습니다.

### Checker가 보던 pack을 함께 고쳤습니다

`tools/assets/check-assets.ts`는 equipment/card visual map을 **`content/m3`**(M4 회귀
fixture) 기준으로 검증하고 있었습니다. #12에서 runtime을 production selector로 옮길 때 이
tool이 따라오지 않은 drift입니다. 그대로 두면 m7 장비를 몇 개 매핑하든 checker가 알지
못하므로 이 이슈의 "visual coverage 완료"를 검증할 수단이 없었습니다.

`PRODUCTION_CONTENT.pack.combatContent`를 읽도록 바꿨고, 그 결과 **production card 32종도
전부 아이콘이 필요**해졌습니다. equipment만 채우고 card 검증을 느슨하게 만드는 것은 검사를
약화시키는 선택이라, 부족했던 card icon 28종을 함께 생산했습니다.

| | before | after |
|---|---|---|
| checker가 보는 pack | `content/m3` (3 equipment / 4 cards) | production pack (25 / 32) |
| equipmentVisuals | 3 | **25** |
| cardVisuals | 4 | **32** |
| atlas frames | 58 | **108** |
| `m3-atlas.webp` | 3.61 MB | **6.06 MB** |

`presentation/m3/asset-manifest.json`은 build 산출물입니다. 실제 source of truth는
`art/source/generation-plan.json`의 `presentation` 블록이고, `npm run assets`가 manifest를
거기서 다시 씁니다.

atlas가 lossless WebP라 6MB까지 커졌습니다. 최종 asset/release 정책은 #20 gate 대상이며,
줄여야 한다면 lossless 해제가 첫 후보입니다.
