import { tutorialWin, recruitedParty, tutorialAct } from "./tutorial";
import type { SessionCoreState } from "../../src/session";
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
