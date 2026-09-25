import { SceneDialogueUi } from "../dom/scene-dialogue-ui";
import { FIRST_BATTLE_SCENE, SCENE_CATALOG, WELCOME_SCENE } from "../scene/catalog";
import { CoopPreparationUi } from "../dom/coop-preparation-ui";
import { waitingGuests } from "../session";
import type { CharacterSheetDestination } from "../dom/character-workspace";
import type { CharacterAdvancementChoice } from "../character";
import type { CreateCharacterInput } from "../character/member";
import type { AdventureEvent, AdventureState } from "../adventure";
import { ApiError, isTerminalHandshakeFailure, SessionClient, type AccountIdentity, type SessionCredential } from "../client";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { AdventureUi } from "../dom/adventure-ui";
import { CharacterDetailUi } from "../dom/character-detail-ui";
import { trackGrowthSummary, type GrowthNotice } from "../dom/progression-view";
import { SessionLobbyUi } from "../dom/session-lobby-ui";
import type { CombatEvent, CombatState } from "../game";
import type { PartyMemberLoadout } from "../loadout";
import type { AssetCatalog } from "../presentation";
import type { ServerSnapshot } from "../protocol";
import type { SessionEvent, SessionIntent, SessionSeat } from "../session";
import { BattleController } from "./battle-controller";
import type { Application } from "pixi.js";

const COMBAT_EVENT_TYPES: Record<CombatEvent["type"], true> = {
  "COMBAT_STARTED": true,
  "INITIATIVE_ROLLED": true,
  "TURN_STARTED": true,
  "TURN_ENDED": true,
  "ACTION_SPENT": true,
  "CARD_PLAYED": true,
  "ACTOR_MOVED": true,
  "FACING_CHANGED": true,
  "CHECK_ROLLED": true,
  "DAMAGE_DEALT": true,
  "HP_RESTORED": true,
  "CONDITION_APPLIED": true,
  "CONDITION_VALUE_CHANGED": true,
  "CONDITION_REMOVED": true,
  "ACTION_LOCKED": true,
  "SHIELD_RAISED": true,
  "EFFECT_CREATED": true,
  "EFFECT_SUSTAINED": true,
  "EFFECT_EXPIRED": true,
  "OBJECT_INTERACTED": true,
  "TERRAIN_CHANGED": true,
  "CARD_DRAWN": true,
  "DISCARD_RESHUFFLED": true,
  "REACTION_OPENED": true,
  "REACTION_USED": true,
  "REACTION_PASSED": true,
  "ACTOR_DEFEATED": true,
  "COMBAT_ENDED": true,
  "KNOWLEDGE_RECALLED": true,
};

function combatEvents(events: readonly SessionEvent[]): readonly CombatEvent[] {
  return events.filter((event): event is CombatEvent => Object.hasOwn(COMBAT_EVENT_TYPES, event.type));
}

export class AdventureController {
  private client: SessionClient | null = null;
  private snapshot: ServerSnapshot | null = null;
  private battle: BattleController | null = null;
  private readonly ui: AdventureUi;
  private readonly characterDetail: CharacterDetailUi;
  private readonly lobbyUi: SessionLobbyUi;
  private encounterBundle: Promise<void> | null = null;
  private continuing = false;
  private account: AccountIdentity | null = null;
  private entryView: "landing" | "login" | "register" | "join" | "new-adventure" | "welcome" | "campaigns" = "landing";
  private authState: "checking" | "ready" | "failed" = "checking";
  private authDestination: "landing" | "new-adventure" | "campaigns" = "landing";
  private entryBusy = false;
  private entryVersion = 0;
  private pendingCreation: CreateCharacterInput | null = null;
  private creationSent = false;
  private readonly sceneUi = new SceneDialogueUi();
  private welcomePending = false;
  private briefingKey: string | null = null;
  private completedBriefingKey: string | null = null;
  private departurePending = false;

  /**
   * The last victory's growth, and the snapshot that published it. Built from committed
   * events only, so it can never show growth the campaign save does not hold, and kept in
   * memory only: nothing about it belongs in the save or in browser storage.
   */
  private growth: GrowthNotice | null = null;

  private readonly coopUi: CoopPreparationUi;

  public constructor(
    private readonly app: Application,
    private readonly catalog: AssetCatalog,
    private readonly root: HTMLElement,
  ) {
    this.ui = new AdventureUi(PRODUCTION_CONTENT.adventure, PRODUCTION_CONTENT.pack, {
      onAdvanceCharacter: (memberId, choice) => this.advanceCharacter(memberId, choice),
      onStart: () => this.requestDeparture(),
      onContinue: () => this.requestDeparture(),
      onChooseReward: (rewardId, choiceIndex, settled) => this.client?.sendIntent({ type: "choose-reward", rewardId, choiceIndex }, settled) ?? false,
      onPreviewCompanion: (definition, member) => this.characterDetail.openPrepared(definition, member),
      onOpenCharacter: destination => this.openCharacter(destination),
      onExit: () => {
        if (this.client) SessionClient.clearCredential(this.client.credential);
        this.client?.destroy();
        this.ui.clear();
        this.returnToLanding("");
      },
    }, this.catalog);
    this.characterDetail = new CharacterDetailUi(PRODUCTION_CONTENT.pack, this.catalog, {
      onSetLoadout: (memberId, loadout, settled) => this.setMemberLoadout(memberId, loadout, settled),
    });
    this.coopUi = new CoopPreparationUi(PRODUCTION_CONTENT.pack, this.catalog,
      (intent, settled) => this.client?.sendIntent(intent, settled) ?? false,
      (definition, member) => this.characterDetail.openPrepared(definition, member));
    this.lobbyUi = new SessionLobbyUi(PRODUCTION_CONTENT.pack, this.catalog, {
      coopPanel: (state, viewer, control) => this.coopUi.render(state, viewer, control),
      onNewAdventure: () => this.openNewAdventure(),
      onShowJoin: () => this.navigateEntry("join"),
      onShowCampaigns: () => void this.showCampaigns(),
      onRetryAuth: () => void this.restoreAccount(),
      onShowLogin: () => this.navigateEntry("login"),
      onShowRegister: () => this.navigateEntry("register"),
      onShowLanding: () => {
        if (this.entryBusy) return;
        if (this.client && this.snapshot?.state.lifecycle === "lobby" && !this.snapshot.state.partySlots.length) {
          SessionClient.clearCredential(this.client.credential);
          this.client.destroy(); this.client = null; this.snapshot = null;
        }
        this.authDestination = "landing"; this.navigateEntry("landing");
      },
      onLogin: (username, password) => void this.signIn(username, password),
      onRegister: (username, password) => void this.signUp(username, password),
      onLogout: () => void this.signOut(),
      onCreateCampaign: input => void this.createCampaign(input),
      onPreviewCharacter: definition => this.characterDetail.openPrepared(definition),
      onDeleteCampaign: (campaignId) => void this.deleteCampaign(campaignId),
      onContinueCampaign: (campaignId) => void this.continueCampaign(campaignId),
      onJoin: (sessionId, displayName) => void this.joinSession(sessionId, displayName),
      onSetParty: (actorDefinitionIds) => this.sendIntent({ type: "set-party-composition", actorDefinitionIds }),
      onReleaseCharacter: () => this.sendIntent({ type: "release-character" }),
      onSelectCharacter: (memberId) => this.sendIntent({ type: "select-character", memberId }),
      onRemoveOfflineGuest: (playerId) => this.sendIntent({ type: "remove-offline-guest", playerId }),
      onBegin: () => this.sendIntent({ type: "begin-adventure" }),
      onResume: () => this.sendIntent({ type: "resume-adventure" }),
    });
    this.root.dataset.screen = "session";
    this.lobbyUi.renderLanding(null, "checking");
    const stored = SessionClient.loadCredential();
    if (stored) {
      this.beginEntry("모험에 다시 연결하는 중입니다…");
      this.attach(stored);
    } else {
      void this.restoreAccount();
    }
  }

  private navigateEntry(view: typeof this.entryView): void {
    if (this.entryBusy) return;
    this.entryView = view;
    this.entryVersion++;
    switch (view) {
      case "landing": this.lobbyUi.renderLanding(this.account, this.authState); break;
      case "login": this.lobbyUi.renderLogin(); break;
      case "register": this.lobbyUi.renderRegister(); break;
      case "join": this.lobbyUi.renderJoin(); break;
      case "new-adventure":
        if (this.welcomePending) this.navigateEntry("welcome");
        else this.lobbyUi.renderNewAdventure();
        break;
      case "welcome":
        this.lobbyUi.setVisible(false);
        this.sceneUi.open(WELCOME_SCENE, SCENE_CATALOG, {
          title: "카드길드에 오신 것을 환영합니다", finishLabel: "캐릭터 만들기",
          onFinish: result => {
            this.welcomePending = false;
            if (result === "cancelled") {
              this.authDestination = "landing";
              this.navigateEntry("landing");
              document.getElementById("entry-new-adventure")?.focus();
            } else this.navigateEntry("new-adventure");
          },
        });
        break;
      case "campaigns": this.lobbyUi.renderCampaignLoading(); break;
    }
  }

  private openNewAdventure(): void {
    if (this.entryBusy || this.authState !== "ready") return;
    this.authDestination = "new-adventure";
    this.welcomePending = true;
    this.navigateEntry(this.account ? "new-adventure" : "login");
  }

  private async restoreAccount(): Promise<void> {
    this.authState = "checking";
    if (this.entryView === "landing") this.lobbyUi.renderLanding(null, "checking");
    try {
      this.account = await SessionClient.currentAccount();
      this.authState = "ready";
    } catch {
      this.authState = "failed";
    }
    if (this.entryView === "landing" && !this.client && !this.entryBusy) {
      this.lobbyUi.renderLanding(this.account, this.authState);
    }
  }

  private beginEntry(message: string): boolean {
    if (this.entryBusy) return false;
    this.entryBusy = true;
    this.lobbyUi.setBusy(true);
    this.lobbyUi.setStatus(message);
    return true;
  }

  private finishEntry(): void {
    this.entryBusy = false;
    this.lobbyUi.setBusy(false);
  }

  private entryError(error: unknown, fallback: string): string {
    if (!(error instanceof ApiError)) return `${fallback} 연결을 확인하고 다시 시도하세요.`;
    const messages: Record<string, string> = {
      UNAUTHENTICATED: "계정 이름 또는 비밀번호를 확인하세요.",
      USERNAME_TAKEN: "이미 사용 중인 계정 이름입니다. 다른 이름을 입력하세요.",
      INVALID_USERNAME: "계정 이름은 영문·숫자로 시작하는 3~32자이며 영문, 숫자, 점, 하이픈, 밑줄만 사용할 수 있습니다.",
      INVALID_PASSWORD: "비밀번호는 8자 이상 입력하세요.",
      SESSION_NOT_FOUND: "초대 코드를 찾을 수 없습니다. 친구에게 현재 초대 코드를 확인하세요.",
      CAMPAIGN_NOT_FOUND: "모험을 찾을 수 없습니다. 목록을 새로고침하세요.",
      SAVE_NOT_FOUND: "아직 시작하지 않은 모험입니다. 모험을 시작하면 진행 상황이 저장됩니다.",
      SAVE_CORRUPT: "저장 데이터를 읽을 수 없습니다. 원본은 보존되어 있습니다.",
      SAVE_SCHEMA_UNSUPPORTED: "현재 버전에서 지원하지 않는 저장 형식입니다.",
      SAVE_CONTENT_MISMATCH: "저장된 모험과 현재 콘텐츠가 일치하지 않습니다.",
      PERSISTENCE_FAILED: "저장된 모험을 여는 데 실패했습니다. 다시 시도하세요.",
      SESSION_FULL: "참가 인원이 가득 찼습니다. 친구에게 빈자리가 있는지 확인하세요.",
      ROSTER_LOCKED: "지금은 참가할 수 없습니다. 친구에게 참가 가능한 상태인지 확인하세요.",
    };
    return messages[error.code ?? ""] ?? `${fallback} 다시 시도하세요.`;
  }

  private showEntryError(error: unknown, fallback: string): void {
    const fieldByCode: Record<string, string> = {
      INVALID_USERNAME: "register-username", USERNAME_TAKEN: "register-username",
      INVALID_PASSWORD: "register-password", SESSION_NOT_FOUND: "join-session-id",
    };
    this.lobbyUi.reportEntryError(this.entryError(error, fallback),
      error instanceof ApiError ? fieldByCode[error.code ?? ""] : undefined);
  }

  private expired(error: unknown, destination: "new-adventure" | "campaigns"): boolean {
    if (!(error instanceof ApiError) || error.code !== "UNAUTHENTICATED") return false;
    this.account = null;
    this.authDestination = destination;
    this.navigateEntry("login");
    this.lobbyUi.setStatus("로그인이 만료되었습니다. 다시 로그인하면 계속할 수 있습니다.");
    return true;
  }

  private async showCampaigns(): Promise<void> {
    if (this.entryBusy) return;
    if (!this.account) {
      this.authDestination = "campaigns";
      this.navigateEntry("login");
      return;
    }
    this.navigateEntry("campaigns");
    this.beginEntry("모험을 불러오는 중입니다…");
    try {
      const campaigns = await SessionClient.listCampaigns();
      this.finishEntry();
      this.lobbyUi.renderCampaigns(this.account, campaigns);
    } catch (error) {
      this.finishEntry();
      if (!this.expired(error, "campaigns")) this.showEntryError(error, "모험을 불러오지 못했습니다.");
    }
  }

  private async signIn(username: string, password: string): Promise<void> {
    await this.authenticate(() => SessionClient.login(username, password), "로그인 중…");
  }

  private async signUp(username: string, password: string): Promise<void> {
    await this.authenticate(() => SessionClient.register(username, password), "계정 만드는 중…");
  }

  private async authenticate(request: () => Promise<AccountIdentity>, message: string): Promise<void> {
    if (!this.beginEntry(message)) return;
    try {
      this.account = await request();
      this.authState = "ready";
      this.finishEntry();
      if (this.authDestination === "campaigns") await this.showCampaigns();
      else this.navigateEntry(this.authDestination);
    } catch (error) {
      this.finishEntry();
      this.showEntryError(error, "로그인 또는 계정 만들기를 완료하지 못했습니다.");
    }
  }

  private async signOut(): Promise<void> {
    if (!this.beginEntry("로그아웃 중…")) return;
    try {
      await SessionClient.logout();
      this.finishEntry();
      this.account = null;
      this.authDestination = "landing";
      this.authState = "ready";
      this.lobbyUi.clearDrafts();
      this.navigateEntry("landing");
    } catch (error) {
      this.finishEntry();
      this.showEntryError(error, "로그아웃하지 못했습니다.");
    }
  }

  private async createCampaign(input: CreateCharacterInput): Promise<void> {
    if (!this.beginEntry("캐릭터를 생성하고 저장하는 중…")) return;
    this.pendingCreation = input;
    this.creationSent = false;
    try {
      if (this.client && this.snapshot?.state.lifecycle === "lobby" && !this.snapshot.state.partySlots.length) {
        this.sendCreation();
      } else {
        this.attach(await SessionClient.createCampaign(`${input.name}의 모험`, input.name));
      }
    } catch (error) {
      this.pendingCreation = null;
      this.finishEntry();
      if (!this.expired(error, "new-adventure")) this.showEntryError(error, "모험을 만들지 못했습니다.");
    }
  }

  private sendCreation(): void {
    if (!this.pendingCreation || this.creationSent) return;
    this.creationSent = true;
    const sent = this.client?.sendIntent({ type: "create-character", ...this.pendingCreation }, accepted => {
      this.pendingCreation = null;
      this.creationSent = false;
      this.finishEntry();
      if (accepted && this.snapshot?.state.adventure) void this.renderSnapshot(this.snapshot);
      else this.lobbyUi.setStatus("캐릭터를 저장하지 못했습니다. 선택을 유지했습니다. 다시 시도하세요.", "error");
    });
    if (!sent) {
      this.pendingCreation = null;
      this.creationSent = false;
      this.finishEntry();
      this.lobbyUi.setStatus("서버 연결을 확인한 뒤 다시 생성하세요. 선택은 유지됩니다.", "error");
    }
  }

  private async deleteCampaign(campaignId: string): Promise<void> {
    if (!this.beginEntry("모험을 삭제하는 중…")) return;
    try {
      await SessionClient.deleteCampaign(campaignId);
      this.finishEntry();
      this.lobbyUi.removeCampaign(campaignId);
      this.lobbyUi.setStatus("모험을 삭제했습니다.");
    } catch (error) {
      this.finishEntry();
      if (!this.expired(error, "campaigns")) {
        this.lobbyUi.reportEntryError(error instanceof ApiError && error.code === "PERSISTENCE_FAILED"
          ? "모험을 삭제하지 못했습니다. 다시 시도하세요."
          : this.entryError(error, "모험을 삭제하지 못했습니다."));
      }
    }
  }

  private async continueCampaign(campaignId: string): Promise<void> {
    if (this.continuing || !this.beginEntry("모험을 이어가는 중…")) return;
    this.continuing = true;
    try {
      this.attach(await SessionClient.continueCampaign(campaignId));
    } catch (error) {
      this.finishEntry();
      this.lobbyUi.settleContinue();
      if (!this.expired(error, "campaigns")) this.showEntryError(error, "모험을 이어가지 못했습니다.");
    } finally {
      this.continuing = false;
    }
  }

  private async joinSession(sessionId: string, displayName: string): Promise<void> {
    if (!this.beginEntry("참가 중…")) return;
    try {
      this.attach(await SessionClient.join(sessionId, displayName));
    } catch (error) {
      this.finishEntry();
      this.showEntryError(error, "참가하지 못했습니다.");
    }
  }

  private attach(credential: SessionCredential): void {
    this.client?.destroy();
    this.ui.clear();
    this.client = new SessionClient(credential, {
      onSnapshot: (snapshot) => {
        this.snapshot = snapshot;
        if (this.pendingCreation) {
          this.sendCreation();
          return; // SessionClient settles only after both the ACK and its committed snapshot.
        }
        this.finishEntry();
        void this.renderSnapshot(snapshot);
      },
      onError: (error) => {
        this.characterDetail.reportError(error.message);
        this.ui.reportError(error.message);
        this.battle?.reportError(error.message);
        this.coopUi.reportError(error.message);
        if (isTerminalHandshakeFailure(error.code)) {
          const message = error.code === "CONTENT_MISMATCH" || error.code === "PROTOCOL_MISMATCH"
            ? "게임 버전이 맞지 않습니다. 페이지를 새로고침한 뒤 다시 참가하세요."
            : error.code === "COOP_ENDED" ? "Co-op 참가가 종료되었습니다. 다시 참가하려면 Host에게 초대 코드를 받으세요."
            : "이전 모험에 연결할 수 없습니다. 친구에게 새 초대 코드를 받거나 이어하기를 선택하세요.";
          this.returnToLanding(message);
          return;
        }
        this.lobbyUi.setStatus(error.message);
      },
      onStatus: (status) => {
        this.root.dataset.sessionStatus = status;
        this.characterDetail.setConnectionStatus(status);
        this.battle?.setConnectionStatus(status);
        if (status !== "connected") {
          this.ui.reportError(`Session ${status}…`);
          this.battle?.reportError(`Session ${status}…`);
        }
        this.lobbyUi.setStatus(status === "connected" ? "서버에 연결되었습니다." : "서버에 연결하는 중입니다…");
      },
    });
    this.client.connect();
  }

  private returnToLanding(message: string): void {
    this.sceneUi.close();
    this.briefingKey = null;
    this.completedBriefingKey = null;
    this.departurePending = false;
    this.pendingCreation = null;
    this.creationSent = false;
    this.snapshot = null;
    this.client = null;
    this.growth = null;
    this.battle?.destroy();
    this.battle = null;
    this.root.dataset.screen = "session";
    this.ui.setVisible(false);
    this.characterDetail.close();
    this.finishEntry();
    this.navigateEntry("landing");
    this.lobbyUi.setStatus(message, "error");
    // Restore account choices without replacing a screen the player has since opened.
    const version = this.entryVersion;
    void this.restoreAccount().then(() => {
      if (version === this.entryVersion) this.lobbyUi.setStatus(message, "error");
    });
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
    if (this.briefingKey && this.briefingKey !== this.firstBattleKey()) {
      this.sceneUi.close();
      this.briefingKey = null;
    }
    this.trackGrowth(snapshot);
    const state = snapshot.state;
    const viewer = this.viewerSeat(snapshot);
    if (!viewer) throw new Error("Authenticated player does not own a session seat.");

    if (state.lifecycle === "lobby") {
      if (state.hostPlayerId === viewer.playerId && state.partySlots.length === 0) {
        this.entryView = "new-adventure";
        this.lobbyUi.renderNewAdventure();
        this.ui.setVisible(false);
        return;
      }
      this.renderSessionLobby(state, viewer.playerId, snapshot.control);
      return;
    }

    // A restored campaign already carries saved Adventure and Combat state. Rendering it
    // before Resume would drop the host straight into a battle they have not resumed, and
    // would arm combat input the server is going to refuse.
    if (state.lifecycle === "resume-lobby") {
      this.renderSessionLobby(state, viewer.playerId, snapshot.control);
      return;
    }

    const adventure = state.adventure;
    if (!adventure) throw new Error("Active session is missing AdventureState.");
    this.lobbyUi.setVisible(false);
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
  }

  private renderCombat(snapshot: ServerSnapshot, viewer: SessionSeat, combat: CombatState): void {
    this.root.dataset.screen = "combat";
    this.characterDetail.close();
    this.ui.render(snapshot.state.adventure as AdventureState, {
      isHost: snapshot.state.hostPlayerId === viewer.playerId,
      growth: this.growth?.summary ?? null,
    });
    const staticScenario = PRODUCTION_CONTENT.pack.scenarios[combat.scenarioId];
    if (!staticScenario) throw new Error(`Scenario "${combat.scenarioId}" is missing.`);
    const events = combatEvents(snapshot.events);
    const session = { connection: this.root.dataset.sessionStatus ?? "connected",
      members: Object.values(snapshot.state.adventure?.party.members ?? {}),
      controllerNames: Object.fromEntries(Object.entries(snapshot.control.effectiveControllerByMemberId).map(([memberId, playerId]) => [memberId,
        snapshot.state.seats.find(seat => seat.playerId === playerId)?.displayName ?? "호스트"])),
    };
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
        trackRequests: true, session,
        onIntent: (intent, settled) => this.client?.sendIntent(intent, settled) ?? false,
      });
    } else {
      this.battle.setSessionPresentation(session);
      this.battle.update(
        combat,
        events,
        snapshot.cause?.kind === "resync",
        this.controlledMemberIds(snapshot, viewer.playerId),
      );
    }
  }

  private renderAdventure(state: AdventureState, viewer: SessionSeat): void {
    const session = this.snapshot?.state;
    if (!session) return;
    const isHost = session.hostPlayerId === viewer.playerId;
    this.root.dataset.screen = "adventure";
    const editableMemberIds = this.snapshot ? this.controlledMemberIds(this.snapshot, viewer.playerId) : new Set<string>();
    const waiting = waitingGuests(session, this.snapshot!.control);
    this.ui.render(state, { isHost,
      coopPanel: this.coopUi.render(session, viewer.playerId, this.snapshot!.control),
      departureBlockedReason: waiting.length ? `${waiting.map(seat => seat.displayName).join(", ")} 동료 선택 대기 중` : undefined,
      growth: this.growth?.summary ?? null,
      editableMemberIds,
      controllerNames: Object.fromEntries(Object.entries(this.snapshot?.control.effectiveControllerByMemberId ?? {}).map(([memberId, playerId]) => [memberId,
        this.snapshot?.state.seats.find(seat => seat.playerId === playerId)?.displayName ?? "호스트"])),
    });
    this.ui.setVisible(true);
    this.characterDetail.updateAdventure(state, editableMemberIds);
  }

  private openCharacter(destination?: CharacterSheetDestination): void {
    const snapshot = this.snapshot;
    const adventure = snapshot?.state.adventure;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!adventure || !viewer || !snapshot || snapshot.state.combat) return;
    this.characterDetail.openAdventure(adventure, this.controlledMemberIds(snapshot, viewer.playerId), destination);
  }

  private advanceCharacter(memberId: string, choice: CharacterAdvancementChoice): boolean {
    const snapshot = this.snapshot;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!snapshot || !viewer || !this.controlledMemberIds(snapshot, viewer.playerId).has(memberId)) return false;
    return this.sendIntent({ type: "advance-character", memberId, choice });
  }

  private setMemberLoadout(memberId: string, loadout: PartyMemberLoadout, settled: (accepted: boolean) => void): boolean {
    const snapshot = this.snapshot;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!snapshot || !viewer || !this.controlledMemberIds(snapshot, viewer.playerId).has(memberId)) return false;
    return this.client?.sendIntent({ type: "set-loadout", memberId, loadout }, settled) ?? false;
  }

  private firstBattleKey(): string | null {
    const state = this.snapshot?.state;
    const adventure = state?.adventure;
    if (!state || state.lifecycle !== "active" || state.combat ||
        state.hostPlayerId !== this.client?.credential.playerId ||
        adventure?.phase !== "between-encounters" || adventure.completedEncounterIds.length ||
        !adventure.currentEncounterId ||
        PRODUCTION_CONTENT.pack.scenarios[adventure.currentEncounterId]?.partyHpFloor !== 1) return null;
    return `${state.sessionId}:${adventure.currentEncounterId}`;
  }

  private requestDeparture(): void {
    if (this.departurePending || this.briefingKey) return;
    const key = this.firstBattleKey();
    if (key && key !== this.completedBriefingKey) {
      this.briefingKey = key;
      this.sceneUi.open(FIRST_BATTLE_SCENE, SCENE_CATALOG, {
        title: "미네르바의 첫 전투 안내", finishLabel: "연습 전투 시작",
        onFinish: result => {
          if (this.briefingKey !== key || this.firstBattleKey() !== key) return;
          this.briefingKey = null;
          if (result === "cancelled") { this.ui.focusDeparture(); return; }
          this.completedBriefingKey = key;
          this.requestDeparture();
        },
      });
      return;
    }
    const client = this.client;
    if (!client) return;
    this.departurePending = true;
    const sent = client.sendIntent({ type: this.snapshot?.state.lifecycle === "active" ? "start-encounter" : "begin-adventure" }, () => {
      if (this.client === client) this.departurePending = false;
    });
    if (!sent) this.departurePending = false;
  }

  private sendIntent(intent: SessionIntent): boolean {
    return this.client?.sendIntent(intent) ?? false;
  }

  public destroy(): void {
    this.sceneUi.close();
    this.characterDetail.destroy();
    this.battle?.destroy();
    this.client?.destroy();
  }
}
