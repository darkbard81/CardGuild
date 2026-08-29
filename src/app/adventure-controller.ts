import {
  buildAdventureEncounter,
  createAdventureSession,
  dispatchAdventureCommand,
  type AdventureState,
  type PartyState,
} from "../adventure";
import { M2_ADVENTURE, M2_COMPILED_PACK } from "../content";
import { AdventureUi } from "../dom/adventure-ui";
import type { AssetCatalog } from "../presentation";
import { BattleController } from "./battle-controller";
import type { Application } from "pixi.js";

const ADVENTURE_SEED = 20260830;

function defaultParty(): PartyState {
  const aerin = M2_COMPILED_PACK.actorDefinitions["hero.aerin"];
  if (!aerin) throw new Error("Aerin actor definition is missing.");
  return {
    members: {
      "party.hero-1": {
        id: "party.hero-1",
        actorDefinitionId: aerin.id,
        equipmentIds: [...aerin.equipmentIds],
      },
    },
  };
}

export class AdventureController {
  private state: AdventureState = createAdventureSession(M2_ADVENTURE, defaultParty(), ADVENTURE_SEED);
  private battle: BattleController | null = null;
  private readonly ui: AdventureUi;

  public constructor(
    private readonly app: Application,
    private readonly catalog: AssetCatalog,
    private readonly root: HTMLElement,
  ) {
    this.ui = new AdventureUi(M2_ADVENTURE, M2_COMPILED_PACK, {
      onStart: () => void this.startAdventure(),
      onContinue: () => this.continueAdventure(),
      onChooseReward: (rewardId, choiceIndex) => this.chooseReward(rewardId, choiceIndex),
      onRetry: () => this.retry(),
    });
    this.renderAdventure();
  }

  private async startAdventure(): Promise<void> {
    await this.catalog.loadEncounterBundle();
    const started = dispatchAdventureCommand(this.state, { type: "start-adventure" }, M2_ADVENTURE);
    if (!started.accepted) return;
    this.state = started.state;
    this.continueAdventure();
  }

  private continueAdventure(): void {
    const result = dispatchAdventureCommand(this.state, { type: "continue-adventure" }, M2_ADVENTURE);
    if (!result.accepted) return;
    this.state = result.state;
    this.beginCombat();
  }

  private beginCombat(): void {
    const encounter = buildAdventureEncounter(M2_COMPILED_PACK, this.state);
    this.root.dataset.screen = "combat";
    this.root.dataset.adventurePhase = this.state.phase;
    this.root.dataset.encounterId = this.state.currentEncounterId ?? "";
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
          M2_ADVENTURE,
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
      M2_ADVENTURE,
    );
    if (!result.accepted) return;
    this.state = result.state;
    this.renderAdventure();
  }

  private retry(): void {
    this.battle?.destroy();
    this.battle = null;
    this.state = createAdventureSession(M2_ADVENTURE, defaultParty(), ADVENTURE_SEED);
    this.renderAdventure();
  }

  private renderAdventure(): void {
    this.root.dataset.ready = "true";
    this.root.dataset.screen = "adventure";
    this.root.dataset.adventurePhase = this.state.phase;
    this.root.dataset.encounterId = this.state.currentEncounterId ?? "";
    this.root.dataset.completedEncounters = String(this.state.completedEncounterIds.length);
    this.root.dataset.outcome = this.state.phase === "failed" ? "defeat" : this.state.phase === "complete" ? "victory" : "ongoing";
    this.ui.render(this.state);
  }

  public destroy(): void {
    this.battle?.destroy();
  }
}
