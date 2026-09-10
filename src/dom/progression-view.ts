import { EXPERIENCE_PER_LEVEL } from "../adventure/progression";
import type { AdventureEvent, CharacterProgressionState } from "../adventure";

/**
 * The one place Level and EXP become pixels.
 *
 * The Adventure card and the Loadout sidebar both show the same character, so they must
 * show the same numbers in the same words; a second copy of this formatting is how the two
 * screens drift apart. Nothing here reads state of its own — every value is passed in from
 * the authoritative snapshot.
 */
export function progressionText(progression: CharacterProgressionState): string {
  return `Lv. ${String(progression.level)} · EXP ${String(progression.experience)} / ${String(EXPERIENCE_PER_LEVEL)}`;
}

/**
 * A labelled meter for one character's progress toward the next Level.
 *
 * The bar is a `progressbar` rather than decoration: a screen reader gets the character's
 * name, the EXP it stands at and the EXP the next Level costs, because the fill itself
 * carries none of that.
 */
export function progressionMeter(name: string, progression: CharacterProgressionState): HTMLElement {
  const meter = document.createElement("div");
  meter.className = "exp-meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-label", `${name} EXP`);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", String(EXPERIENCE_PER_LEVEL));
  meter.setAttribute("aria-valuenow", String(progression.experience));
  meter.setAttribute("aria-valuetext", `${name} · ${progressionText(progression)}`);
  const fill = document.createElement("span");
  fill.className = "exp-meter-fill";
  fill.style.width = `${String((progression.experience / EXPERIENCE_PER_LEVEL) * 100)}%`;
  meter.append(fill);
  return meter;
}

export interface GrowthEntry {
  readonly memberId: string;
  readonly amount: number;
  readonly fromLevel: number;
  readonly toLevel: number;
  readonly experience: number;
}

/** What one Encounter's victory did to the party, as the screens after it want to say it. */
export interface GrowthSummary {
  readonly encounterId: string;
  readonly entries: readonly GrowthEntry[];
}

/**
 * Fold a committed event batch into one summary, or nothing when the batch carried no
 * growth. Several Levels in one battle collapse into a single start → end pair, because a
 * player wants "Lv.1 → Lv.3", not two notices for one victory.
 *
 * Only `EXPERIENCE_GAINED` opens an entry: a `LEVEL_UP` without one would mean the server
 * published growth out of contract, and inventing an entry for it would hide that.
 */
export function summarizeGrowth(events: readonly AdventureEvent[]): GrowthSummary | null {
  const entries = new Map<string, GrowthEntry>();
  let encounterId = "";
  for (const event of events) {
    if (event.type === "EXPERIENCE_GAINED") {
      encounterId = event.encounterId;
      const existing = entries.get(event.memberId);
      entries.set(event.memberId, {
        memberId: event.memberId,
        amount: (existing?.amount ?? 0) + event.amount,
        fromLevel: existing?.fromLevel ?? event.previous.level,
        toLevel: event.next.level,
        experience: event.next.experience,
      });
      continue;
    }
    if (event.type !== "LEVEL_UP") continue;
    const existing = entries.get(event.memberId);
    if (existing) entries.set(event.memberId, { ...existing, toLevel: Math.max(existing.toLevel, event.level) });
  }
  return entries.size > 0 ? { encounterId, entries: [...entries.values()] } : null;
}

/** A summary and the snapshot that published it, which is what makes it de-duplicable. */
export interface GrowthNotice {
  readonly sessionId: string;
  readonly revision: number;
  readonly summary: GrowthSummary;
}

/** What a screen has to know about a snapshot to decide the notice's fate. */
export interface GrowthSnapshotFacts {
  readonly sessionId: string;
  readonly revision: number;
  readonly inCombat: boolean;
  /**
   * The Encounter the party most recently finished. A notice describes exactly one victory,
   * so this is what says whether it still describes the latest one.
   */
  readonly lastCompletedEncounterId: string | null;
}

/**
 * Fold one committed snapshot into the standing growth notice.
 *
 * The rules, in the order they apply:
 *
 * - A different session never inherits another one's notice.
 * - Walking into the next battle clears it: the notice belongs to the battle just won.
 * - A snapshot at or below the revision that produced the notice changes nothing, so a
 *   resync, a control-only snapshot or a plain re-render neither drops it nor re-announces
 *   it, and an out-of-order older view cannot retire a newer notice.
 * - A notice about an Encounter that is no longer the last one the party finished is
 *   dropped. Clearing on the next battle alone is not enough: a client that was away —
 *   a disconnected Guest, say — comes back to a resync carrying no events at all, having
 *   missed both the battle that would have cleared the notice and the victory that
 *   replaced it. Without this rule that client keeps announcing a two-battles-ago result
 *   next to the current EXP total.
 * - A batch carrying no growth otherwise leaves the standing notice alone, which is what
 *   keeps it up across the reward choice and a Loadout round trip.
 *
 * Nothing here reads durable state, and nothing writes any: a reload or a fresh Continue
 * replays no events, so it correctly starts with no notice at all.
 */
export function trackGrowthSummary(
  previous: GrowthNotice | null,
  snapshot: GrowthSnapshotFacts,
  events: readonly AdventureEvent[],
): GrowthNotice | null {
  const sameSession = previous && previous.sessionId === snapshot.sessionId ? previous : null;
  if (snapshot.inCombat) return null;
  // Judged before the Encounter check, so a repeat or an older view of the run is a
  // no-op rather than evidence that the notice is stale.
  if (sameSession && sameSession.revision >= snapshot.revision) return sameSession;
  const standing = sameSession && sameSession.summary.encounterId === snapshot.lastCompletedEncounterId
    ? sameSession
    : null;
  const summary = summarizeGrowth(events);
  return summary ? { sessionId: snapshot.sessionId, revision: snapshot.revision, summary } : standing;
}

/**
 * The victory notice. It is rendered from the summary alone, so a re-render of the same
 * screen repeats it without re-announcing anything, and a screen with no summary shows
 * nothing rather than a stale one.
 */
export function growthSummaryPanel(
  summary: GrowthSummary,
  nameOf: (memberId: string) => string,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "growth-summary";
  panel.dataset.encounterId = summary.encounterId;
  const heading = document.createElement("strong");
  heading.textContent = "전투 보상 · 성장";
  panel.append(heading);
  const list = document.createElement("ul");
  list.className = "growth-summary-list";
  for (const entry of summary.entries) {
    const row = document.createElement("li");
    row.dataset.memberId = entry.memberId;
    row.dataset.levelsGained = String(entry.toLevel - entry.fromLevel);
    const name = document.createElement("strong");
    name.textContent = nameOf(entry.memberId);
    const gain = document.createElement("span");
    gain.className = "growth-gain";
    gain.textContent = `EXP +${String(entry.amount)}`;
    row.append(name, gain);
    if (entry.toLevel > entry.fromLevel) {
      const levelUp = document.createElement("span");
      levelUp.className = "growth-level-up";
      // Several Levels in one battle read as one jump, which is what actually happened.
      levelUp.textContent = `Lv.${String(entry.fromLevel)} → Lv.${String(entry.toLevel)}`;
      row.append(levelUp);
    }
    const remaining = document.createElement("span");
    remaining.className = "growth-remaining";
    remaining.textContent = `EXP ${String(entry.experience)} / ${String(EXPERIENCE_PER_LEVEL)}`;
    row.append(remaining);
    list.append(row);
  }
  panel.append(list);
  return panel;
}
