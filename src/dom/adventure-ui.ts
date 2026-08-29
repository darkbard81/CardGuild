import type { AdventureState } from "../adventure";
import type { CompiledContentPack } from "../content";
import type { AdventureDefinition, RewardGrant } from "../content";

function required<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Required element was not found: ${selector}`);
  return found;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface AdventureUiHandlers {
  readonly onStart: () => void;
  readonly onContinue: () => void;
  readonly onChooseReward: (rewardId: string, choiceIndex: number) => void;
  readonly onRetry: () => void;
}

function rewardName(grant: RewardGrant, pack: CompiledContentPack): string {
  return grant.kind === "equipment"
    ? pack.combatContent.equipment[grant.definitionId]?.name ?? grant.definitionId
    : pack.combatContent.cards[grant.definitionId]?.name ?? grant.definitionId;
}

export class AdventureUi {
  private readonly screen = required<HTMLElement>("#adventure-screen");
  private readonly progress = required<HTMLOListElement>("#adventure-progress");
  private readonly content = required<HTMLElement>("#adventure-content");
  private readonly collection = required<HTMLElement>("#adventure-collection");

  public constructor(
    private readonly definition: AdventureDefinition,
    private readonly pack: CompiledContentPack,
    private readonly handlers: AdventureUiHandlers,
  ) {}

  public render(state: AdventureState): void {
    this.screen.hidden = state.phase === "combat";
    if (state.phase !== "combat") {
      required<HTMLElement>("#reaction-modal").hidden = true;
      required<HTMLElement>("#result-modal").hidden = true;
    }
    this.progress.replaceChildren();
    for (const [index, encounterId] of this.definition.encounterIds.entries()) {
      const scenario = this.pack.scenarios[encounterId];
      const completed = state.completedEncounterIds.includes(encounterId);
      const item = element("li", completed ? "complete" : encounterId === state.currentEncounterId ? "current" : "upcoming");
      item.append(
        element("span", "progress-index", completed ? "✓" : String(index + 1)),
        element("strong", undefined, scenario?.name ?? encounterId),
      );
      this.progress.append(item);
    }
    this.renderCollection(state);
    this.content.replaceChildren();

    if (state.phase === "ready") {
      this.content.append(
        element("p", "eyebrow", "M2 Linear Adventure"),
        element("h1", undefined, this.definition.name),
        element("p", "adventure-description", this.definition.description),
        this.actionButton("Begin Adventure", this.handlers.onStart),
      );
      return;
    }
    if (state.phase === "between-encounters") {
      const scenario = state.currentEncounterId ? this.pack.scenarios[state.currentEncounterId] : undefined;
      this.content.append(
        element("p", "eyebrow", "Next Encounter"),
        element("h1", undefined, scenario?.name ?? "Continue"),
        element("p", "adventure-description", scenario?.objective.description ?? "Prepare for battle."),
        this.actionButton("Enter Encounter", this.handlers.onContinue),
      );
      return;
    }
    if (state.phase === "reward" && state.pendingReward) {
      this.content.append(
        element("p", "eyebrow", "Encounter Reward"),
        element("h1", undefined, "Choose one reward"),
        element("p", "adventure-description", "획득한 보상은 Collection에 남고 현재 Loadout은 바뀌지 않습니다."),
      );
      const choices = element("div", "reward-choices");
      state.pendingReward.choices.forEach((grant, index) => {
        const button = this.actionButton(rewardName(grant, this.pack), () => {
          const offer = state.pendingReward;
          if (offer) this.handlers.onChooseReward(offer.rewardId, index);
        });
        button.classList.add("reward-choice");
        button.append(element("span", "reward-kind", grant.kind));
        choices.append(button);
      });
      this.content.append(choices);
      return;
    }
    if (state.phase === "complete") {
      this.content.append(
        element("p", "eyebrow", "Adventure Complete"),
        element("h1", undefined, "Goblin Trouble resolved"),
        element("p", "adventure-description", "세 Encounter와 선택한 보상이 AdventureState에 기록되었습니다."),
        this.actionButton("Play Again", this.handlers.onRetry),
      );
      return;
    }
    if (state.phase === "failed") {
      this.content.append(
        element("p", "eyebrow", "Adventure Failed"),
        element("h1", undefined, "The party was defeated"),
        element("p", "adventure-description", "동일한 Adventure seed로 처음부터 다시 도전할 수 있습니다."),
        this.actionButton("Try Again", this.handlers.onRetry),
      );
    }
  }

  private renderCollection(state: AdventureState): void {
    this.collection.replaceChildren();
    const entries = [
      ...Object.entries(state.collection.equipment).map(([id, count]) => `${this.pack.combatContent.equipment[id]?.name ?? id} ×${count}`),
      ...Object.entries(state.collection.cards).map(([id, count]) => `${this.pack.combatContent.cards[id]?.name ?? id} ×${count}`),
    ];
    this.collection.append(element("strong", undefined, "Collection"));
    this.collection.append(element("span", undefined, entries.length ? entries.join(" · ") : "No rewards yet"));
  }

  private actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = element("button", "adventure-action", label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }
}
