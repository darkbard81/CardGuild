import type { AdventureEvent, AdventureState } from "../adventure";
import { isTerminalHandshakeFailure, SessionClient, type AccountIdentity, type SessionCredential } from "../client";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { AdventureUi } from "../dom/adventure-ui";
import { LoadoutUi } from "../dom/loadout-ui";
import { trackGrowthSummary, type GrowthNotice } from "../dom/progression-view";
import { SessionLobbyUi } from "../dom/session-lobby-ui";
import type { CombatEvent, CombatState } from "../game";
import type { PartyMemberLoadout } from "../loadout";
import type { AssetCatalog } from "../presentation";
import type { ServerSnapshot } from "../protocol";
import type { SessionEvent, SessionIntent, SessionSeat } from "../session";
import { BattleController } from "./battle-controller";
import type { Application } from "pixi.js";

const COMBAT_EVENT_TYPES = new Set<CombatEvent["type"]>([
  "COMBAT_STARTED",
  "INITIATIVE_ROLLED",
  "TURN_STARTED",
  "TURN_ENDED",
  "ACTION_SPENT",
  "CARD_PLAYED",
  "ACTOR_MOVED",
  "FACING_CHANGED",
  "CHECK_ROLLED",
  "DAMAGE_DEALT",
  "HP_RESTORED",
  "CONDITION_APPLIED",
  "CONDITION_VALUE_CHANGED",
  "CONDITION_REMOVED",
  "ACTION_LOCKED",
  "SHIELD_RAISED",
  "EFFECT_CREATED",
  "EFFECT_SUSTAINED",
  "EFFECT_EXPIRED",
  "OBJECT_INTERACTED",
  "TERRAIN_CHANGED",
  "CARD_DRAWN",
  "DISCARD_RESHUFFLED",
  "REACTION_OPENED",
  "REACTION_USED",
  "REACTION_PASSED",
  "ACTOR_DEFEATED",
  "COMBAT_ENDED",
]);

function combatEvents(events: readonly SessionEvent[]): readonly CombatEvent[] {
  return events.filter((event): event is CombatEvent => COMBAT_EVENT_TYPES.has(event.type as CombatEvent["type"]));
}

export class AdventureController {
  private client: SessionClient | null = null;
  private snapshot: ServerSnapshot | null = null;
  private battle: BattleController | null = null;
  private readonly ui: AdventureUi;
  private readonly loadoutUi: LoadoutUi;
  private readonly lobbyUi: SessionLobbyUi;
  private encounterBundle: Promise<void> | null = null;
  private view: "adventure" | "loadout" = "adventure";
  private continuing = false;
  /**
   * The last victory's growth, and the snapshot that published it. Built from committed
   * events only, so it can never show growth the campaign save does not hold, and kept in
   * memory only: nothing about it belongs in the save or in browser storage.
   */
  private growth: GrowthNotice | null = null;

  public constructor(
    private readonly app: Application,
    private readonly catalog: AssetCatalog,
    private readonly root: HTMLElement,
  ) {
    this.ui = new AdventureUi(PRODUCTION_CONTENT.adventure, PRODUCTION_CONTENT.pack, {
      onStart: () => this.sendIntent({ type: "begin-adventure" }),
      onContinue: () => this.sendIntent({ type: "start-encounter" }),
      onChooseReward: (rewardId, choiceIndex) => this.sendIntent({ type: "choose-reward", rewardId, choiceIndex }),
      onOpenLoadout: () => this.openLoadout(),
      onRetry: () => undefined,
    }, this.catalog);
    this.loadoutUi = new LoadoutUi(PRODUCTION_CONTENT.pack, this.catalog, {
      onSetLoadout: (memberId, loadout) => this.setMemberLoadout(memberId, loadout),
      onDone: () => this.closeLoadout(),
    });
    this.lobbyUi = new SessionLobbyUi(PRODUCTION_CONTENT.pack, this.catalog, {
      onShowLogin: () => this.lobbyUi.renderLogin(),
      onShowRegister: () => this.lobbyUi.renderRegister(),
      onShowLanding: () => this.lobbyUi.renderLanding(),
      onLogin: (username, password) => void this.signIn(username, password),
      onRegister: (username, password) => void this.signUp(username, password),
      onLogout: () => void this.signOut(),
      onCreateCampaign: (name, displayName) => void this.createCampaign(name, displayName),
      onContinueCampaign: (campaignId) => void this.continueCampaign(campaignId),
      onJoin: (sessionId, displayName) => void this.joinSession(sessionId, displayName),
      onSetParty: (actorDefinitionIds) => this.sendIntent({ type: "set-party-composition", actorDefinitionIds }),
      onSelectCharacter: (memberId) => this.sendIntent({ type: "select-character", memberId }),
      onRemoveOfflineGuest: (playerId) => this.sendIntent({ type: "remove-offline-guest", playerId }),
      onBegin: () => this.sendIntent({ type: "begin-adventure" }),
      onResume: () => this.sendIntent({ type: "resume-adventure" }),
    });
    this.root.dataset.ready = "true";
    this.root.dataset.screen = "session";
    // data-auth starts as "unknown" synchronously, so nothing has to race the /api/auth/me
    // round trip to know whether the landing it is looking at is the final one.
    this.root.dataset.auth = "unknown";
    this.lobbyUi.renderLanding();
    const stored = SessionClient.loadCredential();
    if (stored) {
      this.root.dataset.auth = "resumed";
      this.attach(stored);
    } else {
      void this.restoreAccount();
    }
  }

  private async restoreAccount(): Promise<void> {
    try {
      const account = await SessionClient.currentAccount();
      this.root.dataset.auth = account ? "authenticated" : "anonymous";
      if (account) await this.showCampaigns(account);
    } catch {
      // A server that cannot answer is treated as signed out, not as a broken page.
      this.root.dataset.auth = "anonymous";
    }
  }

  private async showCampaigns(account: AccountIdentity): Promise<void> {
    this.lobbyUi.renderCampaigns(account, await SessionClient.listCampaigns());
  }

  private async signIn(username: string, password: string): Promise<void> {
    this.lobbyUi.setStatus("로그인하는 중입니다…");
    try {
      const account = await SessionClient.login(username, password);
      this.root.dataset.auth = "authenticated";
      await this.showCampaigns(account);
    } catch (error) {
      this.lobbyUi.setStatus(error instanceof Error ? error.message : "로그인할 수 없습니다.");
    }
  }

  /** Signing up lands on the campaign list, because the server signed the new account in. */
  private async signUp(username: string, password: string): Promise<void> {
    this.lobbyUi.setStatus("계정을 만드는 중입니다…");
    try {
      const account = await SessionClient.register(username, password);
      this.root.dataset.auth = "authenticated";
      await this.showCampaigns(account);
    } catch (error) {
      this.lobbyUi.setStatus(error instanceof Error ? error.message : "계정을 만들 수 없습니다.");
    }
  }

  private async signOut(): Promise<void> {
    try {
      await SessionClient.logout();
    } finally {
      this.root.dataset.auth = "anonymous";
      this.lobbyUi.renderLanding();
    }
  }

  private async createCampaign(name: string, displayName: string): Promise<void> {
    this.lobbyUi.setStatus("Campaign을 만드는 중입니다…");
    try {
      this.attach(await SessionClient.createCampaign(name, displayName));
    } catch (error) {
      this.lobbyUi.setStatus(error instanceof Error ? error.message : "Campaign을 만들 수 없습니다.");
    }
  }

  private async continueCampaign(campaignId: string): Promise<void> {
    // Continue retires whatever live session the campaign has, so a second in-flight call
    // would tear down the session the first one just opened.
    if (this.continuing) return;
    this.continuing = true;
    this.lobbyUi.setStatus("Campaign을 이어가는 중입니다…");
    try {
      this.attach(await SessionClient.continueCampaign(campaignId));
    } catch (error) {
      this.lobbyUi.setStatus(error instanceof Error ? error.message : "Campaign을 이어갈 수 없습니다.");
      // Re-arm Continue before anything that can fail on its own. The campaign row and its
      // save are untouched by a refused Continue, so the retry has to stay reachable even
      // when the refresh below fails too — otherwise one outage costs a page reload.
      this.lobbyUi.settleContinue();
      void this.restoreAccount();
    } finally {
      this.continuing = false;
    }
  }

  private async joinSession(sessionId: string, displayName: string): Promise<void> {
    this.lobbyUi.setStatus("호스트 세션에 참가하는 중입니다…");
    try {
      this.attach(await SessionClient.join(sessionId, displayName));
    } catch (error) {
      this.lobbyUi.setStatus(error instanceof Error ? error.message : "세션에 참가할 수 없습니다.");
    }
  }

  private attach(credential: SessionCredential): void {
    this.client?.destroy();
    this.client = new SessionClient(credential, {
      onSnapshot: (snapshot) => {
        this.snapshot = snapshot;
        void this.renderSnapshot(snapshot);
      },
      onError: (error) => {
        this.root.dataset.sessionError = error.code;
        this.loadoutUi.reportError(error.message);
        this.battle?.reportError(error.message);
        if (isTerminalHandshakeFailure(error.code)) {
          this.returnToLanding(error.message);
          return;
        }
        this.lobbyUi.setStatus(error.message);
      },
      onStatus: (status) => {
        this.root.dataset.sessionStatus = status;
        if (status !== "connected") {
          this.loadoutUi.reportError(`Session ${status}…`);
          this.battle?.reportError(`Session ${status}…`);
        }
        this.lobbyUi.setStatus(status === "connected" ? "서버에 연결되었습니다." : `Session ${status}…`);
      },
    });
    this.client.connect();
  }

  private returnToLanding(message: string): void {
    this.snapshot = null;
    this.client = null;
    this.growth = null;
    this.battle?.destroy();
    this.battle = null;
    this.root.dataset.screen = "session";
    delete this.root.dataset.sessionId;
    delete this.root.dataset.sessionRevision;
    delete this.root.dataset.controlRevision;
    delete this.root.dataset.sessionHash;
    delete this.root.dataset.lifecycle;
    delete this.root.dataset.viewerMemberId;
    delete this.root.dataset.controlledActorIds;
    delete this.root.dataset.viewerRole;
    this.ui.setVisible(false);
    this.loadoutUi.setVisible(false);
    this.lobbyUi.renderLanding();
    this.lobbyUi.setStatus(message);
    // A signed-in host whose session died belongs back at their campaigns, not at the
    // guest landing; a guest stays where they are.
    void this.restoreAccount().then(() => this.lobbyUi.setStatus(message));
  }

  private viewerSeat(snapshot: ServerSnapshot): SessionSeat | undefined {
    return snapshot.state.seats.find((seat) => seat.playerId === this.client?.credential.playerId);
  }

  private controlledMemberIds(snapshot: ServerSnapshot, playerId: string): ReadonlySet<string> {
    return new Set(
      Object.entries(snapshot.control.effectiveControllerByMemberId)
        .filter(([, controllerPlayerId]) => controllerPlayerId === playerId)
        .map(([memberId]) => memberId),
    );
  }

  private trackGrowth(snapshot: ServerSnapshot): void {
    this.growth = trackGrowthSummary(this.growth, {
      sessionId: snapshot.state.sessionId,
      revision: snapshot.revision,
      inCombat: Boolean(snapshot.state.combat),
      lastCompletedEncounterId: snapshot.state.adventure?.completedEncounterIds.at(-1) ?? null,
    }, snapshot.events.filter(
      (event): event is Extract<AdventureEvent, { type: "EXPERIENCE_GAINED" | "LEVEL_UP" }> =>
        event.type === "EXPERIENCE_GAINED" || event.type === "LEVEL_UP"));
  }

  private async renderSnapshot(snapshot: ServerSnapshot): Promise<void> {
    if (this.snapshot !== snapshot) return;
    this.trackGrowth(snapshot);
    const state = snapshot.state;
    const viewer = this.viewerSeat(snapshot);
    if (!viewer) throw new Error("Authenticated player does not own a session seat.");
    this.root.dataset.sessionId = state.sessionId;
    this.root.dataset.sessionRevision = String(snapshot.revision);
    this.root.dataset.controlRevision = String(snapshot.controlRevision);
    this.root.dataset.sessionHash = snapshot.gameplayHash;
    const controlledMemberIds = this.controlledMemberIds(snapshot, viewer.playerId);
    this.root.dataset.viewerMemberId = [...controlledMemberIds][0] ?? "";
    this.root.dataset.controlledActorIds = [...controlledMemberIds].sort().join(",");
    this.root.dataset.viewerRole = state.hostPlayerId === viewer.playerId ? "host" : "guest";

    this.root.dataset.lifecycle = state.lifecycle;
    if (state.lifecycle === "lobby") {
      this.renderSessionLobby(state, viewer.playerId, snapshot.control);
      return;
    }

    // A restored campaign already carries saved Adventure and Combat state. Rendering it
    // before Resume would drop the host straight into a battle they have not resumed, and
    // would arm combat input the server is going to refuse.
    if (state.lifecycle === "resume-lobby") {
      delete this.root.dataset.adventurePhase;
      delete this.root.dataset.encounterId;
      this.renderSessionLobby(state, viewer.playerId, snapshot.control);
      return;
    }

    const adventure = state.adventure;
    if (!adventure) throw new Error("Active session is missing AdventureState.");
    this.lobbyUi.setVisible(false);
    this.updateAdventureDatasets(adventure);
    if (state.combat) {
      this.encounterBundle ??= this.catalog.loadEncounterBundle();
      await this.encounterBundle;
      if (this.snapshot !== snapshot) return;
      this.renderCombat(snapshot, viewer, state.combat);
      return;
    }

    this.battle?.destroy();
    this.battle = null;
    this.renderAdventure(adventure, viewer);
  }

  private renderSessionLobby(
    state: ServerSnapshot["state"],
    viewerPlayerId: string,
    control: ServerSnapshot["control"],
  ): void {
    this.battle?.destroy();
    this.battle = null;
    this.root.dataset.screen = "session";
    this.lobbyUi.renderLobby(state, viewerPlayerId, control);
    this.ui.setVisible(false);
    this.loadoutUi.setVisible(false);
  }

  private renderCombat(snapshot: ServerSnapshot, viewer: SessionSeat, combat: CombatState): void {
    this.root.dataset.screen = "combat";
    this.loadoutUi.setVisible(false);
    this.ui.render(snapshot.state.adventure as AdventureState, {
      isHost: snapshot.state.hostPlayerId === viewer.playerId,
      growth: this.growth?.summary ?? null,
    });
    const staticScenario = PRODUCTION_CONTENT.pack.scenarios[combat.scenarioId];
    if (!staticScenario) throw new Error(`Scenario "${combat.scenarioId}" is missing.`);
    const events = combatEvents(snapshot.events);
    if (!this.battle) {
      this.battle = new BattleController(this.app, this.catalog, {
        definition: {
          content: PRODUCTION_CONTENT.pack.combatContent,
          contentIdentity: PRODUCTION_CONTENT.contentIdentity,
          scenario: {
            ...staticScenario,
            actors: Object.values(combat.actors),
            map: combat.map,
          },
        },
        state: combat,
        history: events,
        controlledActorIds: this.controlledMemberIds(snapshot, viewer.playerId),
        onIntent: (intent) => this.sendIntent(intent),
      });
    } else {
      this.battle.update(
        combat,
        events,
        snapshot.cause?.kind === "resync",
        this.controlledMemberIds(snapshot, viewer.playerId),
      );
    }
  }

  private updateAdventureDatasets(state: AdventureState): void {
    this.root.dataset.adventurePhase = state.phase;
    this.root.dataset.encounterId = state.currentEncounterId ?? "";
    this.root.dataset.completedEncounters = String(state.completedEncounterIds.length);
    this.root.dataset.outcome = state.phase === "failed" ? "defeat" : state.phase === "complete" ? "victory" : "ongoing";
  }

  private renderAdventure(state: AdventureState, viewer: SessionSeat): void {
    const session = this.snapshot?.state;
    if (!session) return;
    const isHost = session.hostPlayerId === viewer.playerId;
    if (this.view === "loadout" && (state.phase === "ready" || state.phase === "between-encounters")) {
      this.root.dataset.screen = "loadout";
      this.ui.setVisible(false);
      const snapshot = this.snapshot;
      this.loadoutUi.render(
        state,
        snapshot ? this.controlledMemberIds(snapshot, viewer.playerId) : new Set(),
      );
    } else {
      this.view = "adventure";
      this.root.dataset.screen = "adventure";
      this.loadoutUi.setVisible(false);
      this.ui.render(state, { isHost, growth: this.growth?.summary ?? null });
      this.ui.setVisible(true);
    }
  }

  private openLoadout(): void {
    const snapshot = this.snapshot;
    const adventure = snapshot?.state.adventure;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!adventure || !viewer || (adventure.phase !== "ready" && adventure.phase !== "between-encounters")) return;
    this.view = "loadout";
    this.renderAdventure(adventure, viewer);
  }

  private closeLoadout(): void {
    const snapshot = this.snapshot;
    const adventure = snapshot?.state.adventure;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!adventure || !viewer) return;
    this.view = "adventure";
    this.renderAdventure(adventure, viewer);
  }

  private setMemberLoadout(memberId: string, loadout: PartyMemberLoadout): boolean {
    const snapshot = this.snapshot;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!snapshot || !viewer || !this.controlledMemberIds(snapshot, viewer.playerId).has(memberId)) return false;
    return this.sendIntent({ type: "set-loadout", memberId, loadout });
  }

  private sendIntent(intent: SessionIntent): boolean {
    return this.client?.sendIntent(intent) ?? false;
  }

  public destroy(): void {
    this.loadoutUi.destroy();
    this.battle?.destroy();
    this.client?.destroy();
  }
}
