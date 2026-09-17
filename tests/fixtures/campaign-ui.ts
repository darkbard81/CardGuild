import { PRODUCTION_CONTENT } from "../../src/content";
import type { CampaignSummary } from "../../src/campaign/types";
import { SessionLobbyUi } from "../../src/dom/session-lobby-ui";
import { createPresentationCatalog } from "../../src/presentation";
import { fixtureBegun, fixtureControl } from "./campaign-save";
import type { SessionCoreState } from "../../src/session";
import "./component-shell";

const calls: string[] = [];
const noop = () => undefined;
const ui = new SessionLobbyUi(PRODUCTION_CONTENT.pack, createPresentationCatalog(), {
  onNewAdventure: noop, onShowJoin: noop, onShowCampaigns: () => calls.push("refresh"), onRetryAuth: noop,
  onShowLanding: noop, onShowLogin: noop, onShowRegister: noop, onLogout: noop,
  onLogin: noop, onRegister: noop, onJoin: noop, onCreateCampaign: noop,
  onContinueCampaign: id => { calls.push(id); ui.setBusy(true); }, onSetParty: noop,
  onReleaseCharacter: () => undefined, onSelectCharacter: id => calls.push(id), onRemoveOfflineGuest: noop, onBegin: noop, onResume: noop,
});
const campaign: CampaignSummary = {
  campaignId: "campaign-test", name: "친구들과 함께한 모험", hasSave: true, createdAt: 0, updatedAt: 1700000000000,
  savedAt: 1700000000000, saveStatus: "ready", progress: {
    phase: "combat", completedEncounters: 2, totalEncounters: 8, encounterId: "encounter", encounterName: "고블린 야영지",
    party: [{ memberId: "party.hero-1", actorDefinitionId: "hero.aerin", name: "Aerin", level: 2 },
      { memberId: "party.hero-2", actorDefinitionId: "hero.lyra", name: "Lyra", level: 3 }],
  },
};
function list(items: readonly CampaignSummary[] = [campaign]): void {
  ui.renderCampaigns({ accountId: "account", username: "Host" }, items);
}
function resume(guest = false, offline = false): void {
  const begun = fixtureBegun();
  const state: SessionCoreState = { ...begun, lifecycle: "resume-lobby",
    seats: [...begun.seats, { playerId: "guest", displayName: "Guest", seat: 2 }],
    guestClaims: { byMemberId: offline ? { "party.hero-2": "guest" } : {} },
  };
  const control = fixtureControl(state);
  ui.renderLobby(state, guest ? "guest" : state.hostPlayerId, offline ? {
    connectedPlayerIds: [state.hostPlayerId],
    effectiveControllerByMemberId: Object.fromEntries(state.partySlots.map(slot => [slot.memberId, state.hostPlayerId])),
  } : control);
}
const fixture = { ui, calls, campaign, list, resume };
declare global { interface Window { campaignUiFixture: typeof fixture } }
window.campaignUiFixture = fixture;
document.querySelector<HTMLElement>("#app")!.dataset.screen = "session";
list();
