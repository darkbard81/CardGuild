# PF2e Tactical Adventure

## Core System Design v0.2

### Card Hunter Reference Integration

---

# 1. 게임 정의

본 프로젝트는 다음을 결합한 **1~3인 협력 Tactical Adventure Board RPG**다.

> **Card Hunter식 Adventure 진행**
>
> * **격자형 Tactical Board Combat**
> * **PF2e Remaster Rule Engine**
> * **항상 사용할 수 있는 핵심 Basic Actions**
> * **조건에 따라 활성화되는 Context Basic Actions**
> * **Active Feat / Focus Spell / Item 기반 카드 획득**
> * **Equipment Trait에 의해 자동 구성되는 Tactical Deck**

핵심 게임 루프:

```text
HUB
 ↓
Adventure 선택
 ↓
Party / Equipment / Deck 구성
 ↓
Encounter
 ↓
Loot
 ↓
Encounter
 ↓
Boss / Objective
 ↓
Adventure Reward
 ↓
HUB
```

Card Hunter처럼 **새로운 적과 환경을 보고 장비를 다시 구성하는 것 자체가 전략**이어야 한다.

Card Hunter 공식 가이드 역시 특정 적에게 막히면 높은 공격력의 장비만 고집하지 말고, 적의 카드/특성에 대응하는 장비로 파티를 다시 구성하는 것을 핵심 전략으로 설명한다.

우리 게임에서는 이를 다음과 같이 확장한다.

> **Enemy Traits + Terrain Traits 파악**
>
> ↓
>
> **Equipment 변경**
>
> ↓
>
> **Statistics 변경 + Deck 변경**
>
> ↓
>
> **전술 자체가 변화**

---

# 2. 가장 중요한 설계 원칙

## Rule #1 — Basic Action은 카드가 아니다.

다음 세 행동은 캐릭터의 **고정 Basic Action**이다.

```text
STEP
STRIDE
STRIKE
```

Hand 상태, Deck 상태, Equipment Trait와 관계없이 항상 Basic Action System에 존재한다.

단, 실제 사용 가능 여부는 PF2e Rule Engine이 판정한다.

예:

```text
STEP

항상 Basic Action 목록에는 존재
하지만

Prone
Speed < 10
Difficult Terrain
특정 Effect

등으로 현재 실행할 수 없다면 Disabled
```

PF2e Remaster에서도 Step, Stride, Strike 등은 여러 능력의 기반이 되는 공통 행동이다.

---

# 3. Conditional Basic Actions

다음 행동들은 **카드로 만들지 않는다.**

대신 필요한 상황이 발생했을 때 Basic Action 영역에 나타나는 **고정 Context Action**이다.

```text
ESCAPE
INTERACT
RAISE A SHIELD
SUSTAIN A SPELL
```

UI 구조는 따라서:

```text
BASIC
────────────────────────
[STEP] [STRIDE] [STRIKE]

CONTEXT
────────────────────────
[ESCAPE]
[INTERACT]
[RAISE SHIELD]
[SUSTAIN]
```

Context 영역은 현재 상황에 따라 자동으로 활성화된다.

---

# 4. Escape는 Recovery Action의 UX Wrapper다

게임 화면에서 `ESCAPE`는 하나의 버튼으로 보이지만 내부적으로는 **현재 캐릭터가 사용할 수 있는 각종 회복/해제 행동의 Context Menu**다.

예:

```text
ESCAPE
  │
  ├─ Stand
  │    └─ Prone 상태일 때
  │
  ├─ Escape Grab
  │    └─ Grabbed 상태일 때
  │
  ├─ Escape Restraint
  │    └─ Restrained 상태일 때
  │
  ├─ Escape Immobilization
  │    └─ Immobilized 상태일 때
  │
  └─ Condition-specific Recovery
       └─ 해당 Effect가 제공
```

중요한 것은 **UI만 Escape로 통합한다는 것**이다.

내부 Rule Action은 각각 그대로 유지한다.

예:

```text
ESCAPE UI
  ↓
Stand
Traits: Move
Action Cost: 1
```

또는

```text
ESCAPE UI
  ↓
Escape
Traits: Attack
Action Cost: 1
Check: Athletics / Acrobatics / Unarmed
```

따라서 PF2e 규칙의 의미를 훼손하지 않고 UI 복잡도만 낮출 수 있다.

PF2e에서 Stand는 Prone에서 일어나는 Move 행동이고, Escape는 Grabbed·Immobilized·Restrained 등을 벗어나기 위한 Attack 행동으로 서로 다른 규칙 요소다.

---

# 5. Interact

`Interact` 역시 Deck에 들어가지 않는다.

현재 캐릭터 주변에 Interact 가능한 Object가 존재하면 Context Action으로 활성화한다.

예:

```text
INTERACT

Door
Chest
Lever
Dropped Weapon
Objective
Consumable
Held Item
Environmental Object
```

선택하면:

```text
INTERACT
  ↓
Available Targets Query
  ↓
Door
Chest
Lever
```

와 같이 표시한다.

PF2e의 Interact는 물체나 지형을 조작하고, 물건을 집거나 무기를 꺼내고 문을 여는 등의 행동을 담당한다.

---

# 6. Raise a Shield

다음 조건을 만족하면:

```text
Actor
  has usable Equipment
       ↓
Equipment Trait: Shield
       ↓
Requirements satisfied
```

`Raise a Shield`가 Context Basic Action에 활성화된다.

```text
RAISE SHIELD
●

AC + Shield Circumstance Bonus
Until next turn
```

Shield가 없으면 버튼 자체를 숨기거나 비활성화한다.

즉 Shield Item은:

```text
Shield
├─ Statistics
├─ Traits
└─ Rule Elements
```

을 통해 Basic Action 사용 권한을 제공한다.

PF2e에서도 Raise a Shield는 방패를 들고 있다는 Requirement 아래 작동한다.

---

# 7. Sustain a Spell

현재 캐릭터가 Sustain 가능한 Spell Effect를 가지고 있다면 Context Basic Action으로 나타난다.

예:

```text
SUSTAIN
  │
  ├─ Flaming Sphere
  ├─ Summoned Creature
  └─ Persistent Magical Effect
```

여러 효과가 존재하면 플레이어가 대상을 선택한다.

```text
SUSTAIN A SPELL
●

Select Effect
       ↓
Resolve Sustain
```

Sustain의 대상과 추가 효과 역시 Trait / Effect Rule을 통해 결정한다.

PF2e Remaster의 Sustain은 지속 중인 효과의 지속시간을 연장하거나 해당 효과가 정의한 추가 효과를 발생시킨다.

---

# 8. Action System 최종 구조

결과적으로 전투 행동은 세 계층이다.

## Layer A — Fixed Basic

```text
Step
Stride
Strike
```

항상 존재.

---

## Layer B — Conditional Basic

```text
Escape
Interact
Raise a Shield
Sustain a Spell
```

조건에 따라 활성화.

**Deck과 무관하다.**

---

## Layer C — Tactical Cards

```text
Active Feat
Focus Spell
Item Activation
Consumable
Equipment Trait Card
Reaction
기타 획득 능력
```

이것이 실제 카드게임 영역이다.

즉:

> **기본적인 Pathfinder 캐릭터 행동은 항상 가능하고,
> 카드는 특별한 전술을 추가한다.**

---

# 9. Universal Trait Architecture

본 프로젝트에서 가장 중요한 시스템이다.

> **모든 Game Object는 Trait을 가진다.**

PF2e의 Trait 개념을 게임 전체 Object Model로 확장한다.

```ts
interface GameObject {
  id: ObjectId;
  kind: ObjectKind;

  traits: TraitInstance[];
}
```

Object 종류:

```ts
type ObjectKind =
  | "actor"
  | "item"
  | "card"
  | "action"
  | "condition"
  | "effect"
  | "terrain"
  | "tile"
  | "hazard"
  | "objective"
  | "spell";
```

즉 다음 모두 Trait을 가진다.

```text
Character
Monster
Weapon
Armor
Boots
Shield
Card
Action
Spell
Condition
Terrain
Tile Effect
Hazard
Objective
```

---

# 10. Trait은 단순 Tag가 아니다

Trait은 다음 중 하나 이상의 기능을 할 수 있다.

```text
Semantic Tag
Rule Modifier
Action Modifier
Action Provider
Card Provider
Statistic Modifier
Movement Modifier
Targeting Modifier
Trigger Provider
Reaction Provider
Damage Modifier
Resistance / Weakness Interaction
```

예를 들어:

```text
Agile
```

은 Card를 제공할 필요는 없지만 MAP 계산에 영향을 준다.

반면:

```text
Trip
```

은 Weapon Rule에 영향을 주면서 동시에 **Trip Card를 Deck에 추가**할 수 있다.

```text
Shield
```

은 `Raise a Shield` Context Action을 활성화한다.

```text
Fly
```

는 Fly Card를 Deck에 추가한다.

---

# 11. Trait Definition

권장 구조:

```ts
interface TraitDefinition {
  id: TraitId;
  name: string;

  categories: TraitCategory[];

  ruleElements?: RuleElement[];

  cardGrants?: CardGrantRule[];

  actionGrants?: ActionGrantRule[];
}
```

예:

```ts
const tripTrait: TraitDefinition = {
  id: "trip",
  name: "Trip",

  categories: ["weapon"],

  cardGrants: [
    {
      cardId: "action.trip",
      when: [
        "source:equipped",
        "source:wielded"
      ]
    }
  ]
};
```

---

# 12. Trait은 Object에 복수 존재할 수 있다

```ts
interface TraitInstance {
  id: TraitId;

  params?: Record<string, unknown>;

  source?: ObjectId;
}
```

예:

```text
Halberd

Traits
────────────────
Weapon
Martial
Trip
Reach
Polearm
```

하나의 Object가 여러 Trait을 동시에 가지고, 모든 Rule Query가 이를 참조한다.

---

# 13. Terrain도 Trait 기반 Object다

Card Hunter는 보드의 Terrain을 크게:

```text
Open
Difficult
Impassable
Blocked
```

네 종류로 구분하고, Difficult는 이동을 방해하며, Impassable은 이동은 막지만 시야는 통과시키고, Blocked는 이동과 시야를 모두 차단한다.

우리 프로젝트에서는 이것을 **서로 배타적인 Terrain Type으로 만들지 않는다.**

대신:

> **Terrain Trait**

으로 만든다.

따라서 Terrain 하나가 여러 Trait을 동시에 가질 수 있다.

---

# 14. Terrain Trait

기본 Board Trait:

```text
Open
Difficult
Impassable
Blocked
```

예:

```text
Normal Floor

Traits:
Open
```

```text
Rubble

Traits:
Open
Difficult
```

```text
Deep Chasm

Traits:
Impassable
```

```text
Stone Wall

Traits:
Blocked
Stone
```

```text
Burning Rubble

Traits:
Open
Difficult
Fire
Hazard
```

---

# 15. Terrain Trait은 삭제하지 않고 합성한다

예를 들어:

```text
Open
+
Difficult
```

가 같이 존재할 수 있다.

이때 Rule Engine은 질문에 따라 결과를 계산한다.

### CanEnter?

```text
Open       → Allow
Difficult  → Allow
```

결과:

```text
Allow
```

### MovementCost?

```text
Open       → Normal
Difficult  → +5 ft
```

결과:

```text
10 ft per square
```

PF2e Difficult Terrain은 해당 공간으로 이동할 때 추가 이동 비용을 요구하며 Step으로 들어갈 수 없다.

---

# 16. Terrain Rule Resolution

기본 규칙:

| Trait      | Enter | Movement | Line of Sight |
| ---------- | ----- | -------- | ------------- |
| Open       | 가능    | Normal   | 통과            |
| Difficult  | 가능    | +5 ft    | 통과            |
| Impassable | 불가    | —        | 통과            |
| Blocked    | 불가    | —        | 차단            |

복수 Trait일 경우 **각 Query가 독립적으로 판단한다.**

예:

```text
Open + Difficult
```

→ 들어갈 수 있음
→ 이동비용 증가
→ Step 불가

```text
Impassable + Fire
```

→ Land Movement 불가
→ LOS 가능
→ Fire Trait은 별도 Effect와 상호작용

```text
Blocked + Fire
```

→ Movement 불가
→ LOS 불가
→ Fire Trait은 여전히 존재

즉 `Blocked`가 있다고 해서 다른 Trait을 삭제하지 않는다.

---

# 17. Movement Mode까지 Trait Query에 포함한다

다음과 같은 Query를 사용한다.

```ts
interface MovementQuery {
  actorId: ActorId;

  from: TileId;
  to: TileId;

  movementMode:
    | "land"
    | "fly"
    | "swim"
    | "climb"
    | "burrow";
}
```

따라서:

```text
Difficult
```

이 모든 이동 방식에 무조건 적용되는 것이 아니다.

Terrain Trait은 필요하면:

```ts
{
  id: "difficult",
  params: {
    affects: ["land"]
  }
}
```

형태로 정의할 수 있다.

이를 통해 Fly 같은 능력이 자연스럽게 Terrain Rule과 상호작용한다.

---

# 18. Tile 자체도 하나의 Object다

Tile은 하나의 Terrain 이름만 가지는 구조보다 다음처럼 구성한다.

```ts
interface TileState extends GameObject {
  x: number;
  y: number;

  terrainObjects: ObjectId[];

  attachments: EffectId[];

  occupantIds: ActorId[];
}
```

예:

```text
Tile (4, 7)

Base:
Stone Floor
  └─ Open

Attachment:
Burning Oil
  ├─ Difficult
  ├─ Fire
  └─ Hazard

Effective Traits:
Open
Difficult
Fire
Hazard
```

이 구조가 Spell, Hazard, 환경 변화에 매우 유리하다.

---

# 19. Card Hunter Attachment 개념의 확장

Card Hunter에서는 지속 효과가 캐릭터 또는 Board Square에 붙고 Duration을 가진다.

우리 시스템에서는 이를 일반화한다.

```ts
interface EffectInstance extends GameObject {
  sourceId: ObjectId;

  targetId: ObjectId;

  duration: DurationDefinition;

  ruleElements: RuleElement[];
}
```

Effect는 다음에 붙을 수 있다.

```text
Actor
Item
Tile
Terrain
Card
Objective
```

예:

```text
Actor
  + Frightened

Tile
  + Burning Ground

Weapon
  + Temporary Rune Effect
```

Effect 자신도 Trait을 가진다.

---

# 20. Condition도 Trait 기반 Effect다

예:

```text
Prone

Traits:
Condition
Prone
```

Rule Elements:

```text
Movement restriction
Off-Guard interaction
Escape UI → Stand 제공
```

또는:

```text
Grabbed

Traits:
Condition
Grabbed
Escapeable
```

Rule Elements:

```text
Movement restrictions
Manipulate interaction
Escape UI → Escape variant 제공
```

따라서 `Escape` 버튼을 코드에서 상태별 if/else로 만드는 것이 아니다.

각 Condition이:

> **“나는 이 Recovery Action을 제공한다.”**

라고 Rule Engine에 알려준다.

---

# 21. Conditional Basic Action Query

매 Turn UI는 다음 Query를 실행한다.

```ts
getAvailableContextActions(actorId)
```

각 Object가 Rule을 제공한다.

예:

```text
Prone Condition
  → Stand

Grabbed Condition
  → Escape

Adjacent Door
  → Interact

Equipped Shield
  → Raise Shield

Sustained Spell Effect
  → Sustain Spell
```

결과:

```ts
[
  {
    group: "escape",
    action: "stand"
  },
  {
    group: "interact",
    action: "open-door",
    target: "door-71"
  },
  {
    group: "shield",
    action: "raise-shield"
  }
]
```

DOM UI는 이 결과만 표시한다.

---

# 22. Equipment의 역할

Equipment는 **두 가지를 동시에 바꾼다.**

> **Statistics**
>
> *
>
> **Tactical Deck**

이것이 본 게임에서 가장 중요한 Character Build 구조 중 하나다.

---

# 23. Equipment Statistics

장비는 PF2e Rule Engine의 Statistic에 직접 영향을 준다.

```text
Weapon
→ Damage
→ Attack
→ Reach
→ Damage Type

Armor
→ AC
→ Dex Cap
→ 기타 관련 Statistic

Boots
→ Save
→ Speed
→ Movement

Shield
→ Shield Statistics
→ Raise Shield
```

Modifier는 PF2e Modifier Engine을 통해 계산한다.

장비가 UI 값을 직접 변경하는 것이 아니다.

```text
Equipment
   ↓
Modifier Contribution
   ↓
Statistic Query
   ↓
Final Value
```

---

# 24. Equipment Trait → Card Injection

Equipment의 Trait 중 `Card Grant` 기능을 가진 Trait은 Character의 **Base Tactical Deck**에 Card를 자동으로 추가한다.

핵심 공식:

```text
Character Base Deck

=
Selected Active Feats
+
Selected Focus Spells
+
Item / Consumable Cards
+
Equipment Trait Cards
```

Fixed / Conditional Basic Actions는 여기에 포함되지 않는다.

---

# 25. 예시 1 — Halberd

프로젝트 데이터 예:

```text
HALBERD

Damage:
1d12

Traits:
Trip
```

장착하면:

```text
Character Statistics
    ↓
Strike Damage = Halberd 1d12 기반
```

동시에:

```text
Trip Trait
    ↓
Trait Registry
    ↓
Grant Card: Trip
```

따라서:

```text
BEFORE

Deck
────────────
Vicious Swing
Sudden Charge
Reactive Strike
...
```

Halberd 장착:

```text
AFTER

Deck
────────────
Vicious Swing
Sudden Charge
Reactive Strike
Trip        ← Halberd
...
```

---

# 26. Card는 Source와 연결된다

자동 생성된 Card는 단순 `Trip Card`가 아니다.

```ts
interface CardInstance {
  id: CardInstanceId;

  definitionId: CardDefinitionId;

  source: {
    objectId: ObjectId;
    traitId?: TraitId;
  };
}
```

예:

```text
Trip

Source:
Halberd

Granted By:
Trip Trait
```

카드 상세 화면에서도 이를 표시한다.

```text
TRIP

Success 72%
Target becomes Prone

──────────────────
Source
Halberd

Trait
Trip
```

---

# 27. Trait Card는 Source Object를 사용한다

Trip Card 안에 Halberd 데이터를 복사해 넣지 않는다.

Card 실행 시:

```text
Trip Card
   ↓
sourceObject = Halberd
   ↓
Current Halberd Statistics
   ↓
Rule Engine
```

을 사용한다.

따라서 Weapon Rune이나 Buff 때문에 Halberd의 Item Bonus가 변하면 Trip에도 자연스럽게 반영된다.

PF2e의 Trip Weapon Trait 역시 해당 무기를 사용한 Athletics 체크에서 그 무기의 관련 보너스를 사용할 수 있게 하는 구조다.

---

# 28. 예시 2 — Boots of Fly

프로젝트 데이터:

```text
BOOTS OF FLY

Modifiers:
Reflex Saving Throws +1

Traits:
Fly
```

장착 결과:

```text
Statistic Engine
       ↓
Reflex Save +1
```

그리고:

```text
Fly Trait
   ↓
Grant Card
   ↓
FLY
```

Base Deck:

```text
...
Heal
Power Attack
Trip
Fly          ← Boots of Fly
...
```

즉 Boots 하나가:

> **수치적 성장**
>
> *
>
> **새로운 Tactical Action**

두 가지를 동시에 제공한다.

---

# 29. 모든 Trait이 Card를 제공하지는 않는다

중요하다.

Trait은 각각 역할이 다르다.

예:

```text
Trip
→ Card Grant

Fly
→ Card Grant

Agile
→ MAP Modifier

Shield
→ Conditional Basic Action Grant

Fire
→ Damage / Resistance Interaction

Undead
→ Target / Damage Interaction

Difficult
→ Movement Rule

Blocked
→ Movement + LOS Rule
```

따라서:

```ts
trait.cardGrants
```

는 Optional이다.

---

# 30. Card Grant Rule

```ts
interface CardGrantRule {
  cardId: CardDefinitionId;

  requirement?: PredicateDefinition;

  count?: number;

  uniqueness?:
    | "per-source"
    | "per-actor";
}
```

예:

```ts
{
  cardId: "trip",

  requirement: {
    all: [
      "source:equipped",
      "source:wielded"
    ]
  },

  count: 1,

  uniqueness: "per-source"
}
```

---

# 31. Encounter Deck 생성

Encounter 시작 전에 Deck을 만든다.

```text
BUILD DECK
     ↓
Active Feats
     ↓
Focus Spells
     ↓
Carried Item Cards
     ↓
Equipped Items 순회
     ↓
Trait Registry Query
     ↓
Granted Cards 추가
     ↓
Shuffle
```

Pseudo:

```ts
function buildCombatDeck(actor: ActorState): CardInstance[] {
  return [
    ...getSelectedFeatCards(actor),
    ...getSelectedFocusSpellCards(actor),
    ...getItemCards(actor),
    ...getEquipmentTraitCards(actor)
  ];
}
```

Card Hunter에서도 캐릭터의 Deck은 전투에 가져간 Item이 제공하는 카드들로 구성된다.

우리 게임은 이 개념을:

> **Equipment Trait → Card**

로 한 단계 추상화한다.

---

# 32. Combat 중 Equipment 상태 변화

Deck Blueprint는 Encounter 시작 시 확정한다.

하지만 Card 실행 가능 여부는 항상 Source Object를 다시 검사한다.

예:

```text
Trip Card
Source = Halberd

Halberd 사용 가능
→ Playable

Halberd 사용 불가능
→ Disabled
```

따라서 Card 자체와 Item 상태가 서로 어긋나지 않는다.

UI:

```text
TRIP
[DISABLED]

Requires:
Halberd available
```

---

# 33. Card 자체도 Trait을 가진다

예:

```text
TRIP

Traits:
Attack
Skill
Athletics
Trip
```

또는:

```text
FLY

Traits:
Move
Fly
```

따라서 MAP, Reaction, Condition 등은 카드 이름을 검사하지 않는다.

나쁜 구현:

```ts
if (card.name === "Trip") {
  applyMAP();
}
```

좋은 구현:

```ts
if (card.hasTrait("attack")) {
  applyMAP();
}
```

---

# 34. Rule Query Architecture

Trait System을 제대로 활용하려면 Rule Engine은 **Query 기반**이어야 한다.

핵심 Queries:

```text
CanUseAction
CanTarget
CanEnterTile
GetMovementCost
GetMovementModes
BlocksLineOfSight
BlocksLineOfEffect

GetStatistic
GetModifiers

GetDamage
GetResistance
GetWeakness

GetAvailableBasicActions
GetAvailableContextActions

GetDeckContributions

GetTriggerCandidates
GetReactionCandidates
```

---

# 35. Rule Query 예시

플레이어가 Stride를 선택한다.

```text
Stride
  ↓
MovementQuery
  ↓
Actor Traits
  ↓
Condition Traits
  ↓
Equipment Traits
  ↓
Terrain Traits
  ↓
Effect Traits
  ↓
Valid Tiles
```

PixiJS는 계산하지 않는다.

그 결과만 그린다.

---

# 36. Trait Resolution과 Specific Beats General

여러 Trait이 충돌할 수 있기 때문에 Resolution Layer가 필요하다.

예:

```text
Terrain:
Impassable for Land

Actor:
Fly Movement
```

단순히:

```text
Impassable = false
```

라고 하면 안 된다.

Query 자체가:

```text
CanEnterTile(
  actor,
  tile,
  movementMode = Fly
)
```

를 계산해야 한다.

즉 Rule은 항상 **Context**를 가진다.

---

# 37. Context Object

```ts
interface RuleContext {
  actor?: ActorId;

  target?: ObjectId;

  source?: ObjectId;

  action?: ActionId;

  card?: CardInstanceId;

  tile?: TileId;

  movementMode?: MovementMode;

  traits: TraitSet;
}
```

같은 Terrain이라도:

```text
Land Stride
```

와

```text
Fly
```

의 결과가 달라질 수 있다.

---

# 38. Card Hunter식 Board Preview 도입

Card Hunter의 좋은 UX 중 하나는 Move Card에 Hover하면 이동 가능한 타일이 파란색으로 표시되고, Attack Card는 공격 가능한 범위를 보드에 즉시 보여준다는 것이다.

실제 공식 Movement Diagram에서도 이동 가능한 공간, 진입 불가 공간, 최종 Facing 등이 보드 위에 직접 표시된다.

우리 게임에서도 이를 적극적으로 가져온다.

---

# 39. Action Hover → Preview Query

예:

```text
Mouse Hover
STRIDE
```

↓

```text
PreviewIntent
```

↓

```text
Rule Engine
```

↓

```text
Reachable Tiles
Path Cost
Terrain Interaction
Potential Reactions
```

↓

```text
PixiJS Highlight
```

---

# 40. Strike Preview

```text
STRIKE
↓
Goblin Hover
```

보드:

```text
Valid Target      Highlight
Invalid Target    Dim
Reach             Overlay
Cover             Indicator
```

DOM:

```text
STRIKE

Hit        75%
Critical   20%
Damage     8–15
```

---

# 41. Trait 영향도 같이 Preview한다

예:

```text
STRIDE → Rubble
```

Tile tooltip:

```text
RUBBLE

Traits
Open
Difficult

────────────────

Stride
Cost: 10 ft

Step
Unavailable

Reason:
Difficult
```

이 방식이면 플레이어가 PF2e Terrain Rule을 암기할 필요가 없다.

---

# 42. Card 정보 구조

Card Hunter의 Card Diagram은 Card Type, Damage, Range, Rule Text, Trigger 등의 정보를 한 장에 압축해서 보여준다.

우리 쪽은 PF2e의 긴 Rule Text를 전면에 노출하지 않고 다음 정보 순서를 사용한다.

### Primary

```text
TRIP

●

Success 72%

Prone
```

### Secondary

```text
Attack
Athletics
Trip

Source: Halberd
```

### Detail

```text
Athletics +12
vs Reflex DC 20

Critical Success   20%
Success            52%
Failure            23%
Critical Failure    5%

MAP -5
Item Bonus +1
...
```

---

# 43. UI 정보 철학

> **결과 → 원인 → 원문 규칙**

순으로 보여준다.

Level 1:

```text
72%
Prone
```

Level 2:

```text
Athletics vs Reflex
Attack Trait
MAP applies
```

Level 3:

```text
전체 Modifier Breakdown
Traits
Rule Elements
Source Object
```

---

# 44. Battle Screen

Card Hunter의 화면은 중앙 보드, 캐릭터별 Hand, 적 Hand, Combat Log 등을 한 화면에 배치한다.

우리 화면은 이를 PixiJS + DOM 구조로 재해석한다.

```text
┌────────────────────────────────────────────┐
│ Objective      Round       Initiative      │
├────────────────────────────────────────────┤
│                                            │
│                                            │
│              PIXIJS BOARD                  │
│                                            │
│                                            │
├────────────────────────────────────────────┤
│ Fighter   HP 38/42              ● ● ●      │
│                                            │
│ BASIC                                      │
│ [STEP] [STRIDE] [STRIKE]                   │
│                                            │
│ CONTEXT                                    │
│ [ESCAPE] [RAISE SHIELD]                    │
│                                            │
│ HAND                                       │
│ [TRIP] [POWER ATTACK] [HEAL] [FLY]         │
└────────────────────────────────────────────┘
```

---

# 45. PixiJS와 DOM 역할

## PixiJS

```text
Grid
Terrain
Actors
Objects
Hazards

Movement Range
Attack Range
AoE
Path Preview

Trait-related Board Feedback

Animation
VFX
```

## DOM

```text
Basic Actions
Conditional Actions

Cards
Hand
Deck
Discard

Character HUD

Trait Tooltip
Rule Breakdown

Inventory
Equipment
Adventure
Loot

Combat Log
```

---

# 46. Rule Engine은 Renderer를 모른다

```text
DOM / Pixi
    ↓
Command
    ↓
GameCore
    ↓
PF2e Rules
    ↓
Trait Queries
    ↓
Events
    ↓
DOM / Pixi
```

절대:

```ts
sprite.hp -= 5;
```

같은 형태로 처리하지 않는다.

---

# 47. Action Command

```ts
type GameCommand =
  | {
      type: "USE_BASIC_ACTION";
      actorId: ActorId;
      actionId: ActionId;
      payload: unknown;
    }

  | {
      type: "PLAY_CARD";
      actorId: ActorId;
      cardId: CardInstanceId;
      payload: unknown;
    };
```

Escape UI에서 Stand를 선택했다면:

```ts
{
  type: "USE_BASIC_ACTION",
  actorId: fighterId,
  actionId: "stand"
}
```

가 된다.

---

# 48. Outcome Preview도 같은 Engine을 사용한다

실제 공격:

```text
Command
 ↓
RuleEngine.resolve()
```

Preview:

```text
Intent
 ↓
RuleEngine.preview()
```

두 계산은 같은 Rule Element와 Trait Resolver를 사용해야 한다.

따로 작성하면 안 된다.

---

# 49. Adventure에서 Trait이 가지는 의미

Adventure Preview에서 플레이어가 단순 Level만 보는 것이 아니다.

예:

```text
Adventure:
The Sunken Temple

Known Threats
────────────────
Undead
Aquatic
Poison

Terrain
────────────────
Difficult
Water
Impassable areas
```

이를 보고:

```text
Equipment 변경
```

한다.

예:

```text
Boots of Fly 장착
→ Reflex +1
→ Fly Card Deck 추가
```

그러면 이번 Adventure의 Terrain에 대응할 수 있다.

즉 Card Hunter의:

> 적 Deck을 보고 장비를 바꾼다.

를 우리 쪽에서는:

> **Enemy / Terrain Trait을 보고 장비와 Deck을 바꾼다.**

로 발전시킨다.

---

# 50. Loot의 의미

Loot는 최소 세 종류다.

```text
Active Feat
Focus Spell
Item / Equipment
```

이 중 Equipment는 특별하다.

왜냐하면 하나의 Loot가:

```text
Statistics
+
Traits
+
Granted Cards
```

를 동시에 변경하기 때문이다.

따라서 장비 선택은 단순:

```text
Sword A: Damage 10
Sword B: Damage 12
```

비교가 아니다.

예:

```text
Weapon A

Damage 1d12
Trip

Adds:
[Trip]
```

vs

```text
Weapon B

Damage 1d10
Agile
Fire

Adds:
[Fire Activation]
```

처럼 **전투 방식 자체를 선택**하는 것이 된다.

---

# 51. 모든 Object를 같은 Trait System에서 처리하는 이유

예:

```text
Fireball
Traits: Fire
```

↓

Target:

```text
Creature
Traits:
Fire
Resistance
```

↓

Damage Query

---

또는:

```text
Fly Card
Traits:
Move
Fly
```

↓

Terrain:

```text
Traits:
Open
Difficult
```

↓

Movement Query

---

또는:

```text
Raise Shield
```

↓

Equipment:

```text
Traits:
Shield
```

↓

Action Availability Query

이 모든 것을 같은 Predicate / Trait System으로 처리할 수 있다.

---

# 52. Predicate System

```ts
interface Predicate {
  all?: PredicateEntry[];
  any?: PredicateEntry[];
  not?: PredicateEntry[];
}
```

예:

```text
Trip Card

Requirement

actor wielding source
AND
source has Trip
AND
valid target in Reach
```

또는:

```text
Raise Shield

Requirement

equipped item has Shield
AND
item usable
```

---

# 53. Trigger System

Traits는 Trigger에도 사용된다.

예:

```text
Reactive Strike

Trigger:
Enemy performs action with
Move OR Manipulate Trait
within Reach
```

따라서 Reaction System은:

```text
Event
 ↓
Event Traits
 ↓
Reaction Predicate
 ↓
Available Reactions
```

구조가 된다.

---

# 54. Multiplayer

1~3인 모두 동일한 GameCore를 사용한다.

```text
1 Player
→ 3 Characters

2 Players
→ Character Control Assignment

3 Players
→ 1 Character each
```

멀티에서는 Node.js Server가 Authoritative State를 가진다.

```text
Client
 ↓
Intent / Command
 ↓
Server
 ↓
Trait Query
 ↓
PF2e Rule Resolution
 ↓
Event
 ↓
Broadcast
```

Trait 판정 역시 Server가 최종 결정한다.

---

# 55. 패키지 구조

권장:

```text
/apps
  /client
  /server

/packages
  /game-core
  /pf2e-rules
  /traits
  /content
  /protocol
  /shared
```

---

# 56. `/traits`

```text
Trait Registry
Trait Resolver
Predicate Engine

Terrain Traits
Action Traits
Item Traits
Creature Traits

Card Grant Rules
Action Grant Rules
```

게임 전체의 핵심 패키지다.

---

# 57. `/pf2e-rules`

```text
Action Economy

Checks
Degree of Success
MAP

Damage
Healing

AC
Saving Throws
Skills

Conditions
Movement

Reaction
Duration

Statistic Modifiers
```

---

# 58. `/game-core`

```text
GameState
Turn
Round

Command
Event

Grid
Object Registry

Deck
Hand
Discard

Encounter
Objective

RNG
```

---

# 59. `/content`

실제 게임 데이터.

```text
Actors
Classes
Monsters

Active Feats
Focus Spells

Weapons
Armor
Items

Cards

Terrain

Maps
Encounters
Adventures
```

---

# 60. Equipment 데이터 예시

```ts
const halberd: EquipmentDefinition = {
  id: "halberd",

  kind: "weapon",

  damage: {
    dice: 1,
    die: 12
  },

  traits: [
    { id: "trip" }
  ]
};
```

Trip Trait이:

```ts
const trip: TraitDefinition = {
  id: "trip",

  cardGrants: [
    {
      cardId: "trip",

      requirement: {
        all: [
          "source:equipped",
          "source:wielded"
        ]
      }
    }
  ]
};
```

을 가지고 있기 때문에 Deck에 Trip Card가 자동 생성된다.

---

# 61. Boots 데이터 예시

```ts
const bootsOfFly: EquipmentDefinition = {
  id: "boots-of-fly",

  kind: "worn-item",

  modifiers: [
    {
      selector: "saving-throw:reflex",
      type: "item",
      value: 1
    }
  ],

  traits: [
    { id: "fly" }
  ]
};
```

Fly Trait:

```ts
const flyTrait: TraitDefinition = {
  id: "fly",

  cardGrants: [
    {
      cardId: "fly"
    }
  ]
};
```

---

# 62. Deck 카드의 Provenance

모든 자동 생성 Card에는 어디에서 왔는지가 기록된다.

```text
FLY

Source
Boots of Fly

Granted by
Fly Trait
```

이 정보는 Debugging에서도 매우 중요하다.

```text
Why does this Character have Fly?
```

↓

```text
Boots of Fly
→ Fly Trait
→ Fly Card Grant Rule
```

을 추적할 수 있기 때문이다.

---

# 63. Combat Log도 Trait 기반 원인을 기록한다

일반 UI:

```text
Goblin takes 12 damage.
```

상세:

```text
Strike
Attack +11
Target AC 18
Roll 16
Success

Damage 12

Fire Trait
Target Fire Resistance 5
Final Damage 7
```

Debug Mode:

```text
RuleTrace
```

까지 볼 수 있게 한다.

---

# 64. Vertical Slice 변경안

기존 Vertical Slice를 다음 기준으로 수정한다.

## Core

```text
3 Action Economy
Initiative

Step
Stride
Strike
```

## Conditional Basic

```text
Escape
Interact
Raise Shield
Sustain Spell
```

## Trait Engine

최소:

```text
Attack
Move
Manipulate

Open
Difficult
Impassable
Blocked

Trip
Shield
Fly

Prone
Grabbed
```

## Equipment

최소:

```text
Halberd
Shield
Boots of Fly
```

## Cards

```text
Trip
Fly

Active Feat 3~5
Focus Spell 2~3
Item 2~3
Reaction 1~2
```

---

# 65. Vertical Slice 테스트 시나리오

하나의 Map에서 다음을 전부 검증한다.

```text
Normal Floor
→ Open

Rubble
→ Open + Difficult

Chasm
→ Impassable

Wall
→ Blocked
```

Fighter:

```text
Halberd
Shield
```

다른 캐릭터:

```text
Boots of Fly
```

---

# 66. 반드시 통과해야 하는 테스트

### Test A

```text
Halberd 장착
```

→ Damage 변경
→ Trip Card Deck 추가

---

### Test B

```text
Boots of Fly 장착
```

→ Reflex +1
→ Fly Card Deck 추가

---

### Test C

```text
Open + Difficult Tile
```

Stride 가능.

Movement Cost 증가.

Step 불가.

---

### Test D

```text
Impassable
```

Land Stride 불가.

LOS 가능.

---

### Test E

```text
Blocked
```

이동 불가.

LOS 불가.

---

### Test F

Prone 발생.

```text
ESCAPE
```

Context Action 표시.

선택:

```text
Stand
```

---

### Test G

Grabbed 발생.

같은:

```text
ESCAPE
```

버튼에서:

```text
Escape Grab
```

이 제공된다.

---

### Test H

Shield 장착.

```text
Raise Shield
```

Context Action 활성화.

---

### Test I

Sustain 대상 발생.

```text
Sustain Spell
```

Context Action 활성화.

---

# 67. 최종 화면 구조

```text
┌─────────────────────────────────────────────┐
│ Adventure Objective            Round 3      │
├─────────────────────────────────────────────┤
│                                             │
│                                             │
│               PIXIJS GRID                   │
│                                             │
│         Terrain / Actor / Effects           │
│                                             │
├─────────────────────────────────────────────┤
│ Fighter   HP 36/42                  ● ● ●   │
│                                             │
│ BASIC                                       │
│ [STEP] [STRIDE] [STRIKE]                    │
│                                             │
│ CONTEXT                                     │
│ [ESCAPE] [INTERACT] [RAISE SHIELD]          │
│                                             │
│ CARDS                                       │
│ [TRIP] [SUDDEN CHARGE] [ITEM] [SPELL]       │
└─────────────────────────────────────────────┘
```

카드와 Basic Action이 시각적으로도 완전히 분리된다.

---

# 68. 이 시스템의 핵심 관계

전체 구조를 한 그림으로 만들면:

```text
                    GAME OBJECT
                         │
                       Traits
                         │
          ┌──────────────┼───────────────┐
          │              │               │
       Rule Query    Card Grant     Action Grant
          │              │               │
          ▼              ▼               ▼
     Statistics        Deck        Context Actions
          │              │               │
          └──────────────┼───────────────┘
                         │
                      Combat
                         │
                         ▼
                  Outcome Preview
```

---

# 69. Character Build의 핵심 공식

기존 RPG처럼:

```text
Equipment
→ 숫자 상승
```

으로 끝나지 않는다.

우리 게임에서는:

```text
Equipment
    │
    ├─ Statistics
    │
    ├─ Traits
    │
    └─ Granted Cards
```

이다.

따라서:

> **Equipment Build = Statistic Build + Deck Build**

가 된다.

---

# 70. Card Hunter에서 가져오는 핵심

Card Hunter에서 그대로 참고할 것은 다음이다.

### Adventure → Encounter → Loot 구조

### 장비 변경이 전투 전략을 바꾸는 구조

### Item이 Deck 구성에 영향을 주는 구조

### 카드/행동 Hover 시 Board에 결과를 즉시 Preview하는 UX

### Terrain이 이동과 Targeting에 즉시 관여하는 구조

### 지속 Effect가 Character/Board에 Attachment 되는 구조

Card Hunter에서는 실제로 장비가 전투 Deck을 정의하며, Movement/Attack Card 선택 시 보드 위 가능한 영역을 즉시 표시한다.

---

# 71. Card Hunter와 의도적으로 다르게 하는 부분

Card Hunter:

```text
Default Movement Card
Attack Card
Move Card

= 행동 가능 여부
```

우리 게임:

```text
Step
Stride
Strike

= 항상 Basic Actions
```

---

Card Hunter:

```text
Terrain은 4종류 중 하나
```

우리 게임:

```text
Terrain
→ 복수 Trait 조합
```

---

Card Hunter:

```text
Item
→ Card Set
```

우리 게임:

```text
Item
→ Statistics
→ Traits
→ Trait Rule
→ Cards / Actions / Modifiers
```

---

# 72. 가장 중요한 개발 원칙

이제부터 새로운 시스템을 만들 때:

```text
"이 Item은 어떤 특수코드를 가져야 하지?"
```

라고 생각하지 않는다.

먼저:

```text
"이 Object는 어떤 Trait을 가지는가?"
```

를 결정한다.

그다음:

```text
"그 Trait은 어떤 Rule Query에 영향을 주는가?"
```

를 결정한다.

그리고 필요한 경우:

```text
"그 Trait은 어떤 Card나 Action을 제공하는가?"
```

를 정의한다.

---

# 73. 프로젝트의 최종 설계 문장

> **모든 것은 Object이고, 모든 Object는 Trait을 가지며, 모든 게임 규칙은 Trait과 Context를 질의해서 결과를 만든다.**

그리고 전투 시스템은:

> **Step·Stride·Strike는 항상 사용할 수 있는 고정 Basic Actions이며, Escape·Interact·Raise a Shield·Sustain a Spell은 조건에 따라 제공되는 고정 Context Basic Actions다.**

카드 시스템은:

> **Active Feat, Focus Spell, Item 및 Equipment Trait이 제공하는 특별한 전술적 선택지를 표현한다.**

Equipment 시스템은:

> **장비가 Character Statistics를 변경하고, 장비 Trait이 Tactical Deck의 구성을 변경한다.**

이 세 문장을 Core Architecture의 불변 원칙으로 사용한다.
