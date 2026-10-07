import { tutorialWin, recruitedParty, tutorialAct, tutorialContext } from "./tutorial";
import { dispatchServerCombatCommand, type SessionCoreState } from "../../src/session";
export const chapterReady = (seed = 60): SessionCoreState => tutorialWin(tutorialWin(recruitedParty(seed)));
/** Battle resolution belongs to the domain; reward/transport tests set only that precondition. */
export function chapterReward(state: SessionCoreState): SessionCoreState { return tutorialWin(state); }
export function claimChapterReward(state: SessionCoreState): SessionCoreState {
  return tutorialAct(state, { type: "choose-reward", rewardId: state.adventure!.pendingReward!.rewardId, choiceIndex: 0 });
}
export function chapterAt(index: number): SessionCoreState {
  let state = chapterReady();
  for (let i = 0; i < index; i++) state = claimChapterReward(chapterReward(state));
  return state;
}
export const chapterComplete = () => claimChapterReward(chapterReward(chapterAt(3)));

/** Real legal commands place the first hero beside the gate for focused UI/storage checks. */
export function gateObjectiveCheckpoint(): SessionCoreState {
  let session = tutorialAct(chapterAt(2), { type: "start-encounter" });
  for (let turn = 0; session.combat!.turn.activeActorId !== "party.hero-1" && turn < 8; turn++) {
    const actor = session.combat!.actors[session.combat!.turn.activeActorId]!;
    const result = dispatchServerCombatCommand(session, { type: "end-turn", id: `gate-setup-${turn}`, sequence: -1, actorId: actor.id, facing: actor.facing }, tutorialContext);
    if (!result.accepted) throw new Error(result.error);
    session = result.state;
  }
  return tutorialAct(session, { type: "use-action", action: { kind: "basic", id: "stride" }, target: { kind: "tile", position: { x: 8, y: 9 } } });
}
