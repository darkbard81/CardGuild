import type { CompiledContentPack } from "../content";
import type { PartyMemberState } from "../adventure";
import { resolvePartyMemberDefinition, type ResolvedPartyMemberDefinition } from "../character/member";
import type { AssetCatalog } from "../presentation";
import type { ServerControlView } from "../protocol";
import { coopAdmissionRemaining, coopRemovedPlayers, isCoopPreparation, waitingGuests, type SessionCoreState, type SessionIntent } from "../session";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text) result.textContent = text;
  return result;
}

/** One preparation contract, shared by live preparation and saved-combat resume. */
export class CoopPreparationUi {
  public readonly root = node("section");
  private current?: { state: SessionCoreState; viewer: string; control: ServerControlView };
  private draft?: string;
  private pending = false;
  private message = "";
  private awaitingError = false;
  private confirmation?: { label: string; intent: SessionIntent };

  public constructor(private readonly pack: CompiledContentPack, private readonly catalog: AssetCatalog,
    private readonly send: (intent: SessionIntent, settled: (accepted: boolean) => void) => boolean,
    private readonly inspect: (definition: ResolvedPartyMemberDefinition, member: PartyMemberState) => void) {
    this.root.className = "ui-panel coop-preparation";
    this.root.setAttribute("aria-label", "Co-op 준비");
  }

  public reportError(message: string): void {
    if (!this.awaitingError) return;
    this.awaitingError = false; this.message = message; this.redraw();
  }
  private redraw(): void { if (this.current) this.render(this.current.state, this.current.viewer, this.current.control); }
  private request(intent: SessionIntent): void {
    if (this.pending) return;
    this.awaitingError = false; this.pending = true; this.message = "서버에 적용 중…"; this.confirmation = undefined; this.redraw();
    const sent = this.send(intent, accepted => {
      this.pending = false; this.awaitingError = !accepted;
      this.message = accepted ? "적용되었습니다." : "적용하지 못했습니다. 최신 목록을 확인하고 다시 시도하세요.";
      this.redraw();
    });
    if (!sent) { this.pending = false; this.message = "연결 상태를 확인하고 다시 시도하세요."; this.redraw(); }
  }
  private button(label: string, id: string, action: () => void, disabled = false): HTMLButtonElement {
    const button = node("button", label); button.type = "button"; button.className = "ui-button";
    button.dataset.coopAction = id; button.disabled = this.pending || disabled;
    button.addEventListener("click", action); return button;
  }
  private confirm(label: string, intent: SessionIntent): void { this.confirmation = { label, intent }; this.redraw(); }

  public render(state: SessionCoreState, viewer: string, control: ServerControlView): HTMLElement {
    if (this.current?.state.sessionId !== state.sessionId) { this.draft = undefined; this.confirmation = undefined; this.message = ""; }
    const focus = this.root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.coopAction : undefined;
    this.current = { state, viewer, control };
    this.root.replaceChildren(); this.root.hidden = !isCoopPreparation(state);
    if (this.root.hidden) { this.confirmation = undefined; return this.root; }
    this.root.setAttribute("aria-busy", String(this.pending));
    const host = viewer === state.hostPlayerId;
    this.root.append(node("h2", host ? "동료 Co-op 지정" : "조작할 동료 선택"));
    const members = Object.values(state.adventure!.party.members).sort((a, b) => a.seat - b.seat);
    const list = node("div"); list.className = "coop-members";
    for (const member of members) {
      const allowed = state.coopAllowedMemberIds.includes(member.id);
      if (!host && !allowed) continue;
      const definition = resolvePartyMemberDefinition(member, this.pack);
      if (!definition) continue;
      const claimant = state.guestClaims.byMemberId[member.id];
      const mine = claimant === viewer;
      const guest = state.seats.find(seat => seat.playerId === claimant);
      const connected = !!claimant && control.connectedPlayerIds.includes(claimant);
      const row = node("article"); row.className = "coop-member"; row.dataset.coopMember = member.id;
      const art = this.catalog.actorVisual(definition.appearanceKey);
      if (art) { const portrait = node("span"); portrait.setAttribute("aria-hidden", "true"); Object.assign(portrait.style, this.catalog.domStandeeStyle(art.front, 64)); row.append(portrait); }
      const details = node("div");
      const companion = Object.values(this.pack.companions ?? {}).find(item => item.actorDefinitionId === member.actorDefinitionId);
      const equipment = Object.values(member.loadout.equipment).map(id => this.pack.combatContent.equipment[id]?.name ?? id).join(" · ");
      details.append(node("strong", definition.name), node("p", `Lv ${String(member.progression.level)} · ${companion?.description ?? definition.traits.map(trait => this.pack.combatContent.traits[trait.id]?.name ?? trait.id).join(" · ")}`), node("p", equipment),
        node("p", member.seat === 1 ? "주인공 · Host 전용" : guest ? `${guest.displayName} · ${connected ? "접속 중" : "오프라인 · Host 조작"}${mine && !this.pending ? " · 내 동료" : ""}` : allowed ? "선택 가능 · 현재 Host 조작" : "Host 조작"));
      row.append(details, this.button(`${definition.name} 정보`, `inspect-${member.id}`, () => this.inspect(definition, member)));
      if (host && member.seat !== 1) {
        row.append(this.button(`${definition.name} Co-op ${allowed ? "해제" : "허용"}`, `allow-${member.id}`, () => {
          const memberIds = allowed ? state.coopAllowedMemberIds.filter(id => id !== member.id) : [...state.coopAllowedMemberIds, member.id];
          const intent: SessionIntent = { type: "set-coop-allowed", memberIds, revokeGuests: true };
          if (coopRemovedPlayers(state, memberIds).length) this.confirm("조작권을 회수하면 해당 Guest의 참가와 재접속이 종료됩니다.", intent);
          else this.request({ ...intent, revokeGuests: false });
        }));
      } else if (!host) {
        row.append(this.button(mine ? "선택 해제" : `${definition.name} 선택`, `choose-${member.id}`, () => {
          if (mine) this.request({ type: "release-character" }); else { this.draft = member.id; this.message = "선택 확정을 누르면 조작권을 요청합니다."; this.redraw(); }
        }, !!claimant && !mine));
        if (claimant && !mine) row.append(node("small", "다른 Guest가 선택한 동료입니다."));
        if (this.draft === member.id && !mine && !claimant) row.append(this.button(`${definition.name} 선택 확정`, `confirm-${member.id}`, () => this.request({ type: "select-character", memberId: member.id })));
      }
      list.append(row);
    }
    this.root.append(list);
    if (host) {
      if (members.length < 2) this.root.append(node("p", "동료가 합류하면 Co-op을 허용할 수 있습니다."));
      if (state.coopAllowedMemberIds.length && coopAdmissionRemaining(state) > 0) {
        const label = node("label", "초대 코드"); label.htmlFor = "coop-session-key";
        const code = node("input"); code.className = "ui-input"; code.id = "coop-session-key"; code.value = state.sessionId; code.readOnly = true;
        code.addEventListener("focus", () => code.select());
        this.root.append(label, code, this.button("초대 코드 복사", "copy-key", () => {
          void navigator.clipboard?.writeText(state.sessionId).then(() => { this.message = "초대 코드를 복사했습니다."; this.redraw(); }, () => { code.focus(); code.select(); this.message = "선택된 초대 코드를 직접 복사하세요."; });
          if (!navigator.clipboard) { code.focus(); code.select(); }
        }));
      } else this.root.append(node("p", state.coopAllowedMemberIds.length ? "공개한 동료의 참가 자리가 모두 예약되었습니다." : "Co-op 동료를 허용하면 초대 코드가 표시됩니다."));
      const waiting = waitingGuests(state, control);
      if (waiting.length) this.root.append(node("p", `${waiting.map(seat => seat.displayName).join(", ")} 동료 선택 대기 중 · 선택 후 출전할 수 있습니다.`));
      this.root.append(this.button("단독으로 진행", "solo", () => {
        const intent: SessionIntent = { type: "proceed-solo" };
        if (state.seats.length > 1) this.confirm("모든 Guest의 참가를 종료하고 단독으로 진행합니다. 출전에 실패하면 참가 상태는 유지됩니다.", intent);
        else this.request(intent);
      }));
      if (state.coopAllowedMemberIds.length) this.root.append(this.button("Co-op 종료 · 조작권 회수", "end-coop", () => this.confirm(
        "Co-op을 종료하고 모든 동료를 Host가 조작합니다. 준비 화면에 머물며 장비·성장을 정리할 수 있습니다.", { type: "set-coop-allowed", memberIds: [], revokeGuests: true })));
    } else this.root.append(this.button("참가 나가기", "leave", () => this.request({ type: "leave-preparation" })));
    if (this.confirmation) {
      const confirmation = this.confirmation;
      const panel = node("section"); panel.setAttribute("aria-label", "Co-op 변경 확인");
      panel.append(node("p", confirmation.label), this.button("취소", "cancel", () => { this.confirmation = undefined; this.redraw(); }),
        this.button(confirmation.intent.type === "proceed-solo" ? "단독 진행 확인" : "조작권 회수 확인", "confirm-revoke", () => this.request(confirmation.intent)));
      this.root.append(panel);
    }
    const status = node("p", this.message); status.setAttribute("role", "status"); this.root.append(status);
    if (focus) this.root.querySelector<HTMLElement>(`[data-coop-action="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
    return this.root;
  }
}
