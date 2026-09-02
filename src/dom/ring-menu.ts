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
    button.addEventListener("click", () => this.handlers.onSelect(option.id));
    button.addEventListener("mouseenter", () => this.handlers.onHover(option.id));
    button.addEventListener("focus", () => this.handlers.onHover(option.id));
    button.addEventListener("mouseleave", () => this.handlers.onHover(null));
    button.addEventListener("blur", () => this.handlers.onHover(null));
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
