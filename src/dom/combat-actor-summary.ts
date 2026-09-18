import { resolveStatisticModifier, type ActorState, type CombatContent } from "../game";
import { conditionPresentation, statisticButton, statisticPresentation } from "./actor-effect-view";

/** Read-only active actor feedback; caller enforces enemy disclosure before passing an actor. */
export class CombatActorSummary {
  public readonly root = document.createElement("section");
  private readonly conditions = document.createElement("div");
  private readonly saves = document.createElement("div");
  private readonly note = document.createElement("div");
  private fingerprint = "";
  public constructor(private readonly content: CombatContent) {
    this.root.className = "ui-combat-actor-summary"; this.root.setAttribute("aria-label", "현재 행동자 상태와 내성");
    this.conditions.className = "ui-combat-actor-summary__conditions";
    this.saves.className = "ui-combat-actor-summary__saves";
    this.note.className = "ui-combat-actor-summary__note";
    this.note.setAttribute("role", "status"); this.note.hidden = true;
    this.root.append(this.conditions, this.saves, this.note);
  }
  public update(actor: ActorState | null): void {
    const fingerprint = JSON.stringify(actor);
    if (this.fingerprint === fingerprint) return;
    this.fingerprint = fingerprint;
    this.root.hidden = !actor;
    this.note.hidden = true;
    const focused = document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) ? document.activeElement.dataset.summaryKey : undefined;
    this.conditions.replaceChildren(); this.saves.replaceChildren();
    if (!actor) return;
    const inspect = (text: string, opener: HTMLButtonElement) => {
      const description = document.createElement("p"); description.textContent = text;
      const close = document.createElement("button"); close.type = "button"; close.className = "ui-button ui-button--secondary"; close.textContent = "설명 닫기";
      close.dataset.summaryKey = opener.dataset.summaryKey;
      close.addEventListener("click", () => { this.note.hidden = true; opener.focus(); });
      this.note.replaceChildren(description, close); this.note.hidden = false;
    };
    for (const [index, condition] of actor.conditions.entries()) {
      const info = conditionPresentation(condition, this.content);
      const chip = document.createElement("button"); chip.type = "button";
      chip.className = "ui-button ui-condition-chip ui-combat-actor-summary__condition";
      chip.dataset.tone = info.tone;
      chip.textContent = info.label; chip.title = info.explanation; chip.dataset.summaryKey = `condition-${index}`;
      chip.addEventListener("click", () => inspect(info.explanation, chip));
      this.conditions.append(chip);
    }
    this.conditions.hidden = actor.conditions.length === 0;
    for (const [id, short, label] of [["fortitude", "Fort", "Fortitude"], ["reflex", "Ref", "Reflex"], ["will", "Will", "Will"]] as const) {
      const result = statisticPresentation(actor, actor => resolveStatisticModifier(actor, { kind: "save", id }, { content: this.content }));
      const button = statisticButton(label, `${short} ${result.value >= 0 ? "+" : ""}${result.value}`, result, inspect);
      button.classList.add("ui-save-tile");
      const heading = document.createElement("span"); heading.className = "ui-save-tile__label"; heading.textContent = short.toUpperCase();
      const value = document.createElement("strong"); value.className = "ui-save-tile__value";
      value.textContent = `${result.value >= 0 ? "+" : ""}${result.value}`;
      const direction = button.querySelector(".ui-stat-change__direction");
      if (direction) value.append(direction);
      button.replaceChildren(heading, value);
      button.dataset.summaryKey = id; this.saves.append(button);
    }
    if (focused) (Array.from(this.root.querySelectorAll<HTMLButtonElement>("button[data-summary-key]")).find(button => button.dataset.summaryKey === focused) ?? this.saves.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
  }
  public destroy(): void { this.root.remove(); }
}
