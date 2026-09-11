import type { TraitCategory, TraitDefinition, TraitId, TraitSource } from "../game";
import {
  HOVER_CLOSE_MS,
  HOVER_OPEN_MS,
  bindDismissal,
  bindPressGesture,
  isAnchorVisible,
  placePopover,
} from "./detail-popover";

/** Display names for the closed vocabularies; the values themselves stay on the dataset. */
const SOURCE_LABELS: Readonly<Record<TraitSource, string>> = {
  "pf2e-remaster": "PF2e Remaster",
  cardguild: "CardGuild",
};

const CATEGORY_LABELS: Readonly<Record<TraitCategory, string>> = {
  system: "System",
  ancestry: "Ancestry",
  class: "Class",
  personality: "Personality",
  creature: "Creature",
  action: "Action",
  weapon: "Weapon",
  equipment: "Equipment",
  condition: "Condition",
  terrain: "Terrain",
  damage: "Damage",
  general: "General",
};

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let nextTooltipId = 0;

/**
 * One Trait registry rendered the same way everywhere.
 *
 * A chip is a button labelled with the definition's `name` and stamped with its `id`,
 * `category` and `source` for CSS to read. The tooltip beside it shows the same
 * definition's name, source, category and description — nothing is authored here, so a
 * Trait cannot say one thing in the Action inspector and another in the hero sheet. The
 * Rule Engine never reads any of this back: the dataset is presentation only.
 *
 * Interaction is the Loadout contract, minus the hold: a mouse hovers to peek and clicks
 * to pin; a keyboard focuses to peek and presses Enter or Space to pin; a finger taps to
 * pin and taps again to close. Escape closes the tooltip before anything beneath it, and
 * a press anywhere else unpins.
 */
export class TraitView {
  private readonly tooltip: HTMLElement;
  private anchor: HTMLElement | null = null;
  private pinned = false;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cleanup: Array<() => void> = [];
  /** Each chip's own listeners, released when a list drops the chip. */
  private readonly chipCleanups = new Map<HTMLElement, () => void>();
  private destroyed = false;

  public constructor(
    private readonly registry: Readonly<Record<TraitId, TraitDefinition>>,
    overlay: HTMLElement = document.body,
  ) {
    nextTooltipId += 1;
    this.tooltip = element("aside", "trait-tooltip");
    this.tooltip.id = `trait-tooltip-${nextTooltipId}`;
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.hidden = true;
    this.tooltip.addEventListener("pointerenter", () => clearTimeout(this.closeTimer));
    this.tooltip.addEventListener("pointerleave", () => { if (!this.pinned) this.dismiss(); });
    // The overlay is outside every panel, so a scrolling inspector cannot clip the text.
    overlay.append(this.tooltip);
    this.cleanup.push(bindDismissal({
      panel: this.tooltip,
      anchor: () => this.anchor,
      hide: () => this.dismiss(),
      consumeEscape: true,
      // Panels around a chip scroll on their own as they re-render; the tooltip follows
      // the chip and lets go only once the chip has scrolled out of sight.
      onScroll: () => this.settle(),
    }));
  }

  /** The chip the tooltip is currently describing, pinned or not. */
  public get openAnchor(): HTMLElement | null {
    return this.tooltip.hidden ? null : this.anchor;
  }

  public get isPinned(): boolean {
    return this.pinned && !this.tooltip.hidden;
  }

  /** A list that keeps its chips, focus and pinned tooltip across the host's re-renders. */
  public createList(): TraitChipList {
    return new TraitChipList(this);
  }

  public chip(traitId: TraitId): HTMLButtonElement {
    const definition = this.registry[traitId];
    const chip = element("button", "trait-chip", definition?.name ?? traitId);
    chip.type = "button";
    chip.dataset.traitId = traitId;
    if (!definition) {
      // Content validation refuses an unknown instance, so this is only ever a fixture's
      // shorthand; it is shown as text and explains nothing.
      chip.disabled = true;
      return chip;
    }
    chip.dataset.traitCategory = definition.category;
    chip.dataset.traitSource = definition.source;
    const show = (pin: boolean): void => this.show(chip, definition, pin);
    chip.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(this.openTimer);
      this.openTimer = setTimeout(() => { if (!this.pinned) show(false); }, HOVER_OPEN_MS);
    });
    chip.addEventListener("pointerleave", () => {
      clearTimeout(this.openTimer);
      if (!this.pinned && this.anchor === chip) this.closeTimer = setTimeout(() => this.dismiss(), HOVER_CLOSE_MS);
    });
    chip.addEventListener("focus", () => { if (chip.matches(":focus-visible") && !this.pinned) show(false); });
    chip.addEventListener("blur", () => { if (!this.pinned && this.anchor === chip) this.dismiss(); });
    // A chip's press is about the chip: the card, inspector or sheet around it must not
    // read it as a play, a pick or a toggle.
    chip.addEventListener("pointerdown", (event) => event.stopPropagation());
    chip.addEventListener("pointerup", (event) => event.stopPropagation());
    this.chipCleanups.set(chip, bindPressGesture(chip, {
      onTap: (event) => {
        event.stopPropagation();
        clearTimeout(this.openTimer);
        if (this.pinned && this.anchor === chip) this.dismiss();
        else show(true);
      },
      onCancel: () => { if (!this.pinned) this.dismiss(); },
    }));
    return chip;
  }

  /** Drop a chip a list no longer shows, closing the tooltip if it was the anchor. */
  public release(chip: HTMLElement): void {
    if (chip === this.anchor) this.dismiss();
    this.chipCleanups.get(chip)?.();
    this.chipCleanups.delete(chip);
  }

  /** Close the tooltip and forget the pin; the chip that opened it keeps its focus. */
  public dismiss(): void {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.tooltip.hidden = true;
    this.anchor?.removeAttribute("aria-describedby");
    this.anchor = null;
    this.pinned = false;
  }

  /** Re-place an open tooltip after its chip moved, or close it if the chip is gone. */
  public settle(): void {
    if (this.tooltip.hidden || !this.anchor) return;
    if (!this.anchor.isConnected || !isAnchorVisible(this.anchor)) { this.dismiss(); return; }
    placePopover(this.tooltip, this.anchor, "below");
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dismiss();
    for (const cleanup of this.cleanup.splice(0)) cleanup();
    for (const cleanup of this.chipCleanups.values()) cleanup();
    this.chipCleanups.clear();
    this.tooltip.remove();
  }

  private show(chip: HTMLElement, definition: TraitDefinition, pin: boolean): void {
    if (this.destroyed || !chip.isConnected) return;
    clearTimeout(this.closeTimer);
    if (this.anchor !== chip) {
      this.anchor?.removeAttribute("aria-describedby");
      this.anchor = chip;
      chip.setAttribute("aria-describedby", this.tooltip.id);
      const meta = element("p", "trait-tooltip-meta");
      const source = element("span", "trait-tooltip-source", SOURCE_LABELS[definition.source]);
      source.dataset.traitSource = definition.source;
      const category = element("span", "trait-tooltip-category", CATEGORY_LABELS[definition.category]);
      category.dataset.traitCategory = definition.category;
      meta.append(source, " · ", category);
      this.tooltip.replaceChildren(
        element("h3", "trait-tooltip-name", definition.name),
        meta,
        element("p", "trait-tooltip-description", definition.description),
      );
    }
    this.pinned = pin || this.pinned;
    this.tooltip.dataset.pinned = String(this.pinned);
    placePopover(this.tooltip, chip, "below");
  }
}

/**
 * A row of chips a host rebuilds freely. `render` reuses the chip already standing for a
 * Trait at the same position, so re-rendering the same Action or Strike keeps the chip the
 * keyboard is on and the tooltip pinned to it; a different Trait list closes both.
 */
export class TraitChipList {
  public readonly element: HTMLElement = element("div", "trait-chips");

  public constructor(private readonly view: TraitView) {}

  /**
   * Reconcile the chips to `traitIds`, then let the host place the list (`attach`) before
   * focus and the tooltip are restored — a node moved by `replaceChildren` loses focus in
   * between, and a tooltip is positioned from where the chip ends up.
   */
  public render(traitIds: readonly TraitId[], attach?: (list: HTMLElement) => void): void {
    const active = document.activeElement;
    const focusedId = active instanceof HTMLElement && this.element.contains(active) ? active.dataset.traitId : undefined;
    const existing = [...this.element.children] as HTMLElement[];
    const chips = traitIds.map((traitId, index) => {
      const current = existing[index];
      return current?.dataset.traitId === traitId ? current : this.view.chip(traitId);
    });
    for (const chip of existing) if (!chips.includes(chip)) this.view.release(chip);
    this.element.replaceChildren(...chips);
    this.element.hidden = chips.length === 0;
    attach?.(this.element);
    if (focusedId !== undefined) {
      const chip = chips.find((candidate) => candidate.dataset.traitId === focusedId);
      if (chip && document.activeElement !== chip) chip.focus({ preventScroll: true });
    }
    this.view.settle();
  }

  /** Empty the list, closing the tooltip if it was anchored here. */
  public clear(): void {
    for (const chip of [...this.element.children] as HTMLElement[]) this.view.release(chip);
    this.element.replaceChildren();
    this.element.hidden = true;
  }
}
