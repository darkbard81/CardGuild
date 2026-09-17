import { BattleUi } from "../../src/dom/battle-ui";
import { createTacticalCombatFixture } from "./content";
import { createCombat } from "../../src/game";
import { createPresentationCatalog } from "../../src/presentation";
import "./component-shell";

const definition = createTacticalCombatFixture({ rules: "character-rules" });
const content = { ...definition.content, cards: { ...definition.content.cards } };
const initial = createCombat(definition, 34).state;
let state = { ...initial, turn: { ...initial.turn, activeActorId: "hero" },
  actors: { ...initial.actors,
    hero: { ...initial.actors.hero!, position: { x: 1, y: 1 }, equipmentIds: ["halberd", "shield", "boots-of-fly"] },
    "goblin-skirmisher": { ...initial.actors["goblin-skirmisher"]!, position: { x: 2, y: 1 } },
  },
  cardZones: { ...initial.cardZones, hero: { hand: ["card.trip", "card.fly"].map(id => ({
    id, definitionId: id, source: { kind: "prepared" as const, memberId: "hero" },
  })), drawPile: [], discardPile: [] } },
};
const selections: string[] = [];
const previews: Array<string | null> = [];
const ui = new BattleUi(content, definition.scenario, createPresentationCatalog(), {
  onCard: action => selections.push(action.source.id),
  onCardHover: action => previews.push(action?.source.id ?? null),
  onEndTurn: () => undefined, onUseReaction: () => undefined,
  onPassReaction: () => undefined, onRestart: () => undefined,
});
const render = () => ui.render(state, [], { selectedAction: null, moveBands: [], prompt: "Choose a card",
  stateHash: "fixture", controlledActorId: "hero", canControl: true });
const fixture = {
  setCount: (count: number) => {
    state = { ...state, cardZones: { ...state.cardZones, hero: { ...state.cardZones.hero!, hand: Array.from({ length: count }, (_, index) => ({ id: `hand-${index}`, definitionId: "card.trip", source: { kind: "prepared" as const, memberId: "hero" } })) } } };
    render();
  },
  setActive: (actorId: string) => { state = { ...state, turn: { ...state.turn, activeActorId: actorId } }; render(); },
  selections, previews, render, hide: () => ui.hideCardDetail(), destroy: () => ui.destroy(),
  lock: () => { content.cards["card.trip"] = { ...content.cards["card.trip"]!, level: 2 }; render(); },
  disable: () => { state = { ...state, turn: { ...state.turn, actionsRemaining: 0 } }; render(); },
  retired: null as HTMLElement | null,
};
declare global { interface Window { handCardFixture: typeof fixture } }
window.handCardFixture = fixture;
document.querySelector<HTMLElement>("#app")!.dataset.screen = "combat";
document.querySelector<HTMLElement>(".combat-stage")!.hidden = false;
render();
