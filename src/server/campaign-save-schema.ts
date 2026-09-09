import Ajv, { type ErrorObject } from "ajv";

/**
 * Structural validation for a durable Campaign save. The payload arrives as `unknown` from
 * SQLite, so nothing may be believed about its shape before this runs. It is deliberately
 * structural only: content references, phase relationships and the snapshot hash are
 * checked by the semantic layer in `campaign-save.ts`.
 */

const nonEmptyString = { type: "string", minLength: 1, maxLength: 512 } as const;
const integer = { type: "integer" } as const;
const nonNegativeInteger = { type: "integer", minimum: 0 } as const;
const contentIdentity = {
  type: "object",
  additionalProperties: false,
  required: ["packId", "packVersion", "fingerprint"],
  properties: { packId: nonEmptyString, packVersion: nonEmptyString, fingerprint: nonEmptyString },
} as const;
const gridPosition = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: nonNegativeInteger, y: nonNegativeInteger },
} as const;
const direction = { enum: ["north", "east", "south", "west"] } as const;
const traitInstance = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: nonEmptyString,
    sourceId: nonEmptyString,
    params: {
      type: "object",
      additionalProperties: { type: ["string", "number", "boolean"] },
    },
  },
} as const;
const conditionInstance = {
  type: "object",
  additionalProperties: false,
  required: ["id", "sourceId"],
  properties: { id: nonEmptyString, sourceId: { type: "string" }, value: integer },
} as const;
const deckContributionSource = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "sourceId"],
      properties: { kind: { const: "base" }, sourceId: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "memberId"],
      properties: { kind: { const: "prepared" }, memberId: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "equipmentId", "traitId"],
      properties: { kind: { const: "equipment-trait" }, equipmentId: nonEmptyString, traitId: nonEmptyString },
    },
  ],
} as const;
const deckContribution = {
  type: "object",
  additionalProperties: false,
  required: ["cardDefinitionId", "count", "source"],
  properties: { cardDefinitionId: nonEmptyString, count: integer, source: deckContributionSource },
} as const;
const cardInstance = {
  type: "object",
  additionalProperties: false,
  required: ["id", "definitionId", "source"],
  properties: { id: nonEmptyString, definitionId: nonEmptyString, source: deckContributionSource },
} as const;
const cardList = { type: "array", items: cardInstance } as const;
const loadout = {
  type: "object",
  additionalProperties: false,
  required: ["equipment", "preparedCards"],
  properties: {
    equipment: {
      type: "object",
      additionalProperties: false,
      properties: { weapon: nonEmptyString, armor: nonEmptyString, shield: nonEmptyString, feet: nonEmptyString },
    },
    preparedCards: { type: "array", items: nonEmptyString },
  },
} as const;
// The stat profile is a derived content projection, so it is checked for shape only. Any
// drift inside it changes the gameplay hash, which the semantic layer verifies exactly.
const statProfile = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "stats"],
  properties: { kind: { enum: ["character", "creature"] }, stats: { type: "object" } },
} as const;
const countMap = { type: "object", additionalProperties: nonNegativeInteger } as const;
const rewardGrant = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "definitionId"],
      properties: { kind: { const: "equipment" }, definitionId: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "definitionId"],
      properties: { kind: { const: "card" }, definitionId: nonEmptyString },
    },
  ],
} as const;

const adventure = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "adventureId",
    "phase",
    "currentEncounterId",
    "completedEncounterIds",
    "party",
    "collection",
    "pendingReward",
    "adventureSeed",
  ],
  properties: {
    version: integer,
    adventureId: nonEmptyString,
    phase: { enum: ["ready", "combat", "reward", "between-encounters", "complete", "failed"] },
    currentEncounterId: { type: ["string", "null"], minLength: 1 },
    completedEncounterIds: { type: "array", items: nonEmptyString },
    party: {
      type: "object",
      additionalProperties: false,
      required: ["members"],
      properties: {
        members: {
          type: "object",
          minProperties: 1,
          maxProperties: 3,
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["id", "seat", "actorDefinitionId", "loadout", "progression"],
            properties: {
              id: nonEmptyString,
              seat: { enum: [1, 2, 3] },
              actorDefinitionId: nonEmptyString,
              loadout,
              progression: {
                type: "object",
                additionalProperties: false,
                required: ["level", "experience"],
                properties: { level: { type: "integer", minimum: 1 }, experience: nonNegativeInteger },
              },
            },
          },
        },
      },
    },
    collection: {
      type: "object",
      additionalProperties: false,
      required: ["equipment", "cards"],
      properties: { equipment: countMap, cards: countMap },
    },
    pendingReward: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["rewardId", "encounterId", "choices"],
      properties: {
        rewardId: nonEmptyString,
        encounterId: nonEmptyString,
        choices: { type: "array", items: rewardGrant },
      },
    },
    adventureSeed: integer,
  },
} as const;

const combatCommand = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "id", "sequence", "actorId", "action", "target"],
      properties: {
        type: { const: "use-action" },
        id: nonEmptyString,
        sequence: integer,
        actorId: nonEmptyString,
        action: { type: "object" },
        target: { type: "object" },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "id", "sequence", "actorId", "facing"],
      properties: {
        type: { const: "end-turn" },
        id: nonEmptyString,
        sequence: integer,
        actorId: nonEmptyString,
        facing: direction,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "id", "sequence", "actorId", "triggerId", "cardInstanceId"],
      properties: {
        type: { const: "use-reaction" },
        id: nonEmptyString,
        sequence: integer,
        actorId: nonEmptyString,
        triggerId: nonEmptyString,
        cardInstanceId: nonEmptyString,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "id", "sequence", "actorId", "triggerId"],
      properties: {
        type: { const: "pass-reaction" },
        id: nonEmptyString,
        sequence: integer,
        actorId: nonEmptyString,
        triggerId: nonEmptyString,
      },
    },
  ],
} as const;

const combat = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "version",
    "scenarioId",
    "seed",
    "contentIdentity",
    "setupFingerprint",
    "round",
    "turn",
    "actors",
    "map",
    "effects",
    "cardZones",
    "rng",
    "sequence",
    "nextEffectSequence",
    "pendingReaction",
    "outcome",
    "commandLog",
  ],
  properties: {
    version: integer,
    scenarioId: nonEmptyString,
    seed: integer,
    contentIdentity,
    setupFingerprint: nonEmptyString,
    round: nonNegativeInteger,
    turn: {
      type: "object",
      additionalProperties: false,
      required: [
        "initiativeOrder",
        "activeIndex",
        "activeActorId",
        "actionsRemaining",
        "attacksThisTurn",
        "turnNumber",
        "lockedActionIds",
      ],
      properties: {
        initiativeOrder: { type: "array", items: nonEmptyString },
        activeIndex: nonNegativeInteger,
        activeActorId: nonEmptyString,
        actionsRemaining: nonNegativeInteger,
        attacksThisTurn: nonNegativeInteger,
        turnNumber: nonNegativeInteger,
        lockedActionIds: { type: "array", items: nonEmptyString },
      },
    },
    actors: {
      type: "object",
      minProperties: 1,
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "definitionId",
          "name",
          "team",
          "position",
          "facing",
          "hp",
          "maxHp",
          "statProfile",
          "speedFeet",
          "conditions",
          "traits",
          "equipmentIds",
          "innateActionIds",
          "deckContributions",
          "reactionAvailable",
          "shieldRaised",
          "defeated",
        ],
        properties: {
          id: nonEmptyString,
          definitionId: nonEmptyString,
          name: { type: "string" },
          team: { enum: ["heroes", "enemies"] },
          position: gridPosition,
          facing: direction,
          hp: integer,
          maxHp: { type: "integer", minimum: 1 },
          statProfile,
          speedFeet: nonNegativeInteger,
          conditions: { type: "array", items: conditionInstance },
          traits: { type: "array", items: traitInstance },
          equipmentIds: { type: "array", items: nonEmptyString },
          innateActionIds: { type: "array", items: nonEmptyString },
          deckContributions: { type: "array", items: deckContribution },
          reactionAvailable: { type: "boolean" },
          shieldRaised: { type: "boolean" },
          defeated: { type: "boolean" },
        },
      },
    },
    map: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height", "tiles", "objects"],
      properties: {
        width: { type: "integer", minimum: 1 },
        height: { type: "integer", minimum: 1 },
        tiles: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["id", "position", "traits"],
            properties: { id: nonEmptyString, position: gridPosition, traits: { type: "array", items: traitInstance } },
          },
        },
        objects: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "position", "traits", "interaction", "used"],
            properties: {
              id: nonEmptyString,
              name: { type: "string" },
              position: gridPosition,
              traits: { type: "array", items: traitInstance },
              interaction: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "targetTileId"],
                properties: { kind: { const: "open-gate" }, targetTileId: nonEmptyString },
              },
              used: { type: "boolean" },
            },
          },
        },
      },
    },
    effects: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "sourceId", "targetActorId", "traits", "createdOnTurn", "sustainedOnTurn"],
        properties: {
          id: nonEmptyString,
          name: { type: "string" },
          sourceId: nonEmptyString,
          targetActorId: nonEmptyString,
          traits: { type: "array", items: traitInstance },
          createdOnTurn: nonNegativeInteger,
          sustainedOnTurn: { type: ["integer", "null"] },
        },
      },
    },
    cardZones: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["drawPile", "hand", "discardPile"],
        properties: { drawPile: cardList, hand: cardList, discardPile: cardList },
      },
    },
    rng: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: integer },
    },
    sequence: nonNegativeInteger,
    nextEffectSequence: nonNegativeInteger,
    pendingReaction: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["triggerId", "type", "sourceActorId", "candidates", "continuation"],
      properties: {
        triggerId: nonEmptyString,
        type: { const: "enemy-move" },
        sourceActorId: nonEmptyString,
        candidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["actorId", "cardInstanceId", "actionId"],
            properties: { actorId: nonEmptyString, cardInstanceId: nonEmptyString, actionId: nonEmptyString },
          },
        },
        continuation: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "actorId", "actionId", "source", "path", "destination", "movementMode"],
          properties: {
            kind: { const: "move" },
            actorId: nonEmptyString,
            actionId: nonEmptyString,
            source: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "id"],
              properties: { kind: { enum: ["basic", "context", "innate", "card"] }, id: nonEmptyString },
            },
            path: { type: "array", items: gridPosition },
            destination: gridPosition,
            movementMode: { enum: ["land", "fly"] },
          },
        },
      },
    },
    outcome: { type: ["string", "null"], enum: ["victory", "defeat", null] },
    commandLog: { type: "array", items: combatCommand },
  },
} as const;

const campaignSaveSchema = {
  type: "object",
  additionalProperties: false,
  required: ["saveSchemaVersion", "contentIdentity", "partySlots", "adventure", "combat"],
  properties: {
    saveSchemaVersion: integer,
    contentIdentity,
    partySlots: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "memberId", "actorDefinitionId"],
        properties: { slot: { enum: [1, 2, 3] }, memberId: nonEmptyString, actorDefinitionId: nonEmptyString },
      },
    },
    adventure,
    combat,
  },
} as const;

// Nullable gameplay fields (pendingReward, combat, sustainedOnTurn, outcome) are genuine
// unions in the runtime types, so union types are allowed while strict mode stays on.
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(campaignSaveSchema);

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 8)
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function validateCampaignSaveShape(value: unknown):
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string } {
  if (validate(value)) return { ok: true };
  return { ok: false, error: formatErrors(validate.errors) };
}
