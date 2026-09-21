import { resolveSessionPartyDefinition } from "../session/member-view";
import type { AdventurePhase } from "../adventure/types";
import type { AccountIdentity, CampaignSummary } from "../client";
import type { CompiledContentPack } from "../content";
import type { AssetCatalog } from "../presentation";
import type { ServerControlView } from "../protocol";
import { claimedMemberForPlayer, type SessionCoreState } from "../session";
import { PartyBuilderUi } from "./party-builder-ui";
import { CharacterCreationUi, type CreationDraft } from "./character-creation-ui";
import type { CreateCharacterInput, ResolvedPartyMemberDefinition } from "../character/member";

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

const phaseLabels: Record<AdventurePhase, string> = {
  ready: "모험 준비", combat: "전투 중", reward: "보상 선택",
  "between-encounters": "다음 전투 준비", complete: "모험 완료", failed: "모험 실패",
};
function destination(phase: AdventurePhase): string {
  return phase === "combat" ? "진행 중인 전투" : phase === "reward" ? "보상 선택 화면"
    : phase === "complete" || phase === "failed" ? "저장된 결과 화면" : "모험 준비 화면";
}
const saveMessages: Record<CampaignSummary["saveStatus"], string> = {
  empty: "아직 시작하지 않은 모험 · 모험을 시작하면 진행 상황이 저장됩니다.",
  ready: "",
  SAVE_CORRUPT: "저장 데이터를 읽을 수 없습니다. 원본은 보존되어 있습니다.",
  SAVE_SCHEMA_UNSUPPORTED: "현재 버전에서 지원하지 않는 저장 형식입니다.",
  SAVE_CONTENT_MISMATCH: "저장된 모험과 현재 콘텐츠가 일치하지 않습니다.",
};

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
  readonly onCreateCampaign: (input: CreateCharacterInput) => void;
  readonly onPreviewCharacter: (definition: ResolvedPartyMemberDefinition) => void;
  readonly onDeleteCampaign: (campaignId: string) => void;
  readonly onContinueCampaign: (campaignId: string) => void;
  readonly onJoin: (sessionId: string, displayName: string) => void;
  readonly onSetParty: (actorDefinitionIds: readonly string[]) => void;
  readonly onReleaseCharacter: () => void;
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
  private creationDraft: CreationDraft;
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
    this.creationDraft = { name: "", gender: "male", creationPresetId: Object.keys(pack.creationPresets ?? {})[0] ?? "" };
    this.partyBuilder = new PartyBuilderUi(pack, catalog, {
      onSetParty: handlers.onSetParty,
      onSelectCharacter: handlers.onSelectCharacter,
      onReleaseCharacter: handlers.onReleaseCharacter,
    });
  }

  private card(title: string, description: string, focusHeading = true): HTMLElement {
    for (const input of this.screen.querySelectorAll<HTMLInputElement>("input:not([type=password])")) {
      this.drafts.set(input.id, input.value);
    }
    this.status = "";
    this.screen.replaceChildren();
    this.screen.removeAttribute("aria-busy");
    delete this.screen.dataset.lobbyKind;
    const card = element("section", "ui-panel session-card session-entry");
    card.append(element("h1", undefined, title), element("p", "session-description", description));
    this.screen.append(card);
    this.setVisible(true);
    const heading = card.querySelector("h1")!;
    heading.tabIndex = -1;
    if (focusHeading) heading.focus();
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
    this.creationDraft = { name: "", gender: "male", creationPresetId: Object.keys(this.pack.creationPresets ?? {})[0] ?? "" };
    for (const input of this.screen.querySelectorAll<HTMLInputElement>("input")) input.value = "";
  }

  public setBusy(busy: boolean): void {
    if (this.screen.getAttribute("aria-busy") === String(busy)) return;
    this.screen.setAttribute("aria-busy", String(busy));
    for (const control of this.screen.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
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
    const card = this.card("캐릭터 생성", "Human 주인공 한 명으로 시작합니다. 생성하고 시작을 누르면 로그인한 계정에 저장됩니다.");
    card.classList.add("creation-card");
    const form = this.form(card, "생성하고 시작", "new-campaign", () => {
      const input = creator.input();
      if (input) this.handlers.onCreateCampaign(input);
    });
    const creator = new CharacterCreationUi(this.pack, this.catalog, this.creationDraft, this.handlers.onPreviewCharacter);
    form.append(creator.element);
    this.finishForm(card, form, this.handlers.onShowLanding, "new-adventure-back");
  }

  public renderCampaigns(account: AccountIdentity, campaigns: readonly CampaignSummary[]): void {
    const card = this.card("이어하기", `${account.username}님의 모험을 선택하세요.`);
    card.classList.add("campaign-screen");
    const list = element("ul", "campaign-list");
    list.id = "campaign-list";
    this.continueButtons = [];
    this.continueInFlight = false;
    for (const campaign of campaigns) {
      const row = element("li", "ui-panel ui-panel--workspace campaign-card");
      row.dataset.campaignId = campaign.campaignId;
      row.dataset.saveStatus = campaign.saveStatus;
      const details = element("div", "campaign-details");
      details.append(element("h2", undefined, campaign.name));
      const progress = campaign.progress;
      const terminal = progress?.phase === "complete" || progress?.phase === "failed";
      const resume = this.button(terminal ? "저장된 결과 보기" : "이어하기", `continue-${campaign.campaignId}`, () => this.beginContinue(campaign.campaignId));
      resume.disabled = campaign.saveStatus !== "ready";
      if (!resume.disabled) this.continueButtons.push(resume);
      if (progress) {
        details.append(element("p", "campaign-progress", `${phaseLabels[progress.phase]} · 전투 ${String(progress.completedEncounters)} / ${String(progress.totalEncounters)} 완료`));
        if (progress.encounterName) details.append(element("p", undefined, progress.encounterName));
        details.append(element("p", "session-description", `재참가 준비 후 ${destination(progress.phase)}으로 돌아갑니다.`));
        const party = element("ul", "campaign-party");
        for (const member of progress.party) {
          const item = element("li", "campaign-member");
          const visual = this.catalog.actorVisual(member.appearanceKey ?? member.actorDefinitionId);
          if (visual) {
            const portrait = element("span", "campaign-portrait");
            portrait.setAttribute("aria-hidden", "true");
            Object.assign(portrait.style, this.catalog.domStandeeStyle(visual.front, 64));
            item.append(portrait);
          }
          item.append(element("span", undefined, `${member.name} · Lv ${String(member.level)}`));
          party.append(item);
        }
        details.append(party);
      } else {
        details.append(element("p", "session-description", saveMessages[campaign.saveStatus]));
      }
      if (campaign.savedAt !== null) {
        const time = element("time", "campaign-saved", `마지막 저장: ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(campaign.savedAt)}`);
        time.dateTime = new Date(campaign.savedAt).toISOString();
        details.append(time);
      }
      const actions = element("div", "campaign-row-actions");
      const remove = this.button("삭제", `delete-${campaign.campaignId}`, () => this.confirmDelete(campaign, remove));
      remove.classList.add("ui-button--danger");
      remove.setAttribute("aria-label", `${campaign.name} 삭제`);
      actions.append(resume, remove);
      row.append(details, actions);
      list.append(row);
    }
    if (!campaigns.length) list.append(element("li", "campaign-empty", "아직 모험이 없습니다. 새 모험을 시작하세요."));
    const actions = element("div", "campaign-actions");
    actions.append(this.button("목록 새로고침", "campaigns-refresh", this.handlers.onShowCampaigns),
      this.button("새 모험 시작", "entry-new-adventure", this.handlers.onNewAdventure),
      this.button("시작 화면으로", "campaigns-back", this.handlers.onShowLanding));
    card.append(list, actions, this.statusLine());
  }

  private confirmDelete(campaign: CampaignSummary, trigger: HTMLButtonElement): void {
    const dialog = element("dialog", "ui-panel ui-panel--dialog campaign-delete-dialog");
    dialog.setAttribute("aria-labelledby", "campaign-delete-title");
    dialog.setAttribute("aria-describedby", "campaign-delete-description");
    const title = element("h2", undefined, "모험 삭제");
    title.id = "campaign-delete-title";
    const description = element("p", undefined, `“${campaign.name}” 모험과 저장된 진행 상황을 영구 삭제합니다. 진행 중인 세션과 참가자의 연결도 종료됩니다. 삭제 후 복구할 수 없습니다.`);
    description.id = "campaign-delete-description";
    const cancel = this.button("취소", "campaign-delete-cancel", () => dialog.close());
    const confirm = this.button("영구 삭제", "campaign-delete-confirm", () => {
      dialog.close();
      this.handlers.onDeleteCampaign(campaign.campaignId);
    });
    confirm.classList.add("ui-button--danger");
    const actions = element("div", "campaign-actions");
    actions.append(cancel, confirm);
    dialog.append(title, description, actions);
    dialog.addEventListener("close", () => { dialog.remove(); if (!trigger.disabled) trigger.focus(); }, { once: true });
    this.screen.append(dialog);
    dialog.showModal();
    cancel.focus();
  }

  public removeCampaign(campaignId: string): void {
    this.screen.querySelector(`[data-campaign-id="${CSS.escape(campaignId)}"]`)?.remove();
    this.continueButtons = this.continueButtons.filter(button => button.isConnected);
    const list = this.screen.querySelector("#campaign-list");
    if (list && !list.children.length) list.append(element("li", "campaign-empty", "아직 모험이 없습니다. 새 모험을 시작하세요."));
    this.screen.querySelector<HTMLButtonElement>("#campaigns-refresh")?.focus();
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
    const selected = this.screen.querySelector<HTMLElement>(`#continue-${CSS.escape(campaignId)}`);
    if (selected) {
      selected.dataset.label = selected.textContent ?? "이어하기";
      selected.textContent = "모험을 불러오는 중…";
    }
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
    for (const button of this.continueButtons) {
      button.disabled = false;
      if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
    }
  }

  public renderLobby(
    state: SessionCoreState,
    viewerPlayerId: string,
    control: ServerControlView,
  ): void {
    if (state.lifecycle === "resume-lobby") {
      this.renderResumeLobby(state, viewerPlayerId, control);
      return;
    }
    const host = state.hostPlayerId === viewerPlayerId;
    const connected = new Set(control.connectedPlayerIds);
    this.screen.dataset.lobbyKind = "new";
    this.screen.replaceChildren();
    const card = element("section", "ui-panel session-card lobby-card");
    card.append(
      element("p", "eyebrow", host ? "파티를 준비하세요" : "초대로 참가했습니다"),
      element("h1", undefined, "모험 시작 준비"),
      element("p", "session-description", host
          ? "파티를 적용하고 초대 코드를 공유하세요. 참가자가 캐릭터를 선택하면 시작할 수 있습니다."
          : "호스트가 준비한 잔여 캐릭터 중 하나를 선택하세요."),
    );

    const invite = element("div", "invite-code");
    const code = element("code", undefined, state.sessionId);
    code.id = "invite-session-id";
    const copy = element("button", "ui-button ui-button--secondary session-secondary", "초대 코드 복사");
    copy.id = "copy-session-id";
    copy.type = "button";
    copy.hidden = !host;
    copy.addEventListener("click", () => {
      void (async () => {
        try {
          if (!navigator.clipboard) throw new Error("Clipboard unavailable");
          await navigator.clipboard.writeText(state.sessionId);
          if (code.isConnected) this.setStatus("초대 코드를 복사했습니다.");
        } catch {
          if (!code.isConnected) return;
          code.tabIndex = 0; code.focus();
          const range = document.createRange(); range.selectNodeContents(code);
          const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
          this.setStatus("자동 복사에 실패했습니다. 선택된 초대 코드를 직접 복사하세요.", "error");
        }
      })();
    });
    invite.append(code, copy);

    const playersPanel = element("section", "ui-panel ui-panel--workspace lobby-players");
    playersPanel.append(element("p", "party-builder-label", "참가자"));
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
          ? `호스트 · ${connected.has(owner.playerId) ? "접속 중" : "오프라인"} · ${resolveSessionPartyDefinition(state, state.partySlots[0], this.pack)?.name ?? "파티 준비 중"} · ${state.partyPrepared ? "준비됨" : "파티 적용 필요"}`
          : owner
            ? (claim ? (resolveSessionPartyDefinition(state, state.partySlots.find(slot => slot.memberId === claim), this.pack)?.name ?? claim) + " · 준비됨" : "캐릭터 선택 중") + (connected.has(owner.playerId) ? " · 접속 중" : " · 오프라인")
            : "참가 가능",
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
        element("strong", undefined, owner?.displayName ?? "빈자리"),
        seatStatus,
      );
      seats.append(item);
    }
    playersPanel.append(seats);

    const everyGuestClaimed = state.seats
      .filter((seat) => seat.playerId !== state.hostPlayerId)
      .every((seat) => Boolean(claimedMemberForPlayer(state, seat.playerId)));
    const canBegin = host && state.partyPrepared && state.lifecycle === "lobby"
      && state.partySlots.length >= state.seats.length && everyGuestClaimed;
    const begin = element(
      "button",
      "ui-button ui-button--primary session-primary",
      host ? "모험 시작" : "호스트가 시작하기를 기다리는 중",
    );
    begin.id = "begin-adventure";
    begin.type = "button";
    begin.disabled = !canBegin;
    begin.addEventListener("click", this.handlers.onBegin);
    const beginGate = element(
      "p",
      canBegin ? "party-gate" : "party-gate invalid",
      !state.partyPrepared
          ? "시작할 파티를 먼저 적용하세요."
          : state.partySlots.length < state.seats.length
            ? "참가자 수 이상의 캐릭터가 필요합니다."
            : !everyGuestClaimed
              ? "캐릭터 선택 중인 참가자를 기다리고 있습니다."
              : host
                ? "파티와 참가자 선택이 준비되었습니다."
                : "호스트가 시작하기를 기다리고 있습니다.",
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

  private renderResumeLobby(state: SessionCoreState, viewerPlayerId: string, control: ServerControlView): void {
    const previousFocus = this.screen.dataset.lobbyKind === "resume" && document.activeElement instanceof HTMLElement
      ? document.activeElement.id : "";
    const host = state.hostPlayerId === viewerPlayerId;
    const adventure = state.adventure!;
    const terminal = adventure.phase === "complete" || adventure.phase === "failed";
    const card = this.card(terminal ? "저장된 결과 확인 준비" : "모험 이어가기 준비", "저장된 파티로 이어갑니다. 친구는 새 초대 코드로 다시 참가해 캐릭터를 선택하세요.", !previousFocus);
    card.classList.add("resume-card");
    this.screen.dataset.lobbyKind = "resume";
    const definition = this.pack.adventures[adventure.adventureId]!;
    const encounter = adventure.currentEncounterId ? this.pack.scenarioSources[adventure.currentEncounterId]?.name : null;
    card.append(element("p", "resume-progress", `${phaseLabels[adventure.phase]} · 전투 ${String(adventure.completedEncounterIds.length)} / ${String(definition.encounterIds.length)} 완료${encounter ? " · " + encounter : ""}`),
      element("p", "session-description", `준비를 마치면 ${destination(adventure.phase)}으로 돌아갑니다.`));
    if (host) {
      const invite = element("div", "resume-invite");
      const label = element("label", undefined, "새 초대 코드");
      label.htmlFor = "invite-session-id";
      const code = element("input", "ui-input");
      code.id = "invite-session-id";
      code.value = state.sessionId;
      code.readOnly = true;
      code.addEventListener("focus", () => code.select());
      const copy = this.button("새 초대 코드 복사", "copy-session-id", () => {
        void (async () => {
          try {
            if (!navigator.clipboard) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(state.sessionId);
            if (code.isConnected) this.setStatus("새 초대 코드를 복사했습니다. 친구에게 공유하세요.");
          } catch {
            if (code.isConnected) { code.focus(); code.select(); this.setStatus("자동 복사에 실패했습니다. 선택된 초대 코드를 직접 복사하세요.", "error"); }
          }
        })();
      });
      invite.append(label, code, copy);
      card.append(invite);
    }
    const body = element("div", "resume-body");
    const players = element("section", "ui-panel ui-panel--workspace resume-players");
    players.append(element("h2", undefined, "참가자"));
    const connected = new Set(control.connectedPlayerIds);
    const seats = element("ol", "session-seats");
    for (const seatNumber of [1, 2, 3] as const) {
      const seat = state.seats.find(candidate => candidate.seat === seatNumber);
      const row = element("li", seat ? "occupied" : "open");
      row.dataset.seat = String(seatNumber);
      row.dataset.connected = String(Boolean(seat && connected.has(seat.playerId)));
      if (!seat) row.append(element("span", undefined, "참가 가능"));
      else {
        const isHost = seat.playerId === state.hostPlayerId;
        const memberId = isHost ? state.partySlots[0]?.memberId : claimedMemberForPlayer(state, seat.playerId);
        const slot = state.partySlots.find(candidate => candidate.memberId === memberId);
        const name = slot ? resolveSessionPartyDefinition(state, slot, this.pack)?.name : undefined;
        row.append(element("strong", undefined, seat.displayName + (seat.playerId === viewerPlayerId ? " (나)" : "")),
          element("small", undefined, `${isHost ? "호스트" : "게스트"} · ${connected.has(seat.playerId) ? "접속 중" : "오프라인"} · ${name ?? "캐릭터 선택 중"}`));
        if (host && !isHost && !connected.has(seat.playerId) && !memberId) {
          const remove = this.button("참가자 제거", "remove-" + seat.playerId, () => this.handlers.onRemoveOfflineGuest(seat.playerId));
          remove.classList.add("ui-button--danger", "session-seat-remove");
          remove.dataset.playerId = seat.playerId;
          remove.setAttribute("aria-label", seat.displayName + " 참가자 제거");
          row.append(remove);
        }
      }
      seats.append(row);
    }
    players.append(seats);
    body.append(players, this.savedPartyPanel(state, control, viewerPlayerId));
    card.append(body, element("p", "session-description", "선택되지 않은 캐릭터와 오프라인 참가자의 캐릭터는 호스트가 조작합니다. 호스트는 혼자서도 시작할 수 있습니다."));
    const resume = this.button(host ? terminal ? "저장된 결과 보기" : "모험 이어가기" : "호스트가 시작하기를 기다리는 중", "resume-adventure", this.handlers.onResume, true);
    resume.disabled = !host || !state.partyPrepared;
    card.append(resume, this.statusLine());
    if (previousFocus) {
      const focusTarget = this.screen.querySelector<HTMLElement>(`#${CSS.escape(previousFocus)}`)
        ?? (previousFocus.startsWith("claim-") ? this.screen.querySelector<HTMLElement>(`#${CSS.escape("resume-member-" + previousFocus.slice(6))}`) : null);
      focusTarget?.focus({ preventScroll: true });
    }
  }

  /** The saved composition is fixed; guests may only claim an available character. */
  private savedPartyPanel(state: SessionCoreState, control: ServerControlView, viewerPlayerId = state.hostPlayerId): HTMLElement {
    const root = element("section", "ui-panel ui-panel--workspace party-builder resume-party");
    root.dataset.partyFixed = "true";
    root.append(element("h2", undefined, "저장된 파티"));
    const list = element("div", "resume-characters");
    for (const slot of state.partySlots) {
      const member = state.adventure?.party.members[slot.memberId];
      const actor = resolveSessionPartyDefinition(state, slot, this.pack);
      const claimant = state.guestClaims.byMemberId[slot.memberId];
      const mine = claimant === viewerPlayerId;
      const available = slot.slot !== 1 && !claimant;
      const entry = element("article", "ui-panel ui-panel--workspace resume-character");
      entry.id = "resume-member-" + slot.memberId;
      entry.tabIndex = -1;
      entry.dataset.memberId = slot.memberId;
      entry.dataset.partySlot = String(slot.slot);
      entry.dataset.claimState = slot.slot === 1 ? "host" : mine ? "mine" : claimant ? "taken" : "available";
      const visual = actor ? this.catalog.actorVisual(actor.appearanceKey) : null;
      if (visual) {
        const portrait = element("span", "guest-character-art");
        portrait.setAttribute("aria-hidden", "true");
        Object.assign(portrait.style, this.catalog.domStandeeStyle(visual.front, 72));
        entry.append(portrait);
      }
      const controllerId = control.effectiveControllerByMemberId[slot.memberId];
      const controller = state.seats.find(seat => seat.playerId === controllerId);
      const claimantName = state.seats.find(seat => seat.playerId === claimant)?.displayName;
      const details = element("div", "resume-character-details");
      details.append(element("strong", undefined, actor?.name ?? slot.actorDefinitionId),
        element("small", undefined, "Lv " + String(member?.progression.level ?? 1)),
        element("small", undefined, slot.slot === 1 ? "호스트 캐릭터" : mine ? "내 캐릭터" : claimant ? `${claimantName ?? "다른 참가자"} 선택함` : "선택 가능"),
        element("small", undefined, `현재 조작: ${controller?.displayName ?? "호스트"}${controllerId === state.hostPlayerId ? " (호스트)" : ""}`));
      entry.append(details);
      if (mine) {
        entry.append(this.button("선택 해제", "release-" + slot.memberId, this.handlers.onReleaseCharacter));
      }
      if (viewerPlayerId !== state.hostPlayerId && available) {
        const select = this.button("선택", "claim-" + slot.memberId, () => this.handlers.onSelectCharacter(slot.memberId));
        select.setAttribute("aria-label", (actor?.name ?? slot.actorDefinitionId) + " 선택");
        entry.append(select);
      }
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
    if (!visible) this.partyBuilder.closeDetails();
    this.screen.hidden = !visible;
  }
}
