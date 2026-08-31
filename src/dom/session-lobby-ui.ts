import type { SessionCoreState } from "../session";

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

export interface SessionLobbyHandlers {
  readonly onCreate: (displayName: string) => void;
  readonly onJoin: (sessionId: string, displayName: string) => void;
  readonly onBegin: () => void;
}

export class SessionLobbyUi {
  private readonly screen: HTMLElement;
  private status = "호스트가 방을 만들고 세션 ID를 초대할 플레이어에게 전달합니다.";

  public constructor(private readonly handlers: SessionLobbyHandlers) {
    const screen = document.querySelector<HTMLElement>("#session-screen");
    if (!screen) throw new Error("Session screen is missing.");
    this.screen = screen;
  }

  public renderLanding(): void {
    this.screen.replaceChildren();
    const card = element("section", "session-card");
    card.append(
      element("p", "eyebrow", "Host-invited co-op"),
      element("h1", undefined, "CardGuild Session"),
      element("p", "session-description", "공개 방 목록 없이 호스트가 만든 세션 ID로 최대 3명이 참가합니다."),
    );
    const displayName = element("input", "session-input");
    displayName.id = "session-display-name";
    displayName.placeholder = "Display name";
    displayName.maxLength = 40;
    displayName.autocomplete = "name";
    const create = element("button", "session-primary", "Create & Host");
    create.id = "create-session";
    create.type = "button";
    create.addEventListener("click", () => this.handlers.onCreate(displayName.value));

    const joinCode = element("input", "session-input");
    joinCode.id = "join-session-id";
    joinCode.placeholder = "Session ID from host";
    joinCode.autocomplete = "off";
    const join = element("button", "session-secondary", "Join Host");
    join.id = "join-session";
    join.type = "button";
    join.addEventListener("click", () => this.handlers.onJoin(joinCode.value, displayName.value));
    const form = element("div", "session-form");
    form.append(displayName, create, joinCode, join);
    card.append(form, this.statusLine());
    this.screen.append(card);
    this.setVisible(true);
  }

  public renderLobby(state: SessionCoreState, viewerPlayerId: string): void {
    const host = state.hostPlayerId === viewerPlayerId;
    this.screen.dataset.sessionId = state.sessionId;
    this.screen.dataset.viewerRole = host ? "host" : "guest";
    this.screen.replaceChildren();
    const card = element("section", "session-card lobby-card");
    card.append(
      element("p", "eyebrow", host ? "You are the host" : "Host invitation accepted"),
      element("h1", undefined, "Party Lobby"),
      element("p", "session-description", host
        ? "아래 세션 ID만 공유하세요. 재접속 credential은 이 탭의 sessionStorage에만 보관됩니다."
        : "호스트가 Adventure를 시작할 때까지 기다리세요."),
    );

    const invite = element("div", "invite-code");
    const code = element("code", undefined, state.sessionId);
    code.id = "invite-session-id";
    const copy = element("button", "session-secondary", "Copy Session ID");
    copy.id = "copy-session-id";
    copy.type = "button";
    copy.hidden = !host;
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(state.sessionId);
      this.setStatus("Session ID copied. Credential은 공유되지 않았습니다.");
      this.renderLobby(state, viewerPlayerId);
    });
    invite.append(code, copy);

    const seats = element("ol", "session-seats");
    for (const seat of [1, 2, 3] as const) {
      const owner = state.seats.find((candidate) => candidate.seat === seat);
      const item = element("li", owner ? "occupied" : "open");
      item.dataset.seat = String(seat);
      item.append(
        element("span", "seat-number", String(seat)),
        element("strong", undefined, owner?.displayName ?? "Open seat"),
        element("small", undefined, owner?.playerId === state.hostPlayerId ? "Host" : owner ? "Player" : "Invite pending"),
      );
      seats.append(item);
    }

    const begin = element("button", "session-primary", host ? "Begin Adventure" : "Waiting for Host");
    begin.id = "begin-adventure";
    begin.type = "button";
    begin.disabled = !host || state.lifecycle !== "lobby";
    begin.addEventListener("click", this.handlers.onBegin);
    card.append(invite, seats, begin, this.statusLine());
    this.screen.append(card);
    this.setVisible(true);
  }

  public setStatus(status: string): void {
    this.status = status;
    const line = this.screen.querySelector<HTMLElement>("#session-status");
    if (line) line.textContent = status;
  }

  private statusLine(): HTMLElement {
    const line = element("p", "session-status", this.status);
    line.id = "session-status";
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    return line;
  }

  public setVisible(visible: boolean): void {
    this.screen.hidden = !visible;
  }
}
