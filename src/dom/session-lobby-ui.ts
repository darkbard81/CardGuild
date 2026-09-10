import type { AccountIdentity, CampaignSummary } from "../client";
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
  readonly onShowLogin: () => void;
  readonly onShowRegister: () => void;
  readonly onShowLanding: () => void;
  readonly onLogin: (username: string, password: string) => void;
  readonly onRegister: (username: string, password: string) => void;
  readonly onLogout: () => void;
  readonly onCreateCampaign: (name: string, displayName: string) => void;
  readonly onContinueCampaign: (campaignId: string) => void;
  readonly onJoin: (sessionId: string, displayName: string) => void;
  readonly onSetParty: (actorDefinitionIds: readonly string[]) => void;
  readonly onSelectCharacter: (memberId: string) => void;
  readonly onRemoveOfflineGuest: (playerId: string) => void;
  readonly onBegin: () => void;
  readonly onResume: () => void;
}

export class SessionLobbyUi {
  private readonly screen: HTMLElement;
  private readonly partyBuilder: PartyBuilderUi;
  private status = "호스트가 방을 만들고 세션 ID를 초대할 플레이어에게 전달합니다.";
  /** Every Continue button on the current campaign list, so one attempt can disable them all. */
  private continueButtons: HTMLButtonElement[] = [];
  private continueInFlight = false;

  public constructor(
    private readonly pack: CompiledContentPack,
    private readonly catalog: AssetCatalog,
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
    const joinCode = element("input", "session-input");
    joinCode.id = "join-session-id";
    joinCode.placeholder = "Session ID from host";
    joinCode.autocomplete = "off";
    const join = element("button", "session-secondary", "Join Host");
    join.id = "join-session";
    join.type = "button";
    join.addEventListener("click", () => this.handlers.onJoin(joinCode.value, displayName.value));
    const form = element("div", "session-form");
    form.append(displayName, join, joinCode, element("span"));

    // Hosting needs an account; joining never does.
    const host = element("button", "session-primary", "Host sign in");
    host.id = "host-login";
    host.type = "button";
    host.addEventListener("click", () => this.handlers.onShowLogin());
    const signUp = element("button", "session-secondary", "Create account");
    signUp.id = "host-register";
    signUp.type = "button";
    signUp.addEventListener("click", () => this.handlers.onShowRegister());
    const hostActions = element("div", "session-form");
    hostActions.append(host, signUp);
    card.append(form, element("p", "party-builder-label", "HOST"), hostActions, this.statusLine());
    this.screen.append(card);
    this.setVisible(true);
  }

  public renderLogin(): void {
    this.screen.replaceChildren();
    const card = element("section", "session-card");
    card.append(
      element("p", "eyebrow", "Host account"),
      element("h1", undefined, "Host Sign In"),
      element("p", "session-description", "Campaign은 계정이 소유합니다. 계정이 없다면 새로 만드세요."),
    );
    const username = element("input", "session-input");
    username.id = "account-username";
    username.placeholder = "Username";
    username.autocomplete = "username";
    const password = element("input", "session-input");
    password.id = "account-password";
    password.type = "password";
    password.placeholder = "Password";
    password.autocomplete = "current-password";

    const submit = element("button", "session-primary", "Sign in");
    submit.id = "account-login";
    submit.type = "button";
    submit.addEventListener("click", () => this.handlers.onLogin(username.value, password.value));
    const back = element("button", "session-secondary", "Back");
    back.id = "account-back";
    back.type = "button";
    back.addEventListener("click", () => this.handlers.onShowLanding());
    const signUp = element("button", "session-secondary", "Create account");
    signUp.id = "account-show-register";
    signUp.type = "button";
    signUp.addEventListener("click", () => this.handlers.onShowRegister());

    const form = element("div", "session-form");
    form.append(username, submit, password, back);
    card.append(form, element("p", "party-builder-label", "NO ACCOUNT YET"), signUp, this.statusLine());
    this.screen.append(card);
    this.setVisible(true);
  }

  /**
   * Making an account, which the server then signs in.
   *
   * The password is asked for twice because there is no reset flow: a typo here would lock the
   * account away from the only person who wanted it. The match is checked before the
   * request so a mistyped confirmation never reaches the server as a real attempt.
   */
  public renderRegister(): void {
    this.screen.replaceChildren();
    const card = element("section", "session-card");
    card.append(
      element("p", "eyebrow", "Host account"),
      element("h1", undefined, "Create Account"),
      element("p", "session-description", "Campaign을 만들려면 계정이 필요합니다. 비밀번호는 다시 찾을 수 없으니 잘 보관하세요."),
    );
    const username = element("input", "session-input");
    username.id = "register-username";
    username.placeholder = "Username";
    username.autocomplete = "username";
    const password = element("input", "session-input");
    password.id = "register-password";
    password.type = "password";
    password.placeholder = "Password (8+ characters)";
    password.autocomplete = "new-password";
    const confirm = element("input", "session-input");
    confirm.id = "register-password-confirm";
    confirm.type = "password";
    confirm.placeholder = "Repeat password";
    confirm.autocomplete = "new-password";

    const submit = element("button", "session-primary", "Create account");
    submit.id = "register-submit";
    submit.type = "button";
    submit.addEventListener("click", () => {
      if (password.value !== confirm.value) {
        this.setStatus("비밀번호가 서로 다릅니다.");
        confirm.focus();
        return;
      }
      this.handlers.onRegister(username.value, password.value);
    });
    const back = element("button", "session-secondary", "Back");
    back.id = "register-back";
    back.type = "button";
    back.addEventListener("click", () => this.handlers.onShowLogin());

    const form = element("div", "session-form");
    form.append(username, submit, password, back, confirm, element("span"));
    card.append(form, this.statusLine());
    this.screen.append(card);
    this.setVisible(true);
  }

  public renderCampaigns(account: AccountIdentity, campaigns: readonly CampaignSummary[]): void {
    this.screen.replaceChildren();
    const card = element("section", "session-card");
    card.append(
      element("p", "eyebrow", "Host account"),
      element("h1", undefined, "My Campaigns"),
      element("p", "session-description", `${account.username} 계정이 소유한 Campaign입니다.`),
    );

    const name = element("input", "session-input");
    name.id = "new-campaign-name";
    name.placeholder = "New campaign name";
    name.maxLength = 60;
    const displayName = element("input", "session-input");
    displayName.id = "campaign-display-name";
    displayName.placeholder = "Display name";
    displayName.maxLength = 40;
    displayName.autocomplete = "name";
    const create = element("button", "session-primary", "New Campaign");
    create.id = "new-campaign";
    create.type = "button";
    create.addEventListener("click", () => this.handlers.onCreateCampaign(name.value, displayName.value));
    const form = element("div", "session-form");
    form.append(name, create, displayName, element("span"));
    card.append(form);

    const list = element("ul", "session-seats");
    list.id = "campaign-list";
    // A freshly rendered list is a fresh chance to continue, whatever the last attempt did.
    this.continueButtons = [];
    this.continueInFlight = false;
    for (const campaign of campaigns) {
      const row = element("li", "occupied");
      row.dataset.campaignId = campaign.campaignId;
      const resume = element("button", "session-secondary", "Continue");
      resume.type = "button";
      // Continue restores the last committed gameplay save; a campaign with none is new.
      resume.disabled = !campaign.hasSave;
      if (campaign.hasSave) this.continueButtons.push(resume);
      resume.addEventListener("click", () => this.beginContinue(campaign.campaignId));
      row.append(element("span", undefined, campaign.name), resume);
      list.append(row);
    }
    if (!campaigns.length) {
      list.append(element("li", "open", "아직 Campaign이 없습니다."));
    }
    card.append(element("p", "party-builder-label", "CAMPAIGNS"), list);

    const logout = element("button", "session-secondary", "Sign out");
    logout.id = "account-logout";
    logout.type = "button";
    logout.addEventListener("click", () => this.handlers.onLogout());
    card.append(logout, this.statusLine());
    this.screen.append(card);
    this.setVisible(true);
  }

  /**
   * Continue retires whatever live session a campaign has, so only one attempt may be in
   * flight — and not just per campaign: a second Continue on a *different* campaign would
   * race the session the first one is opening. So an attempt disables every Continue, and
   * the in-flight flag lives here rather than in each button.
   */
  private beginContinue(campaignId: string): void {
    if (this.continueInFlight) return;
    this.continueInFlight = true;
    for (const button of this.continueButtons) button.disabled = true;
    this.handlers.onContinueCampaign(campaignId);
  }

  /**
   * Re-arm Continue after an attempt that did not open a session. The caller must not leave
   * this to a campaign-list refetch: the refetch is a network request of its own, and when
   * the same outage takes both, the host is left with the only retry path disabled until
   * they reload the page.
   */
  public settleContinue(): void {
    this.continueInFlight = false;
    for (const button of this.continueButtons) button.disabled = false;
  }

  public renderLobby(
    state: SessionCoreState,
    viewerPlayerId: string,
    control: ServerControlView,
  ): void {
    const host = state.hostPlayerId === viewerPlayerId;
    const resuming = state.lifecycle === "resume-lobby";
    const connected = new Set(control.connectedPlayerIds);
    this.screen.dataset.sessionId = state.sessionId;
    this.screen.dataset.viewerRole = host ? "host" : "guest";
    this.screen.dataset.lobbyKind = resuming ? "resume" : "new";
    this.screen.replaceChildren();
    const card = element("section", "session-card lobby-card");
    card.append(
      element("p", "eyebrow", resuming
        ? host ? "Saved campaign restored" : "Host invitation accepted"
        : host ? "You are the host" : "Host invitation accepted"),
      element("h1", undefined, resuming ? "Resume Lobby" : "Party Lobby"),
      element("p", "session-description", resuming
        ? host
          ? "저장된 Party로 이어서 진행합니다. 새 Session ID를 게스트에게 다시 공유하세요."
          : "호스트가 저장했던 캐릭터 중 하나를 선택하고 Resume을 기다리세요."
        : host
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
      const seatStatus = element("span", "session-seat-status");
      seatStatus.append(element(
        "small",
        undefined,
        owner?.playerId === state.hostPlayerId
          ? connected.has(owner.playerId) ? "Host · Online" : "Host · Offline"
          : owner
            ? (claim ?? "Choosing character") + (connected.has(owner.playerId) ? " · Online" : " · Offline")
            : "Invite pending",
      ));
      const removable = Boolean(
        host &&
        owner &&
        owner.playerId !== state.hostPlayerId &&
        !connected.has(owner.playerId) &&
        !claim,
      );
      if (removable && owner) {
        const remove = element("button", "session-seat-remove", "Remove");
        remove.type = "button";
        remove.dataset.playerId = owner.playerId;
        remove.setAttribute("aria-label", "Remove offline guest " + owner.displayName);
        remove.addEventListener("click", () => this.handlers.onRemoveOfflineGuest(owner.playerId));
        seatStatus.append(remove);
      }
      item.append(
        element("span", "seat-number", String(seat)),
        element("strong", undefined, owner?.displayName ?? "Open seat"),
        seatStatus,
      );
      seats.append(item);
    }
    playersPanel.append(seats);

    const everyGuestClaimed = state.seats
      .filter((seat) => seat.playerId !== state.hostPlayerId)
      .every((seat) => Boolean(claimedMemberForPlayer(state, seat.playerId)));
    // A restored campaign resumes with whoever is present: unclaimed saved characters fall
    // back to the host under the existing control rules.
    const canBegin = host && state.partyPrepared && (resuming
      ? true
      : state.lifecycle === "lobby" && state.partySlots.length >= state.seats.length && everyGuestClaimed);
    const begin = element(
      "button",
      "session-primary",
      resuming
        ? host ? "Resume" : "Waiting for Host"
        : host ? "Begin Adventure" : "Waiting for Host",
    );
    begin.id = resuming ? "resume-adventure" : "begin-adventure";
    begin.type = "button";
    begin.disabled = !canBegin;
    begin.addEventListener("click", resuming ? this.handlers.onResume : this.handlers.onBegin);
    const beginGate = element(
      "p",
      canBegin ? "party-gate" : "party-gate invalid",
      resuming
        ? host
          ? "Saved progress is ready to resume."
          : "Waiting for the host to resume."
        : !state.partyPrepared
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
      // The saved party is fixed, so the host sees it read-only instead of an editor.
      resuming && host ? this.savedPartyPanel(state, control) : this.partyBuilder.render(state, viewerPlayerId),
      begin,
      beginGate,
      this.statusLine(),
    );
    this.screen.append(card);
    this.setVisible(true);
  }

  /** Read-only view of a restored party: no composition editing exists in a resume lobby. */
  private savedPartyPanel(state: SessionCoreState, control: ServerControlView): HTMLElement {
    const root = element("section", "party-builder");
    root.dataset.partyPrepared = "true";
    root.dataset.partyFixed = "true";
    root.append(
      element("p", "party-builder-label", "SAVED PARTY"),
      element("h2", undefined, "Restored Company"),
    );
    const list = element("div", "guest-character-choices");
    for (const slot of state.partySlots) {
      const member = state.adventure?.party.members[slot.memberId];
      const actor = this.pack.actorDefinitions[slot.actorDefinitionId];
      const claimant = state.guestClaims.byMemberId[slot.memberId];
      const entry = element("article", "guest-character-choice");
      entry.dataset.memberId = slot.memberId;
      entry.dataset.partySlot = String(slot.slot);
      entry.dataset.claimState = slot.slot === 1 ? "host" : claimant ? "taken" : "available";
      const visual = actor ? this.catalog.actorVisual(actor.id) : null;
      if (visual) {
        const portrait = element("span", "guest-character-art");
        Object.assign(portrait.style, this.catalog.domStandeeStyle(visual.front, 92));
        entry.append(portrait);
      }
      const controller = control.effectiveControllerByMemberId[slot.memberId];
      entry.append(
        element("strong", undefined, "Slot " + String(slot.slot) + " · " + (actor?.name ?? slot.actorDefinitionId)),
        element("small", undefined, member
          ? "Lv " + String(member.progression.level) +
            (slot.slot === 1
              ? " · Host Character"
              : claimant
                ? controller === claimant ? " · Guest control" : " · Claimed, offline"
                : " · Host control")
          : "Saved character"),
      );
      list.append(entry);
    }
    root.append(list);
    return root;
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
