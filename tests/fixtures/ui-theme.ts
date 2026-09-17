import { createAdventureSession } from "../../src/adventure";
import { compileContentPack } from "../../src/content/compile-content";
import { AdventureUi } from "../../src/dom/adventure-ui";
import { LoadoutUi } from "../../src/dom/loadout-ui";
import { createPresentationCatalog } from "../../src/presentation";
import { createCoreContentSource, FIXTURE_ADVENTURE_ID } from "./content";
import "./session-entry";

const pack = compileContentPack(createCoreContentSource());
const definition = pack.adventures[FIXTURE_ADVENTURE_ID]!;
const actor = pack.actorDefinitions["hero.aerin"]!;
const state = createAdventureSession({ definition, actorDefinitions: pack.actorDefinitions,
  characterRules: pack.characterRules, combatContent: pack.combatContent }, {
  members: { hero: { id: "hero", seat: 1, actorDefinitionId: actor.id, loadout: actor.starterLoadout } },
}, 1);
const catalog = createPresentationCatalog();
const noop = () => undefined;
const adventure = new AdventureUi(definition, pack, {
  onAdvanceCharacter: () => false, onStart: noop, onContinue: noop, onChooseReward: noop,
  onOpenLoadout: noop, onRetry: noop,
}, catalog);
adventure.render(state);
const loadout = new LoadoutUi(pack, catalog, { onDone: noop, onSetLoadout: () => true });
loadout.render(state, new Set(["hero"]));
window.sessionEntryFixture.ui.renderLogin();
document.querySelector<HTMLElement>("#app")!.dataset.screen = "session";
