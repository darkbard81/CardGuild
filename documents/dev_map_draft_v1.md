# PF2e Tactical Adventure

## 개발 설계서 초안 v0.1

### 1. 프로젝트 정의

**PF2e Tactical Adventure**는 *Pathfinder 2e Remaster*의 전투 규칙을 내부 게임 엔진으로 사용하고, Card Hunter식 Adventure 진행과 격자 전투, 카드 획득·빌드 시스템을 결합한 **1~3인 협력 Tactical Adventure RPG**다.

게임의 목표는 PF2e 룰북을 그대로 화면에 재현하는 것이 아니다. 플레이어에게는 현재 선택의 **결과를 단순하게 보여주고**, 실제 PF2e 계산과 규칙 처리는 게임 엔진 내부에서 수행한다.

핵심 구조는 다음과 같다.

> **Adventure 선택 → Encounter 전투 → Loot 획득 → 캐릭터/카드 빌드 변경 → 다음 Encounter/Adventure**

전투에서는 PF2e의 3 Action Economy를 유지하며, 모든 캐릭터는 카드와 관계없이 핵심 Basic Action을 사용할 수 있다.

카드는 캐릭터가 행동할 수 있게 만드는 권한이 아니라 **캐릭터에게 추가적인 전술 옵션을 부여하는 자산**이다.

---

# 2. 핵심 디자인 철학

## 2.1 PF2e는 화면이 아니라 엔진이다

플레이어가 다음과 같은 계산을 직접 추적하도록 만들지 않는다.

```text
Attack Modifier
+ Proficiency
+ Attribute
+ Item Bonus
+ Status Bonus
+ Circumstance Bonus
- MAP
- Condition Penalty
vs AC
```

기본 UI는 이를 다음처럼 압축한다.

```text
STRIKE

Hit      75%
Crit     20%
Damage   8–15
```

플레이어가 상세 정보를 요청했을 때만 계산 근거를 표시한다.

```text
Attack Breakdown

Base Attack          +12
Status Bonus          +1
Frightened            -1
MAP                    -5
──────────────────────────
Final Attack           +7

Target AC              20

Critical Success       10%
Success                45%
Failure                40%
Critical Failure        5%
```

따라서 UX 원칙은 다음과 같다.

> **먼저 결과를 보여주고, 이유는 요청할 때 보여준다.**

PF2e의 기본 체크는 d20 결과와 수정치를 DC와 비교하고, Critical Success / Success / Failure / Critical Failure의 네 단계로 판정된다. Remaster의 Basic Actions 역시 Step, Stride, Strike, Interact 등을 모든 캐릭터가 널리 사용하는 행동으로 정의한다.

---

# 3. 게임의 5개 핵심 기둥

### 3.1 Adventure

전투 하나를 반복하는 게임이 아니라 여러 Encounter가 하나의 Adventure를 구성한다.

### 3.2 Tactical Grid

캐릭터의 위치, 이동, 사거리, Reach, 지형, Choke Point 등이 전투 결과에 영향을 준다.

### 3.3 PF2e Combat Engine

공격, AC, Saving Throw, Skill Check, Degree of Success, MAP, Condition, Resistance, Weakness 등은 PF2e 기반으로 처리한다.

### 3.4 Card Build

Active Feat, Focus Spell, Item 등 플레이 도중 획득하는 능력을 카드 형태로 관리한다.

### 3.5 Cooperative Party

싱글에서는 한 플레이어가 파티 전체를 조작하고, 멀티플레이에서는 최대 3명이 캐릭터를 나누어 담당한다.

---

# 4. Card Hunter에서 가져올 부분과 가져오지 않을 부분

Card Hunter에서 차용하는 핵심은 다음 세 가지다.

```text
Adventure 구조
+
격자 기반 전술 전투
+
Loot → Build 변화
```

그러나 실제 전투의 Action Economy는 PF2e를 따른다.

즉 다음과 같은 Card Hunter식 구조는 사용하지 않는다.

```text
Player 카드 1장
Enemy 카드 1장
Player 카드 1장
Enemy 카드 1장
...
```

대신 캐릭터는 Initiative 순서에 따라 자신의 턴을 받고 그 턴에 PF2e의 Action Economy를 사용한다.

```text
Fighter Turn

● Action 1
● Action 2
● Action 3

Reaction ◇
```

이 선택은 매우 중요하다.

PF2e의 Active Feat에는 1 Action, 2 Actions, 3 Actions를 사용하는 Activity가 존재하고, MAP 또한 **같은 턴 안에서 이루어진 Attack Trait 행동 횟수**를 기준으로 적용되기 때문이다. 기본 MAP는 두 번째 공격 -5, 세 번째 이후 -10이며 Agile은 -4/-8을 사용한다.

따라서:

> **Adventure와 카드 획득 구조는 Card Hunter에서, 전투의 시간 구조와 판정 시스템은 PF2e에서 가져온다.**

---

# 5. 전투의 기본 구조

## 5.1 Round

```text
Round Start
    ↓
Initiative Order
    ↓
Character A Turn
    ↓
Enemy A Turn
    ↓
Character B Turn
    ↓
Enemy B Turn
    ↓
...
    ↓
Round End
```

각 캐릭터의 턴은 기본적으로:

```text
3 Actions
+
Reaction 상태
+
현재 Hand
+
항상 사용 가능한 Basic Actions
```

로 구성한다.

---

# 6. Basic Actions

카드 Draw 상태와 관계없이 주요 Basic Action은 항상 사용할 수 있다.

초기 Vertical Slice에서는 다음 행동을 우선 구현한다.

```text
STEP
1 Action

STRIDE
1 Action

STRIKE
1 Action

INTERACT
1 Action
```

특히 Step, Stride, Strike는 전투 UI에 항상 노출한다.

예:

```text
┌─────────────────────────────┐
│ STEP │ STRIDE │ STRIKE      │
└─────────────────────────────┘
```

PF2e Remaster에서 Step과 Strike는 모두 1 Action Basic Action이며, Step은 5피트 이동하면서 일반적인 이동 유발 Reaction을 피하는 행동으로 정의된다.

향후 필요한 Basic/Specialty Actions는 전투 콘텐츠에 맞춰 단계적으로 추가한다.

---

# 7. 카드의 역할

## 7.1 핵심 원칙

**Basic Action = 항상 존재**

**Card = 특수 전술 선택**

따라서 플레이어가 좋지 않은 Hand를 뽑아도 게임 자체를 진행할 수 있다.

예:

```text
Basic Actions

Step
Stride
Strike
Interact
```

현재 Hand:

```text
Sudden Charge
Vicious Swing
Reactive Strike
Lay on Hands
Healing Potion
```

플레이어는 필요하다면 카드를 전혀 쓰지 않고도:

```text
Stride
→ Strike
→ Step
```

을 실행할 수 있다.

반대로 상황이 맞으면:

```text
Sudden Charge
→ Vicious Swing
```

같은 강력한 조합을 사용할 수 있다.

---

# 8. 카드 분류

초기 카드 시스템은 크게 네 계열로 시작한다.

## Active Feat Card

캐릭터의 능동적인 Class / Archetype / Skill Feat 등을 표현한다.

예:

```text
SUDDEN CHARGE

Fighter · Flourish

Cost: ●●

Stride
Stride
Strike
```

카드는 PF2e 효과를 새로 정의하지 않고 가능한 한 기존 Rule Action을 조합한다.

```text
Sudden Charge
    ↓
Stride
    ↓
Stride
    ↓
Strike
```

이렇게 구성하면 Rule Engine의 재사용성이 높아진다.

---

## Focus Spell Card

Focus Spell 역시 전술 카드로 표현한다.

```text
LAY ON HANDS

Focus Spell
Cost: ●

Heal Ally
+ AC Effect
```

캐릭터 상태에는 Focus Pool이 존재하고, 카드 사용 가능 여부는 현재 캐릭터의 상태와 Spell 요구 조건을 Rule Engine이 판정한다.

---

## Equipment / Item Card

Weapon, Armor, Shield, Worn Item 등의 장착 상태가 전투 능력에 영향을 준다.

일부 장비는 그 자체로 새로운 Tactical Card를 제공할 수 있다.

예:

```text
FLAMING SWORD
        ↓
Weapon Statistics
+
Special Activation Card
```

장비 하나가 다음 세 요소를 동시에 가질 수 있다.

```text
Passive Statistics
Traits
Granted Card
```

---

## Consumable Card

Potion, Elixir, Bomb, Talisman 등 실제 소비되는 자산.

```text
HEALING POTION

Interact ●

Heal 2d8+5

Consumable
```

Consumable Card는 사용 시 Adventure Inventory에서 소비된다.

---

# 9. 카드 Deck / Hand 구조

카드는 획득한 모든 카드를 항상 화면에 표시하는 방식이 아니다.

다음 3단계로 관리한다.

```text
COLLECTION
    ↓
LOADOUT
    ↓
TACTICAL DECK
    ↓
HAND
```

### Collection

캠페인을 통해 획득한 전체 카드.

### Loadout

현재 캐릭터가 Adventure에 가져가는 카드 구성.

### Tactical Deck

현재 Encounter에서 사용되는 실제 카드 집합.

### Hand

현재 전투에서 즉시 사용할 수 있는 카드.

이 구조는 카드 수가 늘어나도 전투 UI의 복잡도가 폭발하지 않게 한다.

---

# 10. 카드 순환 모델

초기 권장 모델은 다음과 같다.

### Encounter 시작

각 캐릭터가 Initial Hand를 Draw한다.

### Turn 시작

정해진 수만큼 카드를 보충한다.

### Card 사용

카드 종류에 따라 다음 상태 중 하나로 이동한다.

```text
Discard
Exhaust
Consumed
Cooldown
```

기본적으로 Active Feat Card는 사용 후 Discard되고 Deck이 순환하면 다시 사용할 수 있다.

Consumable은 실제 자산을 소비한다.

특수 Ability는 Encounter당 횟수 등의 별도 Frequency Rule을 가질 수 있다.

**중요:** Deck RNG는 캐릭터의 기본 행동 가능성을 제한하지 않는다.

따라서 Hand RNG는:

> “이번 턴에 무엇을 할 수 있는가?”

가 아니라

> **“이번 턴에 어떤 특별한 기회가 생겼는가?”**

를 결정한다.

---

# 11. 캐릭터 구성

캐릭터 데이터는 카드와 분리한다.

```text
Character
├─ Level
├─ Class
├─ Attributes
├─ Proficiency
├─ HP
├─ AC
├─ Saves
├─ Skills
├─ Speed
├─ Perception
├─ Weapons
├─ Armor
├─ Conditions
├─ Resources
├─ Focus Pool
└─ Tactical Loadout
```

Passive Feat, Proficiency, Class Feature 등 전투 중 계속 유지되는 요소는 Character Rule State에 존재한다.

**플레이어가 직접 선택해서 사용하는 능동적 선택지를 카드로 표현한다.**

---

# 12. PF2e Rule Engine

Rule Engine은 UI 및 PixiJS에서 완전히 분리한다.

```text
UI
 ↓ Command
Game Engine
 ↓
Rule Validation
 ↓
Check Resolution
 ↓
Effects
 ↓
Game State
 ↓
Presentation
```

PixiJS Sprite가 공격을 처리하거나 DOM Card가 HP를 변경하면 안 된다.

모든 게임 결과는 Rule Engine을 통과한다.

---

# 13. Check Engine

모든 Check는 가능한 한 공통 구조를 사용한다.

```text
Actor
Target
Statistic
DC
Modifiers
Traits
Context
```

↓

```text
d20
+
Modifier
```

↓

```text
DC 비교
```

↓

```text
Critical Success
Success
Failure
Critical Failure
```

PF2e Remaster의 Degree of Success는 DC보다 10 이상 높으면 Critical Success, DC 이상이면 Success, DC보다 낮으면 Failure, 10 이상 낮으면 Critical Failure라는 공통 구조를 사용한다.

이 구조를 중앙화해야 Attack, Skill, Saving Throw, Spell 효과를 같은 Engine에서 처리할 수 있다.

---

# 14. Modifier Engine

Modifier는 최소 다음 구조를 가진다.

```ts
type ModifierType =
  | "item"
  | "status"
  | "circumstance"
  | "untyped";
```

Engine에서 자동으로 stacking rule을 처리한다.

```text
Heroism
Status +1

Other Status Bonus
Status +2

→ Final Status Bonus +2
```

UI에서는 최종 Modifier만 사용한다.

상세 보기에서만 stacking 과정을 노출한다.

---

# 15. Multiple Attack Penalty

캐릭터 Turn State가 현재 공격 횟수를 관리한다.

```ts
turn.attackCount
```

Attack Trait Action이 실행될 때 증가한다.

```text
Attack #1    0
Attack #2   -5
Attack #3  -10
```

Agile Weapon:

```text
Attack #1    0
Attack #2   -4
Attack #3   -8
```

PF2e에서는 Strike뿐 아니라 Attack Trait를 가진 일부 Skill Action과 Spell Attack 등도 MAP 진행에 포함되므로, 구현 시 **Strike 횟수**가 아니라 **Attack Trait Action 횟수**를 추적해야 한다.

---

# 16. Outcome Preview Engine

이 프로젝트의 중요한 UX 시스템이다.

플레이어가 행동을 확정하기 전에 Rule Engine을 Dry Run한다.

예:

```text
Strike → Goblin
```

↓

```text
Hit      70%
Crit     20%
Damage   8–15
```

d20 기반 Check는 가능한 결과가 20개이므로 Monte Carlo Simulation을 할 필요가 없다.

현재 알려진 상태를 기준으로:

```text
Roll 1
Roll 2
Roll 3
...
Roll 20
```

을 모두 평가하여 정확한 Degree 분포를 계산할 수 있다.

따라서 Preview API는 예를 들어:

```ts
interface OutcomePreview {
  criticalSuccess: number;
  success: number;
  failure: number;
  criticalFailure: number;

  damageMin?: number;
  damageMax?: number;
  expectedDamage?: number;
}
```

형태로 제공한다.

이 시스템은 실제 Resolution Engine과 같은 규칙 코드를 사용해야 한다.

**Preview 전용 계산식을 따로 구현하지 않는다.**

그래야:

```text
화면 예상 결과
≠
실제 결과
```

문제를 방지할 수 있다.

---

# 17. Grid Battle

전장은 Square Grid를 기본으로 한다.

Grid System은 다음을 담당한다.

```text
Tile Position
Occupancy
Movement Cost
Difficult Terrain
Reach
Range
Line of Sight
Cover
Area Effect
Hazard
Objective Tile
```

Movement Path는 A* 기반 Pathfinding을 사용하되 최종 이동 가능 여부와 비용은 Rule Engine이 결정한다.

---

# 18. PixiJS 역할

PixiJS는 **Battlefield Renderer** 역할에 집중한다.

권장 Layer:

```text
BattleScene
├─ GroundLayer
├─ TerrainLayer
├─ GridLayer
├─ ObjectLayer
├─ UnitLayer
├─ EffectLayer
├─ SelectionLayer
├─ PathPreviewLayer
└─ DebugLayer
```

PixiJS가 담당하는 것:

* Battlefield
* Tile highlight
* Character sprite
* Enemy sprite
* Movement animation
* Attack animation
* Projectile
* AoE preview
* Target marker
* Path preview
* Damage number
* Battlefield VFX

---

# 19. DOM 역할

DOM은 정보량이 많고 조작성이 중요한 UI를 담당한다.

```text
Character HUD
Action Bar
Hand
Card Tooltip
Inventory
Character Sheet
Adventure Map
Loot Screen
Loadout Editor
Settings
Combat Log
Detailed Calculation Popup
Multiplayer Lobby
```

특히 Card Hand를 PixiJS Canvas 안에 넣지 않는다.

카드는 텍스트, Tooltip, Hover, Scroll, Drag, Responsive Layout 등 DOM이 더 적합하다.

따라서 전체 구조는:

```text
┌──────────────────────────────────────┐
│ DOM HUD                              │
├──────────────────────────────────────┤
│                                      │
│              PixiJS                  │
│           Battle Board               │
│                                      │
├──────────────────────────────────────┤
│ DOM Basic Actions + Tactical Hand    │
└──────────────────────────────────────┘
```

를 기본으로 한다.

---

# 20. Adventure 구조

Adventure는 여러 Encounter를 하나의 패키지로 묶는다.

예:

```text
Goblin Trouble
Level 1

Encounter 1
Road Ambush

        ↓

Encounter 2
Goblin Camp

        ↓

Encounter 3
Goblin Chief

        ↓

Adventure Complete
```

각 Encounter는 다음 데이터를 가진다.

```ts
interface EncounterDefinition {
  id: string;
  mapId: string;
  enemies: EncounterEnemy[];
  objectives: Objective[];
  rewards: RewardTable;
  events?: EncounterEvent[];
}
```

---

# 21. Victory Condition

모든 전투를 단순 Enemy Elimination으로 만들지 않는다.

지원할 Objective 후보:

```text
Eliminate Enemies
Defeat Boss
Survive N Rounds
Reach Target Tile
Escape
Protect NPC
Hold Position
Activate Object
Interrupt Ritual
Retrieve Item
Escort
```

이 시스템이 있어야 Adventure가 단순 전투 반복이 아니라 **보드 전략 게임**이 된다.

---

# 22. Adventure 진행 루프

전체 루프:

```text
TOWN / HUB
    ↓
Character Build
    ↓
Loadout
    ↓
Adventure 선택
    ↓
Encounter
    ↓
Loot
    ↓
Encounter
    ↓
Loot
    ↓
Boss
    ↓
Adventure Reward
    ↓
HUB
```

중간 Encounter 보상은 다음 전투의 빌드에 영향을 줄 수 있다.

단, Adventure 중 완전한 Character Respec을 허용할 필요는 없다.

Hub와 Adventure 내부의 Build 변경 범위를 차등화한다.

---

# 23. Loot System

Loot의 핵심 목적은 단순 수치 상승이 아니다.

> **새로운 전술 선택지를 획득하는 것**

예:

```text
Adventure Reward

Choose One

[ Vicious Swing ]
[ Reactive Strike ]
[ Striking Rune ]
```

획득 결과:

```text
Collection
   +
New Card
```

이후 Hub에서 Loadout에 편성할 수 있다.

---

# 24. Rarity

Rarity는 반드시 Power Tier를 의미하지 않는다.

PF2e의 Rarity 개념을 유지한다면:

```text
Common
Uncommon
Rare
Unique
```

은 **획득 가능성과 세계 내 접근성**을 표현하는 메타데이터로 취급한다.

실제 Power는 Level과 Rule Definition을 기준으로 한다.

---

# 25. 1~3인 Cooperative 구조

기본 Party Size는 최대 3 Character로 설계한다.

### 1 Player

```text
Player
├─ Character A
├─ Character B
└─ Character C
```

플레이어 한 명이 파티 전체를 조작한다.

### 2 Players

예:

```text
Player A
├─ Character A
└─ Character B

Player B
└─ Character C
```

캐릭터 소유권은 Lobby에서 자유롭게 지정할 수 있다.

### 3 Players

```text
Player A → Character A
Player B → Character B
Player C → Character C
```

가장 자연스러운 Cooperative 형태다.

---

# 26. Multiplayer 기본 정책

개인용 프로젝트이므로 Account Server나 복잡한 Matchmaking을 초기 목표로 하지 않는다.

권장 방식:

> **Host-owned Campaign + Node.js Authoritative Session Server**

Host가 Campaign Save를 가진다.

Guest는 Session에 참가하고 캐릭터 Control 권한을 받는다.

```text
Host
├─ Campaign Save
├─ Node Game Server
└─ Character A

Guest B
└─ Character B

Guest C
└─ Character C
```

---

# 27. Authoritative Server

멀티플레이에서 실제 Game State와 RNG는 Node.js Server가 소유한다.

Client:

```text
"Character A가 Goblin에게 Strike"
```

라는 Command만 보낸다.

Server:

```text
Action 가능?
Target 유효?
Range 유효?
Action 남음?
MAP?
Condition?
Modifier?
Roll
Damage
Trigger
Reaction
```

를 계산한다.

그 후 결과 Event를 모든 Client에게 보낸다.

```text
COMMAND
    ↓
SERVER VALIDATION
    ↓
RULE RESOLUTION
    ↓
GAME EVENT
    ↓
STATE UPDATE
    ↓
BROADCAST
```

Client가 Damage나 Dice Result를 직접 결정하지 않는다.

---

# 28. Solo와 Multiplayer의 Engine 통합

싱글플레이용 Game Engine과 Multiplayer Game Engine을 별도로 만들지 않는다.

둘 다 같은 Command API를 사용한다.

```text
Solo

Client
 ↓
LocalSessionAdapter
 ↓
GameCore
```

```text
Multiplayer

Client
 ↓ WebSocket
Node Server
 ↓
GameCore
```

이렇게 하면 전투 규칙은 한 곳만 유지하면 된다.

---

# 29. Deterministic RNG

Server는 Seeded RNG를 사용한다.

```text
Campaign Seed
Encounter Seed
Roll Sequence
```

를 기록한다.

이를 통해:

* 전투 재현
* 버그 재현
* 테스트
* Replay
* Multiplayer Sync 검증

이 가능해진다.

Combat Log에는 실제 RNG 결과도 Event로 남긴다.

---

# 30. Game State 구조

권장 구조는 Serializable Plain State다.

```ts
interface GameState {
  phase: GamePhase;

  round: number;

  initiative: EntityId[];

  activeEntity: EntityId;

  actors: Record<EntityId, ActorState>;

  grid: GridState;

  cards: Record<CardInstanceId, CardState>;

  effects: EffectState[];

  objectives: ObjectiveState[];

  rng: RNGState;
}
```

PixiJS Object, HTMLElement, Function Reference 등은 GameState에 넣지 않는다.

GameState는 JSON Serialization 가능해야 한다.

---

# 31. Command / Event 구조

Command는 플레이어의 **의도**를 표현한다.

예:

```text
MOVE
USE_BASIC_ACTION
PLAY_CARD
SELECT_TARGET
END_TURN
PASS_REACTION
```

Event는 이미 확정된 **사실**을 표현한다.

```text
TURN_STARTED
ACTION_SPENT
ENTITY_MOVED
CHECK_ROLLED
DEGREE_RESOLVED
DAMAGE_DEALT
CONDITION_ADDED
CARD_PLAYED
CARD_DISCARDED
ENTITY_DEFEATED
TURN_ENDED
```

UI Animation은 Event를 구독한다.

예:

```text
ENTITY_MOVED
        ↓
Pixi movement animation
```

```text
DAMAGE_DEALT
        ↓
Damage number
HP animation
Sound
```

---

# 32. Effect System

카드마다 TypeScript 코드를 직접 작성하는 구조는 피한다.

가능한 효과는 선언적으로 작성한다.

예:

```ts
{
  type: "sequence",
  effects: [
    { type: "stride", count: 2 },
    { type: "strike" }
  ]
}
```

또는:

```ts
{
  type: "applyCondition",
  condition: "frightened",
  value: 1
}
```

주요 Effect Primitive:

```text
RollCheck
Strike
Stride
Step
DealDamage
Heal
ApplyCondition
RemoveCondition
Push
Pull
Teleport
SpendAction
SpendResource
DrawCard
DiscardCard
AddModifier
CreateArea
Summon
```

복잡한 Class Feature만 Custom Rule Handler를 사용한다.

목표는:

> **Content 대부분을 Engine 코드 수정 없이 추가할 수 있는 구조**

다.

---

# 33. Predicate System

PF2e 효과 상당수는 조건부다.

예:

```text
Target is Off-Guard
Weapon has Agile
Actor is Flanking
Target has Frightened
Attack is Melee
```

따라서 Rule Effect는 Predicate를 가진다.

```ts
predicate: {
  all: [
    "target:off-guard",
    "attack:melee"
  ]
}
```

Predicate 시스템이 제대로 만들어지면 향후 카드와 아이템 추가 난이도가 크게 내려간다.

---

# 34. Reaction System

Reaction은 별도의 Trigger Queue를 사용한다.

예:

```text
Enemy Movement
      ↓
Trigger 발생
      ↓
Reactive Strike 가능 캐릭터 검색
      ↓
Reaction Window
      ↓
Player 선택
      ↓
Resolve Reaction
      ↓
Original Action 계속
```

온라인 Cooperative에서는 여러 Reaction이 동시에 가능할 수 있으므로 Server가 Trigger Order를 관리한다.

---

# 35. Enemy AI

Enemy AI는 PF2e 행동을 직접 이해하는 거대한 AI보다 **Utility 기반 후보 평가** 방식으로 시작한다.

예:

```text
Candidate
Move + Strike

Score 72
```

```text
Candidate
Strike + Strike

Score 58
```

```text
Candidate
Trip + Strike

Score 81
```

평가 요소:

```text
Expected Damage
Kill Probability
Position Value
Objective Value
Condition Value
Risk
Action Cost
```

Outcome Preview Engine을 AI도 재사용할 수 있다.

즉 플레이어에게:

```text
Hit 75%
```

를 계산하는 시스템이 AI에게도:

```text
Expected Utility
```

계산 자료를 제공한다.

---

# 36. UI 정보 계층

정보는 세 단계로 나눈다.

## Level 1 — 즉시 판단

```text
Strike
75%
8–15
```

## Level 2 — 전술 정보

Hover / Long Press:

```text
Hit       75%
Crit      20%
Expected  11.2

Target:
Off-Guard
Frightened 1
```

## Level 3 — Rule Detail

```text
Attack Breakdown

Proficiency
Attribute
Item Bonus
Status
Circumstance
MAP
Target AC
d20 distribution
```

기본 플레이에서는 Level 1과 2만으로 게임을 진행할 수 있어야 한다.

---

# 37. Combat Screen 권장 구성

```text
┌──────────────────────────────────────────────┐
│ Party / Round / Objective                    │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│                PIXI BATTLEFIELD              │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│ Fighter HP 42/42       ● ● ●       Reaction │
│                                              │
│ STEP    STRIDE    STRIKE                     │
│                                              │
│ [Feat] [Feat] [Spell] [Item] [Reaction]      │
└──────────────────────────────────────────────┘
```

Basic Actions와 Card Hand는 시각적으로 명확하게 분리한다.

---

# 38. 기술 Stack

```text
Node.js
TypeScript
PixiJS
DOM
WebSocket
```

권장 프로젝트 구성:

```text
/apps
  /client
  /server

/packages
  /game-core
  /rules
  /content
  /protocol
  /shared
```

### client

PixiJS + DOM UI.

### server

Node.js authoritative session.

### game-core

Battle State, Command, Event, Turn, Grid, RNG.

### rules

Check, Modifier, Degree, Condition, Action, Reaction.

### content

Character, Feat, Spell, Item, Monster, Adventure 데이터.

### protocol

Client ↔ Server 메시지 정의.

---

# 39. Renderer와 Simulation 분리

가장 중요한 기술 원칙 중 하나다.

```text
GameCore
```

는 PixiJS 존재를 몰라야 한다.

```text
PixiRenderer
```

는 PF2e 계산 방법을 몰라야 한다.

```text
DOM UI
```

는 Damage를 직접 변경하지 않는다.

따라서:

```text
Input
 ↓
Command
 ↓
GameCore
 ↓
Event
 ↓
UI / Pixi
```

의 단방향 구조를 유지한다.

---

# 40. Save Data

초기에는 복잡한 DB보다 Versioned Save를 권장한다.

```ts
interface CampaignSave {
  version: number;

  campaignId: string;

  progress: CampaignProgress;

  characters: CharacterSave[];

  collection: CardCollection;

  inventory: InventoryState;

  settings: CampaignSettings;
}
```

Save Migration을 고려하여 반드시 `version`을 둔다.

---

# 41. 개발 우선순위

## Phase 1 — Combat Vertical Slice

목표:

> **PF2e 전투가 실제로 재미있는지 검증**

구현:

```text
1 Map
3 Player Characters
3 Enemy Types

Step
Stride
Strike

3 Actions
Initiative
MAP

Attack Roll
Damage
AC

Critical Success
Success
Failure
Critical Failure

Movement
Range
Death

Outcome Preview
Combat Log
```

카드:

```text
Active Feat 몇 장
Focus Spell 몇 장
Item 몇 장
Reaction 몇 장
```

---

## Phase 2 — Tactical Card Loop

구현:

```text
Deck
Draw
Hand
Discard
Exhaust
Loadout
Card Tooltip
Card Detail
Reaction Card
```

이 단계에서:

> **Basic Action만 사용하는 턴과 Card를 섞어 사용하는 턴이 모두 재미있는가?**

를 검증한다.

---

## Phase 3 — Adventure Loop

구현:

```text
Hub
Adventure Select
Encounter Sequence
Victory Condition
Loot
Collection
Loadout
Adventure Complete
Save
```

이 시점부터 하나의 게임 형태를 갖춘다.

---

## Phase 4 — Cooperative Multiplayer

구현:

```text
Lobby
Room
Character Assignment
Authoritative Node Server
WebSocket
Reconnect
State Snapshot
Command Validation
Reaction Synchronization
```

---

## Phase 5 — Content Expansion

그 이후에:

```text
Classes
Monsters
Conditions
Weapons
Items
Feats
Focus Spells
Maps
Adventures
Boss Mechanics
```

를 늘린다.

---

# 42. 첫 Vertical Slice 권장 범위

첫 번째 완성 목표는 과감하게 작게 잡는다.

### Party

```text
Fighter
Rogue
Cleric
```

### Enemies

```text
Goblin Warrior
Goblin Archer
Goblin Boss
```

### Adventure

```text
Goblin Trouble
```

Encounter:

```text
1. Road Ambush
2. Goblin Camp
3. Goblin Chief
```

### Card

캐릭터당 약 5~8장만 구현한다.

이 정도면 다음을 모두 시험할 수 있다.

```text
Movement
Melee
Ranged
Healing
Conditions
Active Feat
Focus Spell
Item
Reaction
Loot
Build
Boss
```

---

# 43. 첫 번째 성공 기준

Vertical Slice의 성공 여부는 콘텐츠 양으로 판단하지 않는다.

다음 질문에 모두 YES가 나오면 성공이다.

* 기본 행동만으로도 캐릭터를 정상적으로 운용할 수 있는가?
* 카드를 사용하면 실제로 선택지가 확장되는가?
* PF2e 계산을 몰라도 결과 Preview만 보고 의사결정을 할 수 있는가?
* 상세 결과를 열면 왜 그런 결과가 나왔는지 확인할 수 있는가?
* 위치와 이동이 공격력만큼 중요한가?
* Loot 하나가 다음 Encounter 플레이 방식을 바꾸는가?
* 세 캐릭터가 서로 다른 역할을 가지는가?
* Encounter 목표에 따라 같은 캐릭터도 다른 행동을 하게 되는가?

---

# 44. 명시적인 Non-Goals

초기 버전에서는 다음을 목표로 하지 않는다.

```text
PF2e 전체 Rule 구현
모든 Class 구현
모든 Spell 구현
모든 Item 구현
GM Simulation
PvP
MMO식 Account System
Matchmaking
거대한 Open World
```

**완전한 PF2e 구현보다 재미있는 Tactical Adventure를 먼저 완성한다.**

필요한 PF2e Rule을 Encounter와 Card 콘텐츠가 요구하는 순서대로 구현한다.

---

# 45. 최종 설계 원칙

프로젝트 전체에서 다음 원칙을 유지한다.

### 1. PF2e 규칙은 깊게 구현한다.

### 2. PF2e 규칙은 화면에 전부 보여주지 않는다.

### 3. 플레이어에게는 결과를 먼저 보여준다.

### 4. Basic Action은 카드 RNG와 분리한다.

### 5. Card는 캐릭터의 특별한 전술 선택을 표현한다.

### 6. Loot는 단순 수치가 아니라 새로운 플레이 방식을 제공해야 한다.

### 7. 위치와 이동 자체가 전술이어야 한다.

### 8. Adventure는 여러 종류의 Objective를 사용한다.

### 9. 싱글과 협동은 동일한 GameCore를 사용한다.

### 10. PixiJS, DOM, PF2e Rule Engine을 서로 분리한다.

---

# 46. 프로젝트를 한 문장으로 정의

> **PF2e Remaster를 내부 전투 엔진으로 사용하고, 항상 사용할 수 있는 Basic Actions와 획득형 Tactical Cards를 조합해 1~3명이 격자형 Adventure를 공략하는 협력 보드 전략 RPG.**

그리고 이 게임에서 카드의 의미는 다음 한 문장으로 정의한다.

> **Card는 행동할 수 있는 권한이 아니라, 평범한 행동을 특별한 전술로 바꾸는 선택지다.**

이 두 문장을 이후 모든 기능 설계의 기준으로 사용한다.
