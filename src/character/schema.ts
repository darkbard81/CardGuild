import { ATTRIBUTE_IDS, SKILL_IDS } from "../game/statistics";

/** Shared structural contract for untrusted network choices and durable save history. */
const skillIncrease = { enum: SKILL_IDS };
const attributeBoosts = { type: "array", minItems: 4, maxItems: 4, uniqueItems: true, items: { enum: ATTRIBUTE_IDS } };
export const CHARACTER_ADVANCEMENT_CHOICE_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["level", "skillIncrease"],
      properties: { level: { enum: [3, 7, 9, 11, 13, 17, 19] }, skillIncrease } },
    { type: "object", additionalProperties: false, required: ["level", "skillIncrease", "attributeBoosts"],
      properties: { level: { enum: [5, 15] }, skillIncrease, attributeBoosts } },
    { type: "object", additionalProperties: false, required: ["level", "attributeBoosts"],
      properties: { level: { enum: [10, 20] }, attributeBoosts } },
  ],
} as const;

export const CHARACTER_PROGRESSION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["level", "experience", "advancements"],
  properties: {
    level: { type: "integer", minimum: 1 },
    experience: { type: "integer", minimum: 0, maximum: 999 },
    advancements: { type: "array", maxItems: 11, items: CHARACTER_ADVANCEMENT_CHOICE_SCHEMA },
  },
} as const;
