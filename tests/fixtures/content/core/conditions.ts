import type { ConditionDefinition } from "../../../../src/game";

/**
 * The Conditions the core Actions can apply, with the value policy each one follows.
 */
export const CORE_CONDITIONS: readonly ConditionDefinition[] = [
  {
    id: "prone",
    name: "Prone",
    traits: [
      {
        id: "condition",
      },
      {
        id: "prone",
      },
    ],
  },
  {
    id: "grabbed",
    name: "Grabbed",
    traits: [
      {
        id: "condition",
      },
      {
        id: "grabbed",
      },
    ],
  },
];
