import type {
  ActorStatProfile, ArmorCategory, AttributeId, ProficiencyRank, SaveId, SkillId,
  TraitDefinition, TraitId, TraitInstance, WeaponCategory,
} from "../game/types";

export interface AncestryDefinition {
  readonly id: TraitId;
  readonly hitPoints: number;
  readonly speedFeet: number;
  readonly fixedBoosts: readonly [AttributeId, AttributeId];
}

export interface ClassProficiencyProfile {
  readonly perception: ProficiencyRank;
  readonly saves: Readonly<Record<SaveId, ProficiencyRank>>;
  readonly armor: Readonly<Record<ArmorCategory, ProficiencyRank>>;
  readonly weapons: Readonly<Record<WeaponCategory, ProficiencyRank>>;
  readonly classDc: ProficiencyRank;
}

export interface ClassProficiencyMilestone {
  readonly level: number;
  readonly perception?: ProficiencyRank;
  readonly saves?: Readonly<Partial<Record<SaveId, ProficiencyRank>>>;
  readonly armor?: Readonly<Partial<Record<ArmorCategory, ProficiencyRank>>>;
  readonly weapons?: Readonly<Partial<Record<WeaponCategory, ProficiencyRank>>>;
  readonly classDc?: ProficiencyRank;
}

export interface ClassDefinition {
  readonly id: TraitId;
  readonly hpPerLevel: number;
  readonly keyAttribute: AttributeId;
  readonly starting: ClassProficiencyProfile;
  readonly milestones: readonly ClassProficiencyMilestone[];
}

export interface CharacterBuild {
  readonly freeBoosts: readonly [AttributeId, AttributeId, AttributeId, AttributeId];
  readonly trainedSkills: readonly SkillId[];
}

export interface CharacterAdvancementChoice {
  readonly level: number;
  readonly skillIncrease?: SkillId;
  readonly attributeBoosts?: readonly [AttributeId, AttributeId, AttributeId, AttributeId];
}

export interface CharacterProgressionState {
  readonly level: number;
  readonly experience: number;
  readonly advancements: readonly CharacterAdvancementChoice[];
}

/** Authored characters retain their inputs; runtime progression lives on the party member. */
export interface CharacterBuildSource {
  readonly build: CharacterBuild;
  readonly level: number;
  readonly advancements: readonly CharacterAdvancementChoice[];
}

export interface CharacterRulesInput {
  readonly traits: readonly TraitInstance[];
  readonly build: CharacterBuild;
  readonly progression: CharacterProgressionState;
}

export interface CharacterRulesContext {
  readonly traits: Readonly<Record<TraitId, TraitDefinition>>;
  readonly ancestries: Readonly<Record<TraitId, AncestryDefinition>>;
  readonly classes: Readonly<Record<TraitId, ClassDefinition>>;
}

export interface ResolvedCharacterRules {
  readonly statProfile: Extract<ActorStatProfile, { kind: "character" }>;
  readonly speedFeet: number;
  readonly partialAttributeBoosts: Readonly<Record<AttributeId, boolean>>;
}
