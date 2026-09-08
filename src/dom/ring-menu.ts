export interface RingMenuOption {
  readonly id: string;
  readonly actionId: string;
  readonly label: string;
  readonly cost: string;
  readonly hint?: string;
}

export interface RingMenuHandlers {
  readonly onSelect: (optionId: string) => void;
  readonly onHover: (optionId: string | null) => void;
  readonly onDismiss: () => void;
}

export interface RingAnchor {
  readonly x: number;
  readonly y: number;
}

const OPTION_WIDTH = 92;
const OPTION_HEIGHT = 46;
const MIN_RADIUS = 92;
const MAX_RADIUS = 200;
const EDGE_MARGIN = 8;

function ringRadius(count: number): number {
  if (count < 2) return MIN_RADIUS;
  const spread = (OPTION_WIDTH + 10) / (2 * Math.sin(Math.PI / count));
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, spread));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Radial context menu drawn over the battlefield: the player picks a board target
 * first and then chooses one of the actions that can legally reach it.
 */
export class RingMenu {
  private readonly menu = document.createElement("div");
  private readonly hub = document.createElement("p");
  private readonly connectors = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private readonly abortController = new AbortController();
  private open = false;
  /**
   * A finger cannot hover, so a touch player would fire an action without ever seeing
   * its odds. The first tap on an option only arms it — and the detail panel fills —
   * and the second tap on the same option runs it. A mouse is unaffected: hovering has
   * already armed the option under the cursor, so its click still runs on the first
   * press. Tracked here rather than from the selection state because iOS synthesises a
   * mouseover on the same tap that produces the click.
   */
  private armedOptionId: string | null = null;
  /** A touch-armed option keeps the detail panel; the synthetic mouseleave must not clear it. */
  private armedByTouch = false;

  public constructor(
    private readonly root: HTMLElement,
    private readonly handlers: RingMenuHandlers,
  ) {
    const listenerOptions = { signal: this.abortController.signal };
    this.menu.className = "ring-menu";
    this.menu.setAttribute("role", "menu");
    this.hub.className = "ring-hub";
    this.connectors.setAttribute("class", "ring-connector");
    this.root.append(this.connectors, this.menu, this.hub);
    this.root.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target === this.root) this.handlers.onDismiss();
      },
      listenerOptions,
    );
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.open && event.key === "Escape") this.handlers.onDismiss();
      },
      listenerOptions,
    );
  }

  public get isOpen(): boolean {
    return this.open;
  }

  public show(anchor: RingAnchor, title: string, options: readonly RingMenuOption[]): void {
    this.arm(null);
    // The menu is named after whatever the player picked on the board.
    this.menu.setAttribute("aria-label", title);
    this.menu.replaceChildren();
    while (this.connectors.firstChild) this.connectors.firstChild.remove();
    this.hub.textContent = title;
    this.hub.style.left = `${anchor.x}px`;
    this.hub.style.top = `${anchor.y}px`;
    // Unhide before measuring: a hidden root reports a zero-sized clamp box.
    this.root.hidden = false;

    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const radius = ringRadius(options.length);
    const halfWidth = OPTION_WIDTH / 2 + EDGE_MARGIN;
    const halfHeight = OPTION_HEIGHT / 2 + EDGE_MARGIN;

    options.forEach((option, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / options.length;
      const x = clamp(anchor.x + Math.cos(angle) * radius, halfWidth, width - halfWidth);
      const y = clamp(anchor.y + Math.sin(angle) * radius, halfHeight, height - halfHeight);
      this.menu.append(this.optionButton(option, x, y));
      this.connectors.append(this.connector(anchor, x, y));
    });

    this.open = true;
    this.menu.querySelector<HTMLButtonElement>(".ring-option")?.focus({ preventScroll: true });
  }

  public hide(): void {
    this.armedOptionId = null;

    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.menu.replaceChildren();
    while (this.connectors.firstChild) this.connectors.firstChild.remove();
  }

  public destroy(): void {
    this.hide();
    this.abortController.abort();
    this.connectors.remove();
    this.menu.remove();
    this.hub.remove();
  }

  /**
   * Tapping an option makes the browser send mouseenter and then, as the finger lifts,
   * mouseleave. Letting that clear the detail would undo the whole point of the first tap.
   */
  private clearHover(optionId: string): void {
    if (this.armedByTouch && this.armedOptionId === optionId) return;
    this.handlers.onHover(null);
  }

  /** Marks which option a second tap would run, so touch has hover's visual cue. */
  private arm(optionId: string | null): void {
    this.armedOptionId = optionId;
    if (optionId === null) this.armedByTouch = false;
    for (const option of this.menu.querySelectorAll<HTMLElement>(".ring-option")) {
      option.classList.toggle("armed", option.dataset.optionId === optionId);
    }
  }

  private optionButton(option: RingMenuOption, x: number, y: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ring-option";
    button.setAttribute("role", "menuitem");
    button.dataset.optionId = option.id;
    button.dataset.actionId = option.actionId;
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
    if (option.hint) button.title = option.hint;
    const label = document.createElement("strong");
    label.textContent = option.label;
    const cost = document.createElement("span");
    cost.className = "ring-cost";
    cost.textContent = option.cost;
    button.append(label, cost);
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse") return;
      this.armedByTouch = false;
      this.arm(option.id);
    });
    button.addEventListener("click", () => {
      if (this.armedOptionId !== option.id) {
        this.armedByTouch = true;
        this.arm(option.id);
        this.handlers.onHover(option.id);
        return;
      }
      this.handlers.onSelect(option.id);
    });
    button.addEventListener("mouseenter", () => this.handlers.onHover(option.id));
    // The menu focuses its first option when it opens; that must not overwrite the detail
    // panel, which is showing what the player just picked on the board. Only a focus the
    // player drove — keyboard, not the programmatic one — counts as pointing at an option.
    button.addEventListener("focus", () => {
      if (button.matches(":focus-visible")) this.handlers.onHover(option.id);
    });
    button.addEventListener("mouseleave", () => this.clearHover(option.id));
    button.addEventListener("blur", () => this.clearHover(option.id));
    return button;
  }

  private connector(anchor: RingAnchor, x: number, y: number): SVGLineElement {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(anchor.x));
    line.setAttribute("y1", String(anchor.y));
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "rgba(255, 218, 121, 0.45)");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4 4");
    return line;
  }
}
