import type { CompiledContentPack } from "../content";
import type { AssetCatalog } from "../presentation";
import type { ServerControlView } from "../protocol";
import { claimedMemberForPlayer, type SessionCoreState } from "../session";
import { PartyBuilderUi } from "./party-builder-ui";

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
  readonly onSetParty: (actorDefinitionIds: readonly string[]) => void;
  readonly onSelectCharacter: (memberId: string) => void;
  readonly onBegin: () => void;
}

export class SessionLobbyUi {
  private readonly screen: HTMLElement;
  private readonly partyBuilder: PartyBuilderUi;
  private status = "호스트가 방을 만들고 세션 ID를 초대할 플레이어에게 전달합니다.";

  public constructor(
    pack: CompiledContentPack,
    catalog: AssetCatalog,
    private readonly handlers: SessionLobbyHandlers,
  ) {
    const screen = document.querySelector<HTMLElement>("#session-screen");
    if (!screen) throw new Error("Session screen is missing.");
    this.screen = screen;
    this.partyBuilder = new PartyBuilderUi(pack, catalog, {
      onSetParty: handlers.onSetParty,
      onSelectCharacter: handlers.onSelectCharacter,
    });
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

  public renderLobby(
    state: SessionCoreState,
    viewerPlayerId: string,
    control: ServerControlView,
  ): void {
    const host = state.hostPlayerId === viewerPlayerId;
    const connected = new Set(control.connectedPlayerIds);
    this.screen.dataset.sessionId = state.sessionId;
    this.screen.dataset.viewerRole = host ? "host" : "guest";
    this.screen.replaceChildren();
    const card = element("section", "session-card lobby-card");
    card.append(
      element("p", "eyebrow", host ? "You are the host" : "Host invitation accepted"),
      element("h1", undefined, "Party Lobby"),
      element("p", "session-description", host
        ? "Players와 출전 Party를 따로 준비합니다. Session ID만 게스트에게 공유하세요."
        : "호스트가 준비한 잔여 캐릭터 중 하나를 선택하세요."),
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
    });
    invite.append(code, copy);

    const playersPanel = element("section", "lobby-players");
    playersPanel.append(element("p", "party-builder-label", "PLAYERS"));
    const seats = element("ol", "session-seats");
    for (const seat of [1, 2, 3] as const) {
      const owner = state.seats.find((candidate) => candidate.seat === seat);
      const item = element("li", owner ? "occupied" : "open");
      item.dataset.seat = String(seat);
      item.dataset.connected = String(Boolean(owner && connected.has(owner.playerId)));
      const claim = owner && owner.playerId !== state.hostPlayerId
        ? claimedMemberForPlayer(state, owner.playerId)
        : undefined;
      item.append(
        element("span", "seat-number", String(seat)),
        element("strong", undefined, owner?.displayName ?? "Open seat"),
        element(
          "small",
          undefined,
          owner?.playerId === state.hostPlayerId
            ? connected.has(owner.playerId) ? "Host · Online" : "Host · Offline"
            : owner
              ? (claim ?? "Choosing character") + (connected.has(owner.playerId) ? " · Online" : " · Offline")
              : "Invite pending",
        ),
      );
      seats.append(item);
    }
    playersPanel.append(seats);

    const everyGuestClaimed = state.seats
      .filter((seat) => seat.playerId !== state.hostPlayerId)
      .every((seat) => Boolean(claimedMemberForPlayer(state, seat.playerId)));
    const canBegin = host &&
      state.lifecycle === "lobby" &&
      state.partyPrepared &&
      state.partySlots.length >= state.seats.length &&
      everyGuestClaimed;
    const begin = element("button", "session-primary", host ? "Begin Adventure" : "Waiting for Host");
    begin.id = "begin-adventure";
    begin.type = "button";
    begin.disabled = !canBegin;
    begin.addEventListener("click", this.handlers.onBegin);
    const beginGate = element(
      "p",
      canBegin ? "party-gate" : "party-gate invalid",
      !state.partyPrepared
        ? "Apply a party before beginning."
        : state.partySlots.length < state.seats.length
          ? "Party size must cover every player."
          : !everyGuestClaimed
            ? "Every guest must choose exactly one character."
            : host
              ? "Party and guest claims are ready."
              : "Waiting for the host to begin.",
    );
    card.append(
      invite,
      playersPanel,
      this.partyBuilder.render(state, viewerPlayerId),
      begin,
      beginGate,
      this.statusLine(),
    );
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
