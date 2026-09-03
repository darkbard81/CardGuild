# M7 Production Content Gate

M7-9(#20)의 release gate 설계 기록입니다. 새 validator framework를 만드는 이슈가 아니라,
이미 있는 schema/semantic/fingerprint validator와 runtime을 **authoritative pack 하나에만
적용되는 release policy**로 다시 묶는 이슈입니다.

```text
npm run content:check              모든 milestone pack의 generic validity
npm run content:production-check   현재 PRODUCTION_CONTENT의 M7 release policy
```

`npm run check`가 둘을 차례로 실행하고 CI는 `npm run check`를 그대로 씁니다. 새 CI job도,
새 network/runtime smoke도 추가하지 않았습니다 — `tests/network`와 `tests/runtime.smoke.spec.ts`는
이미 `PRODUCTION_CONTENT`와 `adventure.goblin-trouble`을 실제 WebSocket session과 브라우저로
지나갑니다.

---

## 1. 왜 command를 나눴는가

`tools/content/check-content.ts`는 `content/` 아래 pack을 전부 순회합니다. 여기에
`starter == 4`나 `enemy >= 15`를 넣으면 M3/M6 회귀 fixture가 M7 volume 기준에 묶입니다.
두 fixture는 **규칙 회귀**를 지키기 위해 존재하므로 production 수량을 따라갈 이유가 없습니다.

그래서 volume·reachability·coverage는 `tools/content/check-production-content.ts`가
`PRODUCTION_CONTENT` 하나에만 적용합니다. Generic validator는 그대로입니다.

## 2. Policy는 코드이고 문서는 근거다

Tutorial prefix나 reserve를 Markdown에서 파싱하지 않습니다. CI가 읽는 release policy는
`tools/content/m7-production-policy.ts` 하나이고, 이 문서와
`docs/m7-encounter-matrix.md`·`docs/m7-equipment-matrix.md`·`docs/m7-card-capability.md`·
`docs/m7-vertical-slice.md`는 사람이 읽는 근거입니다.

Policy는 gameplay content도 runtime selector도 아닙니다. `src/` 아래 어떤 파일도 이것을
import할 수 없고, import하면 gate가 `POLICY_LEAKED_INTO_RUNTIME`으로 실패합니다.

## 3. Reserve는 면제가 아니라 기록된 부채

모든 production 정의를 Adventure 안에 억지로 넣지는 않습니다. 하지만 reserve가 단순히
orphan 검사를 끄는 ID 목록이면, 도달 불가능한 content가 늘어날수록 검사 자체가 무의미해집니다.
그래서 reserve entry는 **검증 가능한 주장**입니다.

| 조건 | 실패 code |
|---|---|
| 실제 production 정의를 가리킨다 | `RESERVE_UNKNOWN_ID` |
| 목록 안에서, 목록 사이에서 한 번만 나온다 | `RESERVE_DUPLICATE` |
| 왜 도달 불가능한 채로 출시되는지 적는다 | `RESERVE_MISSING_REASON` |
| 이것을 정리할 issue를 `#<number>`로 적는다 | `RESERVE_MISSING_FOLLOW_UP` |
| tutorial prefix와 동시에 존재하지 않는다 | `RESERVE_TUTORIAL_CONFLICT` |
| **여전히 도달 불가능하다** | `RESERVE_STALE` |

마지막 조건이 목록을 살아 있게 합니다. Adventure가 쓰기 시작한 정의를 reserve에 그대로 두면
gate가 실패하므로, reserve는 자기 이유보다 오래 살아남지 못합니다.

### reachableMinimum이 실제로 보장하는 것

`reachableMinimum`은 **이미 도달 가능한 정의를 reserve로 내려 release surface를 줄이는 것**을
막습니다. card 하나를 reserve로 옮기면 도달 가능한 card가 하한 아래로 떨어지므로, 그 이동은
하한 자체를 고치는 검토를 거쳐야 합니다.

reserve 예산은 아닙니다. 새로 authoring한 정의를 처음부터 reserve에 넣으면 reachable 수량은
그대로이므로 `volume` 상한(예: equipment 30)까지는 gate를 통과합니다. #20이 요구한 것은
reserve가 wildcard 면제가 아니라 explicit / reviewable / stale-detectable 목록이어야 한다는
것이므로 별도의 reserve max나 ratio는 두지 않았습니다. 그것을 invariant로 만들고 싶다면
별도 budget이 필요하고, 그 판단은 이 issue의 scope 밖입니다.

wildcard나 regex로 family 전체를 숨기는 방법은 제공하지 않습니다. ID를 하나씩 적어야 합니다.

### 사용된 것과 소유할 수 있는 것

reachability는 두 집합입니다. orphan 검사와 visual coverage는 release가 **사용하는** 정의를
묻고(enemy가 착용한 item도 사용된 것입니다), `reachableMinimum`은 플레이어가 **소유할 수
있는** 정의(starter의 kit과 Adventure reward)만 셉니다. 현재 M7 enemy는 equipment도
baseCardGrant도 없어 두 집합이 같지만, 나중에 enemy가 장비를 들어도 player floor가
그것으로 채워지지 않습니다.

## 4. Volume과 reachability는 현재 release contract

이 수치는 gameplay 규칙이 아닙니다. `content/m7`이 지금 무엇을 출시하는가에 대한 진술이며
`#21`이 dead card를 정리하면 함께 갱신되는 값입니다. 규칙은 여전히 schema와 semantic
validator가 소유합니다.

| | 현재 | contract |
|---|---:|---|
| playable starter | 4 | 정확히 4 |
| player card | 32 authored / **26 player-reachable** | 24–32 / 최소 26 |
| enemy | 18 authored / **14 배치됨** | 15–20 / 최소 14 |
| scenario | 10 authored / **8 사용됨** | 8–12 / 최소 8 |
| equipment | 25 authored / **21 player-reachable** | 20–30 / 최소 21 |
| Adventure encounter | 8 | 6–8, authoritative Adventure 정확히 1개 |
| tutorial prefix | 4 | 3–4, `encounterIds`의 연속 prefix |

Card 32개 중 11개가 도달 불가능하다는 것이 이 gate가 처음 드러낸 사실이었습니다. #21이 그중
다섯 장을 열었습니다 — 보상마다 네 번째 선택지를 더해 `force-barrage`·`fear`·`vicious-swing`을
직접 제공하고, `dueling-rapier`·`spiked-shield`를 노출해 provider에 달려 있던
`dueling-parry`·`shield-press`까지 살렸습니다. 남은 여섯 장(`aimed-shot`, `daze`, `ember-lash`,
`harm`, `spirit-edge`, `telekinetic-projectile`)은 이유와 후속 issue를 단 explicit reserve로
남습니다. gate가 한 일은 그것을 조용히 넘어가지 않게 만든 것입니다.

## 5. 무엇을 만들지 않았는가

새 규칙을 만들지 않고 이미 있는 것을 그대로 호출합니다.

| 검증 | 소유자 |
|---|---|
| starter loadout, reward 사용 가능성 | `validatePartyLoadout` / `createStartingCollection` |
| reachable card 집합 | `deriveTacticalDeck` (equipment trait provider 포함) |
| 1P/2P/3P encounter 조립 | `createAdventureSession` → `buildAdventureEncounter` → `createCombat` |
| party-size applicability | #16 `placementAppliesToPartySize` (위 경로 안에서) |
| creature AI 행동 | #15 `src/game/creature-ai.test.ts` |
| schema / reference / fingerprint | `npm run content:check` |
| asset 자체의 유효성 | `npm run assets:check` |

Production gate가 AI에 대해 보는 것은 **정적 참조**뿐입니다. Adventure가 배치하는 enemy가
Fixed Strike나 innate action 중 하나는 가졌는지, innate ID가 실재하며 AI가 겨냥할 수 있는
targeting인지까지입니다. no-command hard failure 회귀는 계속 #15의 unit test가 소유하고,
production check는 AI simulator로 자라지 않습니다.

Visual coverage도 마찬가지로 새 asset policy를 만들지 않습니다. `assets:check`가 이미
equipment/card visual map이 production pack과 정확히 일치하도록 강제하므로, gate는 여기에
**release가 그려야 하는 actor 집합**만 더합니다 — 4 starter와 Adventure가 실제로 배치하는
enemy가 앞뒤 두 장을 가졌는가.

## 6. 남는 판단

- dead / dominant card와 equipment의 최종 정리 — #21이 수행했습니다
  (`docs/m7-playtest-report.md`). reserve는 25 → **16**으로 줄었고, 남은 항목은 전부 이유와
  후속 issue를 답니다.
- 남은 reserve를 언제 열거나 자를지 — 후속 balance 판단
