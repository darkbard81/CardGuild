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
  readonly onNewAdventure: () => void;
  readonly onShowJoin: () => void;
  readonly onShowCampaigns: () => void;
  readonly onRetryAuth: () => void;
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
  private status = "";
  private drafts = new Map<string, string>();
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

  private card(title: string, description: string): HTMLElement {
    for (const input of this.screen.querySelectorAll<HTMLInputElement>("input:not([type=password])")) {
      this.drafts.set(input.id, input.value);
    }
    this.status = "";
    this.screen.replaceChildren();
    this.screen.removeAttribute("aria-busy");
    delete this.screen.dataset.sessionId;
    delete this.screen.dataset.viewerRole;
    delete this.screen.dataset.lobbyKind;
    const card = element("section", "ui-panel session-card session-entry");
    card.append(element("h1", undefined, title), element("p", "session-description", description));
    this.screen.append(card);
    this.setVisible(true);
    const heading = card.querySelector("h1")!;
    heading.tabIndex = -1;
    heading.focus();
    return card;
  }

  private button(label: string, id: string, action: () => void, primary = false): HTMLButtonElement {
    const button = element("button", primary ? "ui-button ui-button--primary session-primary" : "ui-button ui-button--secondary session-secondary", label);
    button.id = id;
    button.type = "button";
    button.addEventListener("click", action);
    return button;
  }

  private field(form: HTMLFormElement, id: string, label: string, options: {
    password?: boolean; autocomplete?: string; maxLength?: number; required?: boolean; hint?: string;
  } = {}): HTMLInputElement {
    const wrapper = element("div", "session-field");
    const caption = element("label", undefined, label);
    caption.htmlFor = id;
    const input = element("input", "ui-input session-input");
    input.id = id;
    input.name = id;
    input.type = options.password ? "password" : "text";
    input.setAttribute("autocomplete", options.autocomplete ?? "off");
    input.required = options.required ?? true;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (!options.password) input.value = this.drafts.get(id) ?? "";
    wrapper.append(caption, input);
    if (options.hint) {
      const hint = element("p", "session-description", options.hint);
      hint.id = `${id}-hint`;
      input.setAttribute("aria-describedby", hint.id);
      wrapper.append(hint);
    }
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
    });
    form.append(wrapper);
    return input;
  }

  private form(card: HTMLElement, label: string, id: string, submit: () => void): HTMLFormElement {
    const form = element("form", "session-entry-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.screen.getAttribute("aria-busy") === "true") return;
      submit();
    });
    const button = element("button", "ui-button ui-button--primary session-primary", label);
    button.id = id;
    button.type = "submit";
    // Fields are inserted before this action when the form is completed.
    card.append(form);
    form.append(button);
    form.dataset.action = id;
    return form;
  }

  private finishForm(card: HTMLElement, form: HTMLFormElement, back: () => void, backId: string): void {
    form.append(form.querySelector('button[type="submit"]')!);
    card.append(this.button("시작 화면으로", backId, back), this.statusLine());
  }

  public clearDrafts(): void {
    this.drafts.clear();
    for (const input of this.screen.querySelectorAll<HTMLInputElement>("input")) input.value = "";
  }

  public setBusy(busy: boolean): void {
    this.screen.setAttribute("aria-busy", String(busy));
    for (const control of this.screen.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      if (busy) {
        control.dataset.entryDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.entryDisabled !== undefined) {
        control.disabled = control.dataset.entryDisabled === "true";
        delete control.dataset.entryDisabled;
      }
    }
  }

  public renderLanding(account: AccountIdentity | null = null, auth: "checking" | "ready" | "failed" = "ready"): void {
    const card = this.card("CardGuild", "새 모험을 시작하거나 친구의 초대 코드로 참가하세요.");
    const start = this.button("새 모험 시작", "entry-new-adventure", this.handlers.onNewAdventure, true);
    start.disabled = auth !== "ready";
    const choices = element("div", "session-entry-choices");
    choices.append(start, this.button("초대 코드로 참가", "entry-join", this.handlers.onShowJoin));
    card.append(choices);
    if (account) {
      choices.append(this.button("이어하기", "entry-continue", this.handlers.onShowCampaigns));
      card.append(element("p", "session-description", `${account.username}님으로 로그인됨`));
      card.append(this.button("로그아웃", "account-logout", this.handlers.onLogout));
    } else if (auth === "ready") {
      card.append(this.button("로그인", "host-login", this.handlers.onShowLogin));
    }
    if (auth === "failed") card.append(this.button("로그인 상태 다시 확인", "entry-retry-auth", this.handlers.onRetryAuth));
    card.append(this.statusLine());
    if (auth === "checking") this.setStatus("로그인 상태를 확인하고 있습니다…");
    if (auth === "failed") this.setStatus("로그인 상태를 확인하지 못했습니다. 다시 시도하거나 초대 코드로 참가하세요.", "error");
  }

  public renderLogin(): void {
    const card = this.card("로그인", "모험 진행을 저장하고 이어하려면 계정이 필요합니다.");
    const form = this.form(card, "로그인", "account-login", () => this.handlers.onLogin(username.value, password.value));
    const username = this.field(form, "account-username", "계정 이름", { autocomplete: "username" });
    const password = this.field(form, "account-password", "비밀번호", { password: true, autocomplete: "current-password" });
    this.finishForm(card, form, this.handlers.onShowLanding, "account-back");
    card.insertBefore(this.button("계정 만들기", "account-show-register", this.handlers.onShowRegister), card.lastChild);
  }

  public renderRegister(): void {
    const card = this.card("계정 만들기", "진행을 저장할 계정을 만드세요. 비밀번호 복구는 지원하지 않으므로 잘 보관하세요.");
    const form = this.form(card, "계정 만들기", "register-submit", () => {
      if (password.value !== confirm.value) {
        confirm.setAttribute("aria-invalid", "true");
        confirm.setAttribute("aria-describedby", "session-status");
        this.setStatus("비밀번호가 서로 다릅니다.", "error");
        confirm.focus();
        return;
      }
      this.handlers.onRegister(username.value, password.value);
    });
    const username = this.field(form, "register-username", "계정 이름", {
      autocomplete: "username", maxLength: 32, hint: "영문·숫자로 시작하는 3~32자. 영문, 숫자, 점, 하이픈, 밑줄을 사용할 수 있습니다.",
    });
    const password = this.field(form, "register-password", "비밀번호", {
      password: true, autocomplete: "new-password", hint: "8자 이상 입력하세요.",
    });
    const confirm = this.field(form, "register-password-confirm", "비밀번호 확인", { password: true, autocomplete: "new-password" });
    this.finishForm(card, form, this.handlers.onShowLogin, "register-back");
    card.querySelector("#register-back")!.textContent = "로그인으로 돌아가기";
  }

  public renderJoin(): void {
    const card = this.card("초대 코드로 참가", "계정 없이 참가할 수 있습니다. 친구에게 받은 초대 코드를 입력하세요.");
    const form = this.form(card, "참가하기", "join-session", () => {
      if (!this.nonblank(code, "초대 코드를 입력하세요.")) return;
      this.handlers.onJoin(code.value.trim(), name.value);
    });
    const code = this.field(form, "join-session-id", "초대 코드");
    code.spellcheck = false;
    code.setAttribute("autocapitalize", "none");
    const name = this.field(form, "session-display-name", "표시 이름 (선택)", { required: false, maxLength: 40, autocomplete: "name", hint: "비워 두면 자동 이름을 사용합니다." });
    this.finishForm(card, form, this.handlers.onShowLanding, "join-back");
  }

  private nonblank(input: HTMLInputElement, message: string): boolean {
    if (input.value.trim()) return true;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "session-status");
    this.setStatus(message, "error");
    input.focus();
    return false;
  }

  public renderNewAdventure(): void {
    const card = this.card("새 모험 시작", "모험 이름을 정하세요. 진행은 로그인한 계정에 저장됩니다.");
    const form = this.form(card, "모험 만들기", "new-campaign", () => {
      if (!this.nonblank(name, "모험 이름을 입력하세요.")) return;
      this.handlers.onCreateCampaign(name.value.trim(), displayName.value);
    });
    const name = this.field(form, "new-campaign-name", "모험 이름", { maxLength: 60 });
    const displayName = this.field(form, "campaign-display-name", "표시 이름 (선택)", { required: false, maxLength: 40, autocomplete: "name", hint: "비워 두면 자동 이름을 사용합니다." });
    this.finishForm(card, form, this.handlers.onShowLanding, "new-adventure-back");
  }

  public renderCampaigns(account: AccountIdentity, campaigns: readonly CampaignSummary[]): void {
    const card = this.card("이어하기", `${account.username}님의 모험을 선택하세요.`);
    const list = element("ul", "session-seats");
    list.id = "campaign-list";
    this.continueButtons = [];
    this.continueInFlight = false;
    for (const campaign of campaigns) {
      const row = element("li", "occupied");
      row.dataset.campaignId = campaign.campaignId;
      const resume = this.button("이어하기", `continue-${campaign.campaignId}`, () => this.beginContinue(campaign.campaignId));
      resume.disabled = !campaign.hasSave;
      if (campaign.hasSave) this.continueButtons.push(resume);
      row.append(element("span", undefined, campaign.name), resume);
      if (!campaign.hasSave) row.append(element("span", "session-description", "아직 저장된 진행이 없습니다."));
      list.append(row);
    }
    if (!campaigns.length) list.append(element("li", "open", "저장된 모험이 없습니다."));
    card.append(list, this.button("새 모험 시작", "entry-new-adventure", this.handlers.onNewAdventure));
    card.append(this.button("시작 화면으로", "campaigns-back", this.handlers.onShowLanding), this.statusLine());
  }

  public renderCampaignLoading(): void {
    const card = this.card("이어하기", "저장된 모험을 불러옵니다.");
    card.append(this.button("다시 불러오기", "campaigns-retry", this.handlers.onShowCampaigns),
      this.button("시작 화면으로", "campaigns-back", this.handlers.onShowLanding), this.statusLine());
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
    const card = element("section", "ui-panel session-card lobby-card");
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
    const copy = element("button", "ui-button ui-button--secondary session-secondary", "Copy Session ID");
    copy.id = "copy-session-id";
    copy.type = "button";
    copy.hidden = !host;
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(state.sessionId);
      this.setStatus("Session ID copied. Credential은 공유되지 않았습니다.");
    });
    invite.append(code, copy);

    const playersPanel = element("section", "ui-panel ui-panel--workspace lobby-players");
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
        const remove = element("button", "ui-button ui-button--danger ui-button--compact session-seat-remove", "Remove");
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
      "ui-button ui-button--primary session-primary",
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
    const root = element("section", "ui-panel ui-panel--workspace party-builder");
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

  public setStatus(status: string, kind: "info" | "error" = "info"): void {
    this.status = status;
    const line = this.screen.querySelector<HTMLElement>("#session-status");
    if (line) {
      line.dataset.kind = kind;
      line.textContent = status;
    }
  }

  public reportEntryError(message: string, fieldId?: string): void {
    this.setStatus(message, "error");
    const input = fieldId ? this.screen.querySelector<HTMLInputElement>(`#${fieldId}`) : null;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      const descriptions = new Set((input.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean));
      descriptions.add("session-status");
      input.setAttribute("aria-describedby", [...descriptions].join(" "));
      input.focus();
    }
  }

  private statusLine(): HTMLElement {
    const line = element("p", "ui-status session-status", this.status);
    line.id = "session-status";
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    return line;
  }

  public setVisible(visible: boolean): void {
    this.screen.hidden = !visible;
  }
}
