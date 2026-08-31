import {
  buildAdventureEncounter,
  createAdventureSession,
  dispatchAdventureCommand,
  type AdventureRuntimeContext,
  type AdventureState,
  type PartyState,
} from "../adventure";
import { M3_ADVENTURE, M3_COMPILED_PACK } from "../content";
import { AdventureUi } from "../dom/adventure-ui";
import { LoadoutUi } from "../dom/loadout-ui";
import type { PartyMemberLoadout } from "../loadout";
import type { AssetCatalog } from "../presentation";
import { BattleController } from "./battle-controller";
import type { Application } from "pixi.js";

const ADVENTURE_SEED = 20260830;
const ADVENTURE_CONTEXT: AdventureRuntimeContext = {
  definition: M3_ADVENTURE,
  actorDefinitions: M3_COMPILED_PACK.actorDefinitions,
  combatContent: M3_COMPILED_PACK.combatContent,
};

function defaultParty(): PartyState {
  const aerin = M3_COMPILED_PACK.actorDefinitions["hero.aerin"];
  if (!aerin) throw new Error("Aerin actor definition is missing.");
  return {
    members: {
      "party.hero-1": {
        id: "party.hero-1",
        actorDefinitionId: aerin.id,
        loadout: {
          equipment: { ...aerin.starterLoadout.equipment },
          preparedCards: [...aerin.starterLoadout.preparedCards],
        },
      },
    },
  };
}

export class AdventureController {
  private state: AdventureState = createAdventureSession(ADVENTURE_CONTEXT, defaultParty(), ADVENTURE_SEED);
  private battle: BattleController | null = null;
  private readonly ui: AdventureUi;
  private readonly loadoutUi: LoadoutUi;
  private view: "adventure" | "loadout" = "adventure";

  public constructor(
    private readonly app: Application,
    private readonly catalog: AssetCatalog,
    private readonly root: HTMLElement,
  ) {
    this.ui = new AdventureUi(M3_ADVENTURE, M3_COMPILED_PACK, {
      onStart: () => void this.startAdventure(),
      onContinue: () => this.continueAdventure(),
      onChooseReward: (rewardId, choiceIndex) => this.chooseReward(rewardId, choiceIndex),
      onOpenLoadout: () => this.openLoadout(),
      onRetry: () => this.retry(),
    });
    this.loadoutUi = new LoadoutUi(M3_COMPILED_PACK, this.catalog, {
      onSetLoadout: (memberId, loadout) => this.setMemberLoadout(memberId, loadout),
      onDone: () => this.closeLoadout(),
    });
    this.renderAdventure();
  }

  private async startAdventure(): Promise<void> {
    await this.catalog.loadEncounterBundle();
    const started = dispatchAdventureCommand(this.state, { type: "start-adventure" }, ADVENTURE_CONTEXT);
    if (!started.accepted) return;
    this.state = started.state;
    this.continueAdventure();
  }

  private continueAdventure(): void {
    const result = dispatchAdventureCommand(this.state, { type: "continue-adventure" }, ADVENTURE_CONTEXT);
    if (!result.accepted) return;
    this.state = result.state;
    this.beginCombat();
  }

  private beginCombat(): void {
    const encounter = buildAdventureEncounter(M3_COMPILED_PACK, this.state);
    this.root.dataset.screen = "combat";
    this.root.dataset.adventurePhase = this.state.phase;
    this.root.dataset.encounterId = this.state.currentEncounterId ?? "";
    this.loadoutUi.setVisible(false);
    this.ui.render(this.state);
    this.battle = new BattleController(this.app, this.catalog, {
      definition: encounter.definition,
      seed: encounter.seed,
      onComplete: (combatState, finalCombatHash) => {
        if (!combatState.outcome || !this.state.currentEncounterId) return;
        const accepted = dispatchAdventureCommand(
          this.state,
          {
            type: "accept-combat-result",
            result: {
              encounterId: this.state.currentEncounterId,
              outcome: combatState.outcome,
              combatSeed: combatState.seed,
              finalCombatHash,
            },
          },
          ADVENTURE_CONTEXT,
        );
        if (!accepted.accepted) return;
        this.battle?.destroy();
        this.battle = null;
        this.state = accepted.state;
        this.renderAdventure();
      },
    });
  }

  private chooseReward(rewardId: string, choiceIndex: number): void {
    const result = dispatchAdventureCommand(
      this.state,
      { type: "choose-reward", rewardId, choiceIndex },
      ADVENTURE_CONTEXT,
    );
    if (!result.accepted) return;
    this.state = result.state;
    this.renderAdventure();
  }

  private retry(): void {
    this.battle?.destroy();
    this.battle = null;
    this.state = createAdventureSession(ADVENTURE_CONTEXT, defaultParty(), ADVENTURE_SEED);
    this.view = "adventure";
    this.renderAdventure();
  }

  private openLoadout(): void {
    if (this.state.phase !== "ready" && this.state.phase !== "between-encounters") return;
    this.view = "loadout";
    this.renderAdventure();
  }

  private closeLoadout(): void {
    this.view = "adventure";
    this.renderAdventure();
  }

  private setMemberLoadout(memberId: string, loadout: PartyMemberLoadout): void {
    const result = dispatchAdventureCommand(
      this.state,
      { type: "set-member-loadout", memberId, loadout },
      ADVENTURE_CONTEXT,
    );
    if (!result.accepted) return;
    this.state = result.state;
    this.renderAdventure();
  }

  private renderAdventure(): void {
    this.root.dataset.ready = "true";
    this.root.dataset.screen = this.view;
    this.root.dataset.adventurePhase = this.state.phase;
    this.root.dataset.encounterId = this.state.currentEncounterId ?? "";
    this.root.dataset.completedEncounters = String(this.state.completedEncounterIds.length);
    this.root.dataset.outcome = this.state.phase === "failed" ? "defeat" : this.state.phase === "complete" ? "victory" : "ongoing";
    this.ui.render(this.state);
    if (this.view === "loadout") {
      this.ui.setVisible(false);
      this.loadoutUi.render(this.state);
    } else {
      this.loadoutUi.setVisible(false);
      this.ui.setVisible(true);
    }
  }

  public destroy(): void {
    this.battle?.destroy();
  }
}
