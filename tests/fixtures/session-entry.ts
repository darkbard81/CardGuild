import { compileContentPack } from "../../src/content/compile-content";
import { SessionLobbyUi } from "../../src/dom/session-lobby-ui";
import { createPresentationCatalog } from "../../src/presentation";
import { createCoreContentSource } from "./content";
import "./component-shell";

const calls: string[][] = [];
const submit = (...args: string[]) => { calls.push(args); ui.setBusy(true); };
const noop = () => undefined;
const ui = new SessionLobbyUi(compileContentPack(createCoreContentSource()), createPresentationCatalog(), {
  onNewAdventure: () => ui.renderNewAdventure(), onShowJoin: () => ui.renderJoin(),
  onShowCampaigns: noop, onRetryAuth: noop, onShowLanding: () => ui.renderLanding(),
  onShowLogin: () => ui.renderLogin(), onShowRegister: () => ui.renderRegister(), onLogout: noop,
  onLogin: submit, onRegister: submit, onJoin: submit, onCreateCampaign: submit,
  onContinueCampaign: noop, onSetParty: noop, onSelectCharacter: noop,
  onRemoveOfflineGuest: noop, onBegin: noop, onResume: noop,
});
const fixture = { calls, ui };
declare global { interface Window { sessionEntryFixture: typeof fixture } }
window.sessionEntryFixture = fixture;
document.querySelector<HTMLElement>("#app")!.dataset.screen = "session";
ui.renderLanding();
