export type EntityId = string;
export type ActionId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;
export type EquipmentId = string;
export type EquipmentSlotId = "weapon" | "shield" | "feet";
export type EffectId = string;
export type ObjectId = string;
export type TraitId = string;
export type ConditionId = string;
export type ActorDefinitionId = string;
export type ScenarioId = string;
export type AdventureId = string;

export type TeamId = "heroes" | "enemies";
export type Direction = "north" | "east" | "south" | "west";
export type MovementMode = "land" | "fly";
export type DegreeOfSuccess =
  | "critical-success"
  | "success"
  | "failure"
  | "critical-failure";
export type CombatOutcome = "victory" | "defeat";
export type AttributeId = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type ProficiencyRank = "untrained" | "trained" | "expert" | "master" | "legendary";
export type SaveId = "fortitude" | "reflex" | "will";
export type SkillId =
  | "acrobatics"
  | "arcana"
  | "athletics"
  | "crafting"
  | "deception"
  | "diplomacy"
  | "intimidation"
  | "medicine"
  | "nature"
  | "occultism"
  | "performance"
  | "religion"
  | "society"
  | "stealth"
  | "survival"
  | "thievery";
export type ModifierType = "circumstance" | "item" | "status" | "untyped";

export interface CharacterStatProfile {
  readonly level: number;
  readonly attributes: Readonly<Record<AttributeId, number>>;
  readonly perception: ProficiencyRank;
  readonly saves: Readonly<Record<SaveId, ProficiencyRank>>;
  readonly skills: Readonly<Record<SkillId, ProficiencyRank>>;
}

export interface FixedCreatureStats {
  readonly perception: number;
  readonly saves: Readonly<Record<SaveId, number>>;
  readonly skills: Readonly<Partial<Record<SkillId, number>>>;
}

export type ActorStatProfile =
  | { readonly kind: "character"; readonly stats: CharacterStatProfile }
  | { readonly kind: "creature"; readonly stats: FixedCreatureStats };

export type StatisticSelector =
  | { readonly kind: "save"; readonly id: SaveId }
  | { readonly kind: "skill"; readonly id: SkillId; readonly attributeOverride?: AttributeId }
  | { readonly kind: "perception" };

export type StatisticModifierSelector =
  | { readonly kind: "all" }
  | { readonly kind: "save"; readonly id?: SaveId }
  | { readonly kind: "skill"; readonly id?: SkillId }
  | { readonly kind: "perception" };

export interface StatisticModifierContribution {
  readonly selector: StatisticModifierSelector;
  readonly type: ModifierType;
  readonly value: number;
  readonly label: string;
}

export interface StatisticContextModifier extends StatisticModifierContribution {
  readonly sourceId: string;
}

export type StatisticSourceKind =
  | "attribute"
  | "proficiency"
  | "fixed"
  | "dc"
  | "equipment"
  | "condition"
  | "trait"
  | "context";

export interface StatisticSource {
  readonly kind: StatisticSourceKind;
  readonly sourceId: string;
  readonly label: string;
  readonly value: number;
  readonly modifierType?: ModifierType;
  readonly applied: boolean;
}

export interface ResolvedStatistic {
  readonly value: number;
  readonly sources: readonly StatisticSource[];
}

export interface ContentIdentity {
  readonly packId: string;
  readonly packVersion: string;
  readonly fingerprint: string;
}

export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export interface TraitInstance {
  readonly id: TraitId;
  readonly sourceId?: string;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

export interface ConditionInstance {
  readonly id: ConditionId;
  readonly sourceId: string;
}

export interface DamageDie {
  readonly count: number;
  readonly sides: number;
  readonly modifier: number;
  readonly damageType: "slashing" | "piercing" | "bludgeoning" | "force";
}

export interface WeaponProfile {
  readonly name: string;
  readonly attackModifier: number;
  readonly rangeFeet: number;
  readonly damage: DamageDie;
}

export interface ActorState {
  readonly id: EntityId;
  readonly definitionId: ActorDefinitionId;
  readonly name: string;
  readonly team: TeamId;
  readonly position: GridPosition;
  readonly facing: Direction;
  readonly hp: number;
  readonly maxHp: number;
  readonly baseAc: number;
  readonly statProfile: ActorStatProfile;
  readonly speedFeet: number;
  readonly fallbackWeapon: WeaponProfile;
  readonly conditions: readonly ConditionInstance[];
  readonly traits: readonly TraitInstance[];
  readonly equipmentIds: readonly EquipmentId[];
  readonly innateActionIds: readonly ActionId[];
  readonly deckContributions: readonly DeckContribution[];
  readonly reactionAvailable: boolean;
  readonly shieldRaised: boolean;
  readonly defeated: boolean;
}

export interface TileState {
  readonly id: string;
  readonly position: GridPosition;
  readonly traits: readonly TraitInstance[];
}

export interface MapInteraction {
  readonly kind: "open-gate";
  readonly targetTileId: string;
}

export interface MapObjectState {
  readonly id: ObjectId;
  readonly name: string;
  readonly position: GridPosition;
  readonly traits: readonly TraitInstance[];
  readonly interaction: MapInteraction;
  readonly used: boolean;
}

export interface BattleMapState {
  readonly width: number;
  readonly height: number;
  readonly tiles: Readonly<Record<string, TileState>>;
  readonly objects: Readonly<Record<ObjectId, MapObjectState>>;
}

export interface EffectInstance {
  readonly id: EffectId;
  readonly name: string;
  readonly sourceId: string;
  readonly targetActorId: EntityId;
  readonly traits: readonly TraitInstance[];
  readonly createdOnTurn: number;
  readonly sustainedOnTurn: number | null;
}

export type DeckContributionSource =
  | { readonly kind: "base"; readonly sourceId: string }
  | { readonly kind: "prepared"; readonly memberId: string }
  | {
      readonly kind: "equipment-trait";
      readonly equipmentId: EquipmentId;
      readonly traitId: TraitId;
    };

export interface DeckContribution {
  readonly cardDefinitionId: CardDefinitionId;
  readonly count: number;
  readonly source: DeckContributionSource;
}

export interface CardInstance {
  readonly id: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly source: DeckContributionSource;
}

export interface CardZones {
  readonly drawPile: readonly CardInstance[];
  readonly hand: readonly CardInstance[];
  readonly discardPile: readonly CardInstance[];
}

export interface RngState {
  readonly value: number;
}

export interface TurnState {
  readonly initiativeOrder: readonly EntityId[];
  readonly activeIndex: number;
  readonly activeActorId: EntityId;
  readonly actionsRemaining: number;
  readonly attacksThisTurn: number;
  readonly turnNumber: number;
  readonly lockedActionIds: readonly ActionId[];
}

export type ActionSource =
  | { readonly kind: "basic" | "context" | "innate"; readonly id: ActionId }
  | { readonly kind: "card"; readonly id: CardInstanceId };

export type ActionTarget =
  | { readonly kind: "none" }
  | { readonly kind: "actor"; readonly actorId: EntityId }
  | {
      readonly kind: "tile";
      readonly position: GridPosition;
      readonly facing: Direction;
    }
  | { readonly kind: "object"; readonly objectId: ObjectId }
  | { readonly kind: "effect"; readonly effectId: EffectId };

export type CombatCommand =
  | {
      readonly type: "use-action";
      readonly id: string;
      readonly sequence: number;
      readonly actorId: EntityId;
      readonly action: ActionSource;
      readonly target: ActionTarget;
    }
  | {
      readonly type: "end-turn";
      readonly id: string;
      readonly sequence: number;
      readonly actorId: EntityId;
    }
  | {
      readonly type: "use-reaction";
      readonly id: string;
      readonly sequence: number;
      readonly actorId: EntityId;
      readonly triggerId: string;
      readonly cardInstanceId: CardInstanceId;
    }
  | {
      readonly type: "pass-reaction";
      readonly id: string;
      readonly sequence: number;
      readonly actorId: EntityId;
      readonly triggerId: string;
    };

export interface ReactionCandidate {
  readonly actorId: EntityId;
  readonly cardInstanceId: CardInstanceId;
  readonly actionId: ActionId;
}

export interface MoveContinuation {
  readonly kind: "move";
  readonly actorId: EntityId;
  readonly actionId: ActionId;
  readonly source: ActionSource;
  readonly path: readonly GridPosition[];
  readonly destination: GridPosition;
  readonly facing: Direction;
  readonly movementMode: MovementMode;
}

export interface PendingReaction {
  readonly triggerId: string;
  readonly type: "enemy-move";
  readonly sourceActorId: EntityId;
  readonly candidates: readonly ReactionCandidate[];
  readonly continuation: MoveContinuation;
}

export interface CombatState {
  readonly version: 4;
  readonly scenarioId: string;
  readonly seed: number;
  readonly contentIdentity: ContentIdentity;
  readonly setupFingerprint: string;
  readonly round: number;
  readonly turn: TurnState;
  readonly actors: Readonly<Record<EntityId, ActorState>>;
  readonly map: BattleMapState;
  readonly effects: Readonly<Record<EffectId, EffectInstance>>;
  readonly cardZones: Readonly<Record<EntityId, CardZones>>;
  readonly rng: RngState;
  readonly sequence: number;
  readonly nextEffectSequence: number;
  readonly pendingReaction: PendingReaction | null;
  readonly outcome: CombatOutcome | null;
  readonly commandLog: readonly CombatCommand[];
}

export type ActionTiming =
  | { readonly kind: "turn"; readonly actions: 1 | 2 | 3 }
  | { readonly kind: "reaction" };

export type ActionTargeting = "none" | "self" | "enemy" | "tile" | "object" | "effect";

export type ActionEffect =
  | {
      readonly kind: "move";
      readonly movementMode: MovementMode;
      readonly step: boolean;
      readonly triggersReactions: boolean;
    }
  | {
      readonly kind: "weapon-attack";
      readonly damageMultiplier: number;
      readonly applyCondition?: ConditionId;
    }
  | { readonly kind: "trip" }
  | { readonly kind: "remove-condition"; readonly condition: ConditionId }
  | {
      readonly kind: "recovery-check";
      readonly condition: ConditionId;
      readonly modifier: "athletics";
      readonly dc: number;
      readonly outcomes: DegreeOutcomeMap;
    }
  | { readonly kind: "raise-shield" }
  | { readonly kind: "interact" }
  | { readonly kind: "create-sustained-effect"; readonly effectName: string }
  | { readonly kind: "sustain-effect" };

export interface ActionDefinition {
  readonly id: ActionId;
  readonly name: string;
  readonly description: string;
  readonly timing: ActionTiming;
  readonly traits: readonly TraitInstance[];
  readonly targeting: ActionTargeting;
  readonly effect: ActionEffect;
}

export interface CardDefinition {
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly actionId: ActionId;
  readonly traits: readonly TraitInstance[];
}

export interface CardGrant {
  readonly cardDefinitionId: CardDefinitionId;
  readonly count: number;
  readonly sourceId: string;
  readonly traitId?: TraitId;
}

export type ContextActionGroup = "escape" | "interact" | "shield" | "sustain";

export interface TraitCardGrant {
  readonly cardDefinitionId: CardDefinitionId;
  readonly count: number;
}

export interface TraitActionGrant {
  readonly actionId: ActionId;
  readonly contextGroup: ContextActionGroup;
}

export interface ContextActionOption {
  readonly source: ActionSource;
  readonly group: ContextActionGroup;
}

export interface TraitDefinition {
  readonly id: TraitId;
  readonly name: string;
  readonly cardGrants: readonly TraitCardGrant[];
  readonly actionGrants: readonly TraitActionGrant[];
  readonly statModifiers?: readonly StatisticModifierContribution[];
}

export interface ConditionDefinition {
  readonly id: ConditionId;
  readonly name: string;
  readonly traits: readonly TraitInstance[];
  readonly statModifiers?: readonly StatisticModifierContribution[];
}

export type DegreeOutcomeEffect =
  | { readonly kind: "remove-condition"; readonly condition: ConditionId }
  | { readonly kind: "lock-action"; readonly actionId: ActionId };

export type DegreeOutcomeMap = Readonly<
  Record<DegreeOfSuccess, readonly DegreeOutcomeEffect[]>
>;

export interface EquipmentDefinition {
  readonly id: EquipmentId;
  readonly name: string;
  readonly slot: EquipmentSlotId;
  readonly traits: readonly TraitInstance[];
  readonly statModifiers: readonly StatisticModifierContribution[];
  readonly weaponProfile?: WeaponProfile;
  readonly shieldBonus?: number;
}

export type ActorSetup = Omit<ActorState, "reactionAvailable" | "shieldRaised" | "defeated">;

export interface ObjectiveDefinition {
  readonly kind: "defeat-all-enemies";
  readonly description: string;
}

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  readonly name: string;
  readonly objective: ObjectiveDefinition;
  readonly actors: readonly ActorSetup[];
  readonly map: BattleMapState;
}

export interface CombatContent {
  readonly actions: Readonly<Record<ActionId, ActionDefinition>>;
  readonly cards: Readonly<Record<CardDefinitionId, CardDefinition>>;
  readonly equipment: Readonly<Record<EquipmentId, EquipmentDefinition>>;
  readonly traits: Readonly<Record<TraitId, TraitDefinition>>;
  readonly conditions: Readonly<Record<ConditionId, ConditionDefinition>>;
}

export interface CombatDefinition {
  readonly scenario: ScenarioDefinition;
  readonly content: CombatContent;
  readonly contentIdentity: ContentIdentity;
}

export interface CombatReplay {
  readonly scenarioId: string;
  readonly seed: number;
  readonly contentIdentity: ContentIdentity;
  readonly setupFingerprint: string;
  readonly commands: readonly CombatCommand[];
}

export type CombatEvent =
  | { readonly type: "COMBAT_STARTED"; readonly scenarioId: string; readonly seed: number }
  | {
      readonly type: "INITIATIVE_ROLLED";
      readonly actorId: EntityId;
      readonly roll: number;
      readonly modifier: number;
      readonly total: number;
    }
  | { readonly type: "TURN_STARTED"; readonly actorId: EntityId; readonly round: number }
  | { readonly type: "TURN_ENDED"; readonly actorId: EntityId }
  | {
      readonly type: "ACTION_SPENT";
      readonly actorId: EntityId;
      readonly actionId: ActionId;
      readonly amount: number;
      readonly remaining: number;
    }
  | { readonly type: "CARD_PLAYED"; readonly actorId: EntityId; readonly cardInstanceId: CardInstanceId }
  | {
      readonly type: "ACTOR_MOVED";
      readonly actorId: EntityId;
      readonly path: readonly GridPosition[];
      readonly movementMode: MovementMode;
    }
  | { readonly type: "FACING_CHANGED"; readonly actorId: EntityId; readonly facing: Direction }
  | {
      readonly type: "CHECK_ROLLED";
      readonly actorId: EntityId;
      readonly targetActorId?: EntityId;
      readonly label: string;
      readonly roll: number;
      readonly modifier: number;
      readonly dc: number;
      readonly baseDegree: DegreeOfSuccess;
      readonly degree: DegreeOfSuccess;
      readonly modifierSources: readonly string[];
    }
  | {
      readonly type: "DAMAGE_DEALT";
      readonly sourceActorId: EntityId;
      readonly targetActorId: EntityId;
      readonly amount: number;
      readonly damageType: DamageDie["damageType"];
      readonly remainingHp: number;
    }
  | {
      readonly type: "CONDITION_APPLIED";
      readonly actorId: EntityId;
      readonly condition: ConditionInstance["id"];
      readonly sourceId: string;
    }
  | {
      readonly type: "CONDITION_REMOVED";
      readonly actorId: EntityId;
      readonly condition: ConditionId;
    }
  | { readonly type: "ACTION_LOCKED"; readonly actorId: EntityId; readonly actionId: ActionId }
  | { readonly type: "SHIELD_RAISED"; readonly actorId: EntityId; readonly bonus: number }
  | { readonly type: "EFFECT_CREATED"; readonly effectId: EffectId; readonly actorId: EntityId; readonly name: string }
  | { readonly type: "EFFECT_SUSTAINED"; readonly effectId: EffectId; readonly actorId: EntityId }
  | { readonly type: "EFFECT_EXPIRED"; readonly effectId: EffectId; readonly actorId: EntityId }
  | { readonly type: "OBJECT_INTERACTED"; readonly objectId: ObjectId; readonly actorId: EntityId }
  | { readonly type: "TERRAIN_CHANGED"; readonly tileId: string; readonly traits: readonly TraitId[] }
  | { readonly type: "CARD_DRAWN"; readonly actorId: EntityId; readonly cardInstanceId: CardInstanceId }
  | { readonly type: "DISCARD_RESHUFFLED"; readonly actorId: EntityId }
  | {
      readonly type: "REACTION_OPENED";
      readonly triggerId: string;
      readonly sourceActorId: EntityId;
      readonly candidateActorIds: readonly EntityId[];
    }
  | { readonly type: "REACTION_USED"; readonly triggerId: string; readonly actorId: EntityId; readonly actionId: ActionId }
  | { readonly type: "REACTION_PASSED"; readonly triggerId: string; readonly actorId: EntityId }
  | { readonly type: "ACTOR_DEFEATED"; readonly actorId: EntityId }
  | { readonly type: "COMBAT_ENDED"; readonly outcome: CombatOutcome };

export interface CommandResult {
  readonly accepted: boolean;
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
  readonly error?: string;
}

export interface CombatSetupResult {
  readonly state: CombatState;
  readonly events: readonly CombatEvent[];
}

export interface LegalAction {
  readonly source: ActionSource;
  readonly actionId: ActionId;
  readonly name: string;
  readonly description: string;
  readonly timing: ActionTiming;
  readonly traits: readonly TraitId[];
  readonly enabled: boolean;
  readonly reason?: string;
  readonly sourceLabel?: string;
  readonly contextGroup?: ContextActionGroup;
}

export interface ActionValidationResult {
  readonly legal: boolean;
  readonly reason?: string;
}

export type LegalTarget =
  | { readonly kind: "actor"; readonly actorId: EntityId; readonly label: string }
  | { readonly kind: "tile"; readonly position: GridPosition; readonly costFeet: number }
  | { readonly kind: "object"; readonly objectId: ObjectId; readonly label: string }
  | { readonly kind: "effect"; readonly effectId: EffectId; readonly label: string }
  | { readonly kind: "none" };

export interface ActionPreview {
  readonly legal: boolean;
  readonly reason?: string;
  readonly hitChance?: number;
  readonly criticalChance?: number;
  readonly damageRange?: readonly [number, number];
  readonly pathCostFeet?: number;
  readonly notes: readonly string[];
}
