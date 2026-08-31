import Ajv, { type ErrorObject } from "ajv";

import type { ClientMessage } from "./v1-types";

const nonEmptyString = { type: "string", minLength: 1, maxLength: 256 } as const;
const gridPosition = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "integer", minimum: 0 }, y: { type: "integer", minimum: 0 } },
} as const;
const actionSource = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "id"],
      properties: { kind: { enum: ["basic", "context", "innate"] }, id: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "id"],
      properties: { kind: { const: "card" }, id: nonEmptyString },
    },
  ],
} as const;
const actionTarget = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "none" } } },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "actorId"],
      properties: { kind: { const: "actor" }, actorId: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "position", "facing"],
      properties: {
        kind: { const: "tile" },
        position: gridPosition,
        facing: { enum: ["north", "east", "south", "west"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "objectId"],
      properties: { kind: { const: "object" }, objectId: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "effectId"],
      properties: { kind: { const: "effect" }, effectId: nonEmptyString },
    },
  ],
} as const;
const loadout = {
  type: "object",
  additionalProperties: false,
  required: ["equipment", "preparedCards"],
  properties: {
    equipment: {
      type: "object",
      additionalProperties: false,
      properties: { weapon: nonEmptyString, shield: nonEmptyString, feet: nonEmptyString },
    },
    preparedCards: { type: "array", maxItems: 32, items: nonEmptyString },
  },
} as const;
const intent = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "begin-adventure" } } },
    { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "start-encounter" } } },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "rewardId", "choiceIndex"],
      properties: { type: { const: "choose-reward" }, rewardId: nonEmptyString, choiceIndex: { type: "integer", minimum: 0 } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "loadout"],
      properties: { type: { const: "set-loadout" }, loadout },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "action", "target"],
      properties: { type: { const: "use-action" }, action: actionSource, target: actionTarget },
    },
    { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "end-turn" } } },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "triggerId", "cardInstanceId"],
      properties: { type: { const: "use-reaction" }, triggerId: nonEmptyString, cardInstanceId: nonEmptyString },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "triggerId"],
      properties: { type: { const: "pass-reaction" }, triggerId: nonEmptyString },
    },
  ],
} as const;

const clientMessageSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["v", "type", "sessionId", "playerId", "reconnectToken", "contentIdentity"],
      properties: {
        v: { const: 1 },
        type: { const: "hello" },
        sessionId: nonEmptyString,
        playerId: nonEmptyString,
        reconnectToken: nonEmptyString,
        contentIdentity: {
          type: "object",
          additionalProperties: false,
          required: ["packId", "packVersion", "fingerprint"],
          properties: { packId: nonEmptyString, packVersion: nonEmptyString, fingerprint: nonEmptyString },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["v", "type", "requestId", "expectedRevision", "intent"],
      properties: {
        v: { const: 1 },
        type: { const: "intent" },
        requestId: nonEmptyString,
        expectedRevision: { type: "integer", minimum: 0 },
        intent,
      },
    },
  ],
} as const;

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(clientMessageSchema);

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}
export function validateClientMessage(value: unknown):
  | { readonly ok: true; readonly value: ClientMessage }
  | { readonly ok: false; readonly error: string } {
  if (validate(value)) return { ok: true, value: value as ClientMessage };
  return { ok: false, error: formatErrors(validate.errors) };
}

export function parseClientMessage(text: string):
  | { readonly ok: true; readonly value: ClientMessage }
  | { readonly ok: false; readonly error: string } {
  try {
    return validateClientMessage(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, error: "Message is not valid JSON." };
  }
}
