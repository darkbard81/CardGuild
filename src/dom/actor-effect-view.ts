import { scaleConditionModifiers } from "../game/statistics";
import type { ActorState, CombatContent, ConditionInstance, ResolvedStatistic } from "../game";
import { conditionEffects } from "../game/condition-effects";

const signed = (value: number): string => value >= 0 ? `+${value}` : String(value);

/** Shared display contract for the sheet and compact HUD, using the same stat resolver. */
export function statisticPresentation(actor: ActorState, resolve: (actor: ActorState) => ResolvedStatistic) {
  const current = resolve(actor);
  const baseline = resolve({ ...actor, conditions: [], shieldRaised: false });
  const delta = current.value - baseline.value;
  const sources = current.sources.filter(source => source.applied && source.value !== 0 &&
    (delta === 0 || !baseline.sources.some(base => base.applied && base.kind === source.kind && base.sourceId === source.sourceId && base.label === source.label && base.value === source.value)));
  const reasons = sources.map(source => `${source.label} ${signed(source.value)}`);
  return { value: current.value, delta,
    explanation: `${baseline.value} → ${current.value} (${signed(delta)})${reasons.length ? ` · ${reasons.join(" · ")}` : ""}` };
}

export function statisticButton(label: string, text: string, result: ReturnType<typeof statisticPresentation>, onInspect: (text: string, button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button"; button.className = "ui-stat-change";
  button.dataset.change = result.delta < 0 ? "decrease" : result.delta > 0 ? "increase" : "neutral";
  button.textContent = text;
  button.title = `${label} · ${result.explanation}`;
  button.setAttribute("aria-label", button.title);
  if (result.delta !== 0) {
    const direction = document.createElement("small"); direction.className = "ui-stat-change__direction";
    direction.textContent = result.delta < 0 ? "↓" : "↑"; button.append(direction);
  }
  button.addEventListener("click", () => onInspect(button.title, button));
  return button;
}

export function conditionPresentation(condition: ConditionInstance, content: CombatContent) {
  const definition = content.conditions[condition.id];
  const label = `${definition?.name ?? condition.id}${condition.value === undefined ? "" : ` ${condition.value}`}`;
  const effects = conditionEffects(condition);
  const modifiers = definition ? scaleConditionModifiers(definition, condition) : [];
  const harmful = effects.some(effect => effect.blocksMovement || (effect.modifier?.value ?? 0) < 0) || modifiers.some(modifier => modifier.value < 0);
  const beneficial = modifiers.some(modifier => modifier.value > 0);
  const tone = harmful && !beneficial ? "harmful" : beneficial && !harmful ? "beneficial" : "neutral";
  const description = definition ? modifiers.map(modifier => `${modifier.label} ${signed(modifier.value)} · ${modifier.type}`).join(" · ") : "";
  return { label, effects, tone, explanation: `${label} · ${effects.length ? effects.map(effect => effect.label).join(" · ") : description || "현재 적용 중인 상태입니다."}` };
}
