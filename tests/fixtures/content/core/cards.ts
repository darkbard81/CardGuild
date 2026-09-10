import type { CardDefinition } from "../../../../src/game";

/**
 * Tactical cards, which are how an Action reaches a hand.
 */
export const CORE_CARDS: readonly CardDefinition[] = [
  {
    id: "card.trip",
    name: "Trip",
    actionId: "trip",
    traits: [
      {
        id: "attack",
      },
      {
        id: "trip",
      },
    ],
  },
  {
    id: "card.fly",
    name: "Fly",
    actionId: "fly",
    traits: [
      {
        id: "move",
      },
      {
        id: "fly",
      },
    ],
  },
  {
    id: "card.spirit-beacon",
    name: "Spirit Beacon",
    actionId: "spirit-beacon",
    traits: [
      {
        id: "focus",
      },
      {
        id: "concentrate",
      },
    ],
  },
  {
    id: "card.reactive-strike",
    name: "Reactive Strike",
    actionId: "reactive-strike",
    traits: [
      {
        id: "attack",
      },
      {
        id: "reaction",
      },
    ],
  },
];
