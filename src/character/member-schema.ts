const text = { type: "string", minLength: 1, maxLength: 512 } as const;
export const CREATE_CHARACTER_PROPERTIES = {
  name: { type: "string", minLength: 1, maxLength: 80 },
  gender: { enum: ["male", "female"] },
  creationPresetId: text,
} as const;
export const MEMBER_IDENTITY_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["origin", "name", "gender", "creationPresetId"],
      properties: { origin: { const: "player-created" }, ...CREATE_CHARACTER_PROPERTIES } },
    { type: "object", additionalProperties: false, required: ["origin", "recruitmentSource"],
      properties: { origin: { const: "companion" }, recruitmentSource: text } },
  ],
} as const;
