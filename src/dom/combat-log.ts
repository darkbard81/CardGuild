import type { CombatContent, CombatEvent } from "../game";

export interface CombatLogEntry {
  /** What the player needs to read: one action and what it did. */
  readonly summary: string;
  /** The maths behind it — rolls, costs, bookkeeping — folded away until asked for. */
  readonly details: readonly string[];
}

export type ActorNameLookup = (actorId: string) => string;

function actionName(content: CombatContent, actionId: string): string {
  return content.actions[actionId]?.name ?? actionId;
}

/** A line that stands on its own: it frames the actions rather than being one. */
function boundaryLine(event: CombatEvent, names: ActorNameLookup): string | null {
  switch (event.type) {
    case "COMBAT_STARTED":
      return `Encounter started · seed ${event.seed}`;
    case "TURN_STARTED":
      return `Round ${event.round} · ${names(event.actorId)} turn`;
    case "TURN_ENDED":
      return `${names(event.actorId)} ended the turn.`;
    case "REACTION_OPENED":
      return `Reaction window opened against ${names(event.sourceActorId)}.`;
    case "REACTION_PASSED":
      return `${names(event.actorId)} passed the reaction.`;
    case "COMBAT_ENDED":
      return `Combat ended: ${event.outcome}.`;
    default:
      return null;
  }
}

/** The headline of an action group. */
function actionHeadline(event: CombatEvent, names: ActorNameLookup, content: CombatContent): string | null {
  if (event.type === "ACTION_SPENT") return `${names(event.actorId)} used ${actionName(content, event.actionId)}`;
  if (event.type === "REACTION_USED") return `${names(event.actorId)} reacted with ${actionName(content, event.actionId)}`;
  return null;
}

/**
 * What an action did, phrased to sit after its headline. The acting actor is already
 * named there, so a clause about that same actor drops the subject.
 */
function resultClause(event: CombatEvent, names: ActorNameLookup, actorId: string | null): string | null {
  const subject = (id: string): string => (id === actorId ? "" : `${names(id)} `);
  switch (event.type) {
    case "DAMAGE_DEALT":
      return `${names(event.targetActorId)} took ${event.amount} ${event.damageType} damage (${event.remainingHp} HP)`;
    case "HP_RESTORED":
      return `${names(event.targetActorId)} recovered ${event.amount} HP (${event.remainingHp} HP)`;
    case "ACTOR_MOVED":
      return `${subject(event.actorId)}moved ${event.path.length} square${event.path.length === 1 ? "" : "s"} by ${event.movementMode}`;
    case "FACING_CHANGED":
      return `${subject(event.actorId)}now facing ${event.facing}`;
    case "CONDITION_APPLIED":
      return event.value === undefined
        ? `${subject(event.actorId)}gained ${event.condition}`
        : `${subject(event.actorId)}gained ${event.condition} ${event.value}`;
    case "CONDITION_VALUE_CHANGED":
      return `${subject(event.actorId)}now ${event.condition} ${event.value}`;
    case "CONDITION_REMOVED":
      return `${subject(event.actorId)}lost ${event.condition}`;
    case "SHIELD_RAISED":
      return `${subject(event.actorId)}raised a shield (AC +${event.bonus})`;
    case "EFFECT_CREATED":
      return `${subject(event.actorId)}created ${event.name}`;
    case "EFFECT_SUSTAINED":
      return `${subject(event.actorId)}sustained an effect`;
    case "EFFECT_EXPIRED":
      return `${subject(event.actorId)}let an effect expire`;
    case "OBJECT_INTERACTED":
      return `${subject(event.actorId)}operated ${event.objectId}`;
    case "ACTOR_DEFEATED":
      return `${names(event.actorId)} was defeated`;
    case "TERRAIN_CHANGED":
      return `${event.tileId} changed to ${event.traits.join(", ")}`;
    default:
      return null;
  }
}

/** The arithmetic: what was rolled against what, and what it cost. */
function detailLine(event: CombatEvent, names: ActorNameLookup, content: CombatContent): string | null {
  switch (event.type) {
    case "CHECK_ROLLED":
      return `${event.label}: d20 ${event.roll} + ${event.modifier} vs DC ${event.dc} → ${event.degree}.`;
    case "ACTION_SPENT":
      return `Cost ${event.amount} action${event.amount === 1 ? "" : "s"} · ${event.remaining} left.`;
    case "INITIATIVE_ROLLED":
      return `${names(event.actorId)} initiative ${event.roll} + ${event.modifier} = ${event.total}.`;
    case "CARD_PLAYED":
      return `${names(event.actorId)} played a tactical card.`;
    case "ACTION_LOCKED":
      return `${names(event.actorId)} cannot use ${actionName(content, event.actionId)} again this turn.`;
    case "DISCARD_RESHUFFLED":
      return `${names(event.actorId)} reshuffled the discard pile.`;
    default:
      return null;
  }
}

/**
 * One entry per action: the action and what it did on the line, the arithmetic behind it
 * folded underneath. Turn and encounter boundaries stay lines of their own, and anything
 * that happens outside an action — a Condition ticking away at turn start, say — becomes
 * its own entry rather than being swallowed by the previous one.
 */
export function buildCombatLog(
  history: readonly CombatEvent[],
  names: ActorNameLookup,
  content: CombatContent,
): readonly CombatLogEntry[] {
  const entries: CombatLogEntry[] = [];
  let headline: string | null = null;
  let actorId: string | null = null;
  let clauses: string[] = [];
  let details: string[] = [];

  const flush = (): void => {
    if (headline === null) {
      // Details with no action to belong to still have to reach the player.
      for (const line of details) entries.push({ summary: line, details: [] });
    } else {
      entries.push({
        summary: clauses.length > 0 ? `${headline} — ${clauses.join(" · ")}` : `${headline}.`,
        details,
      });
    }
    headline = null;
    actorId = null;
    clauses = [];
    details = [];
  };

  for (const event of history) {
    const boundary = boundaryLine(event, names);
    if (boundary !== null) {
      // Bookkeeping that arrived before any action — the initiative rolls, say — belongs
      // to the boundary it was leading up to, not to a line of its own.
      const carried = headline === null ? details : [];
      if (carried.length > 0) details = [];
      flush();
      entries.push({ summary: boundary, details: carried });
      continue;
    }
    const nextHeadline = actionHeadline(event, names, content);
    if (nextHeadline !== null) {
      flush();
      headline = nextHeadline;
      actorId = event.type === "ACTION_SPENT" || event.type === "REACTION_USED" ? event.actorId : null;
      const cost = detailLine(event, names, content);
      if (cost !== null) details.push(cost);
      continue;
    }
    const detail = detailLine(event, names, content);
    if (detail !== null) {
      details.push(detail);
      continue;
    }
    const clause = resultClause(event, names, actorId);
    if (clause === null) continue;
    if (headline === null) {
      entries.push({ summary: `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`, details });
      details = [];
      continue;
    }
    clauses.push(clause);
  }
  flush();
  return entries;
}
