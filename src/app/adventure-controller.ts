import type { AdventureState } from "../adventure";
import { isTerminalHandshakeFailure, SessionClient, type SessionCredential } from "../client";
import { PRODUCTION_CONTENT } from "../content/production-content";
import { AdventureUi } from "../dom/adventure-ui";
import { LoadoutUi } from "../dom/loadout-ui";
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
  "CONDITION_APPLIED",
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
    });
    this.loadoutUi = new LoadoutUi(PRODUCTION_CONTENT.pack, this.catalog, {
      onSetLoadout: (memberId, loadout) => this.setMemberLoadout(memberId, loadout),
      onDone: () => this.closeLoadout(),
    });
    this.lobbyUi = new SessionLobbyUi(PRODUCTION_CONTENT.pack, this.catalog, {
      onCreate: (displayName) => void this.createSession(displayName),
      onJoin: (sessionId, displayName) => void this.joinSession(sessionId, displayName),
      onSetParty: (actorDefinitionIds) => this.sendIntent({ type: "set-party-composition", actorDefinitionIds }),
      onSelectCharacter: (memberId) => this.sendIntent({ type: "select-character", memberId }),
      onRemoveOfflineGuest: (playerId) => this.sendIntent({ type: "remove-offline-guest", playerId }),
      onBegin: () => this.sendIntent({ type: "begin-adventure" }),
    });
    this.root.dataset.ready = "true";
    this.root.dataset.screen = "session";
    this.lobbyUi.renderLanding();
    const stored = SessionClient.loadCredential();
    if (stored) this.attach(stored);
  }

  private async createSession(displayName: string): Promise<void> {
    this.lobbyUi.setStatus("세션을 만드는 중입니다…");
    try {
      this.attach(await SessionClient.create(displayName));
    } catch (error) {
      this.lobbyUi.setStatus(error instanceof Error ? error.message : "세션을 만들 수 없습니다.");
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
        if (isTerminalHandshakeFailure(error.code)) {
          this.returnToLanding(error.message);
          return;
        }
        this.lobbyUi.setStatus(error.message);
      },
      onStatus: (status) => {
        this.root.dataset.sessionStatus = status;
        this.lobbyUi.setStatus(status === "connected" ? "서버에 연결되었습니다." : `Session ${status}…`);
      },
    });
    this.client.connect();
  }

  private returnToLanding(message: string): void {
    this.snapshot = null;
    this.client = null;
    this.battle?.destroy();
    this.battle = null;
    this.root.dataset.screen = "session";
    delete this.root.dataset.sessionId;
    delete this.root.dataset.sessionRevision;
    delete this.root.dataset.controlRevision;
    delete this.root.dataset.sessionHash;
    delete this.root.dataset.viewerMemberId;
    delete this.root.dataset.controlledActorIds;
    delete this.root.dataset.viewerRole;
    this.ui.setVisible(false);
    this.loadoutUi.setVisible(false);
    this.lobbyUi.renderLanding();
    this.lobbyUi.setStatus(message);
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

  private async renderSnapshot(snapshot: ServerSnapshot): Promise<void> {
    if (this.snapshot !== snapshot) return;
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

    if (state.lifecycle === "lobby") {
      this.battle?.destroy();
      this.battle = null;
      this.root.dataset.screen = "session";
      this.lobbyUi.renderLobby(state, viewer.playerId, snapshot.control);
      this.ui.setVisible(false);
      this.loadoutUi.setVisible(false);
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

  private renderCombat(snapshot: ServerSnapshot, viewer: SessionSeat, combat: CombatState): void {
    this.root.dataset.screen = "combat";
    this.loadoutUi.setVisible(false);
    this.ui.render(snapshot.state.adventure as AdventureState, {
      isHost: snapshot.state.hostPlayerId === viewer.playerId,
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
      this.ui.render(state, { isHost });
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

  private setMemberLoadout(memberId: string, loadout: PartyMemberLoadout): void {
    const snapshot = this.snapshot;
    const viewer = snapshot ? this.viewerSeat(snapshot) : undefined;
    if (!snapshot || !viewer || !this.controlledMemberIds(snapshot, viewer.playerId).has(memberId)) return;
    this.sendIntent({ type: "set-loadout", memberId, loadout });
  }

  private sendIntent(intent: SessionIntent): boolean {
    return this.client?.sendIntent(intent) ?? false;
  }

  public destroy(): void {
    this.battle?.destroy();
    this.client?.destroy();
  }
}
