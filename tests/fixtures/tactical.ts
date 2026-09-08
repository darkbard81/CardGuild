import { Application, Text } from "pixi.js";
import { BattleController } from "../../src/app/battle-controller";
import { M6_COMBAT_DEFINITION } from "../../src/content/load-m6-content";
import { createCombat, dispatchCombatCommand, hashCombatState } from "../../src/game";
import type { CombatEvent, CombatState } from "../../src/game";
import type { SessionIntent } from "../../src/session";
import { createPresentationCatalog } from "../../src/presentation";
import "../../src/style.css";

export type TacticalCase = "front" | "rear" | "flanking" | "both";
export interface TacticalFixture {
  state: CombatState;
  events: CombatEvent[];
  intents: SessionIntent[];
  rejectNext: boolean;
  rejectAfterSend: boolean;
  addStrikeCard: () => void;
  addStepCard: () => void;
  setActions: (remaining: number) => void;
  nudgeHp: (hp: number) => void;
  placeHero: (x: number, y: number) => { width: number; height: number };
  setPenalty: (value: number) => void;
  reset: (mode: TacticalCase) => void;
  send: (intent: SessionIntent) => boolean;
  loseAlly: () => void;
  bounds: (label: string) => { x: number; y: number; width: number; height: number } | null;
  boardText: () => string[];
}
declare global { interface Window { tacticalFixture: TacticalFixture } }

async function start() {
  const root = document.querySelector<HTMLElement>("#pixi-root")!;
  const shell = document.querySelector<HTMLElement>("#app")!;
  shell.dataset.screen = "combat";
  for (const selector of ["#session-screen", "#adventure-screen", "#loadout-screen"]) {
    const screen = document.querySelector<HTMLElement>(selector);
    if (screen) screen.hidden = true;
  }
  const app = new Application();
  await app.init({ resizeTo: root, background: "#111820", antialias: true, preference: "webgl", eventFeatures: { click: true, move: true, globalMove: false, wheel: false } });
  app.canvas.id = "pixi-canvas";
  root.append(app.canvas);
  app.resize();
  const catalog = createPresentationCatalog();
  await catalog.loadEncounterBundle();
  let controller: BattleController | null = null;
  const content = { ...M6_COMBAT_DEFINITION.content, cards: { ...M6_COMBAT_DEFINITION.content.cards }, conditions: { ...M6_COMBAT_DEFINITION.content.conditions } };
  const definition = { ...M6_COMBAT_DEFINITION, content };
  const opened = createCombat(M6_COMBAT_DEFINITION, 34).state;
  const fixture: TacticalFixture = {
    state: opened, events: [], intents: [], rejectNext: false, rejectAfterSend: false,
    reset(mode) {
      const hero = { ...opened.actors.hero!, position: { x: 1, y: 1 }, facing: "east" as const };
      const enemy = { ...opened.actors["goblin-skirmisher"]!, position: { x: 2, y: 1 }, hp: 200, maxHp: 200,
        facing: mode === "rear" || mode === "both" ? "east" as const : "west" as const };
      const ally = { ...hero, id: "ally", name: "Brom", position: mode === "front" || mode === "rear" ? { x: 1, y: 3 } : { x: 3, y: 1 }, facing: "west" as const,
        defeated: false };
      fixture.state = { ...opened, actors: { hero, [enemy.id]: enemy, ally },
        turn: { ...opened.turn, activeActorId: "hero", activeIndex: 0, initiativeOrder: ["hero", enemy.id, "ally"] },
        cardZones: { ...opened.cardZones, ally: structuredClone(opened.cardZones.hero!) } };
      fixture.events = [];
      fixture.intents = [];
      controller?.update(fixture.state, [], true);
    },
    send(intent) {
      if (fixture.rejectNext) { fixture.rejectNext = false; return false; }
      if (intent.type !== "use-action" && intent.type !== "end-turn") return false;
      fixture.intents.push(intent);
      if (fixture.rejectAfterSend) {
        fixture.rejectAfterSend = false;
        queueMicrotask(() => controller?.reportError("Rejected by fixture"));
        return true;
      }
      const result = dispatchCombatCommand(fixture.state, { ...intent, actorId: fixture.state.turn.activeActorId,
        id: `fixture-${fixture.state.sequence + 1}`, sequence: fixture.state.sequence + 1 }, content);
      if (!result.accepted) throw new Error(result.error);
      fixture.state = result.state;
      fixture.events.push(...result.events);
      queueMicrotask(() => controller?.update(fixture.state, result.events));
      return true;
    },
    addStrikeCard() {
      content.cards["card.fixture-strike"] = { id: "card.fixture-strike", name: "Fixture Strike", actionId: "strike", traits: [] };
      const zones = fixture.state.cardZones.hero!;
      fixture.state = { ...fixture.state, cardZones: { ...fixture.state.cardZones, hero: { ...zones,
        hand: [{ id: "fixture-strike", definitionId: "card.fixture-strike", source: { kind: "prepared", memberId: "hero" } }, ...zones.hand] } } };
      controller?.update(fixture.state, []);
    },
    addStepCard() {
      content.cards["card.fixture-step"] = { id: "card.fixture-step", name: "Fixture Step", actionId: "step", traits: [] };
      const zones = fixture.state.cardZones.hero!;
      fixture.state = { ...fixture.state, cardZones: { ...fixture.state.cardZones, hero: { ...zones,
        hand: [{ id: "fixture-step", definitionId: "card.fixture-step", source: { kind: "prepared", memberId: "hero" } }, ...zones.hand] } } };
      controller?.update(fixture.state, []);
    },
    /** A second snapshot with something visible in it, delivered the way the server does. */
    nudgeHp(hp) {
      const hero = fixture.state.actors.hero!;
      fixture.state = { ...fixture.state, actors: { ...fixture.state.actors, hero: { ...hero, hp } } };
      controller?.update(fixture.state, []);
    },
    /** Stands the hero on a chosen square, so a test can reach the map's edges. */
    placeHero(x, y) {
      const hero = fixture.state.actors.hero!;
      fixture.state = { ...fixture.state, actors: { ...fixture.state.actors, hero: { ...hero, position: { x, y } } } };
      controller?.update(fixture.state, [], true);
      return { width: fixture.state.map.width, height: fixture.state.map.height };
    },
    /** Lets a test spend the turn down so the next Action opens the final-facing widget. */
    setActions(remaining) {
      fixture.state = { ...fixture.state, turn: { ...fixture.state.turn, actionsRemaining: remaining } };
      controller?.update(fixture.state, []);
    },
    setPenalty(value) {
      content.conditions["fixture-penalty"] = { id: "fixture-penalty", name: "Fixture AC", traits: [],
        statModifiers: [{ selector: { kind: "ac" }, type: "circumstance", value, label: "Fixture AC" }] };
      const target = fixture.state.actors["goblin-skirmisher"]!;
      fixture.state = { ...fixture.state, actors: { ...fixture.state.actors,
        [target.id]: { ...target, conditions: [{ id: "fixture-penalty", sourceId: "fixture" }] } } };
      controller?.update(fixture.state, []);
    },
    bounds(label) {
      const graphic = app.stage.getChildByLabel(label, true);
      if (!graphic) return null;
      const bounds = graphic.getBounds();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    },
    /** Every string the board itself draws, so a test can prove the rule labels are gone. */
    boardText() {
      const found: string[] = [];
      const walk = (node: { children?: unknown[] }) => {
        if (node instanceof Text) found.push(node.text);
        for (const child of node.children ?? []) walk(child as { children?: unknown[] });
      };
      walk(app.stage);
      return found;
    },
    loseAlly() {
      fixture.state = { ...fixture.state, actors: { ...fixture.state.actors, ally: { ...fixture.state.actors.ally!, defeated: true } } };
      controller?.update(fixture.state, []);
    },
  };
  fixture.reset("front");
  controller = new BattleController(app, catalog, { definition, state: fixture.state,
    history: [], controlledActorIds: new Set(["hero", "ally"]), onIntent: fixture.send });
  window.tacticalFixture = fixture;
  shell.dataset.ready = "true";
  shell.dataset.stateHash = hashCombatState(fixture.state);
}
void start();
