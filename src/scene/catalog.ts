import minerva from "./minerva-faces.json";
import type { SceneCatalog, SceneDefinition } from "./types";

export const SCENE_CATALOG: SceneCatalog = {
  speakers: { minerva: { name: "미네르바", faceSetId: "minerva" } },
  faceSets: { minerva },
};
export const WELCOME_SCENE: SceneDefinition = {
  id: "guild-welcome",
  lines: [
    { speakerId: "minerva", expressionId: "welcome", text: "카드길드에 오신 것을 환영해요! 저는 길드 접수원 미네르바예요." },
    { speakerId: "minerva", expressionId: "explain", text: "모험을 시작하기 전에 길드 등록부터 해볼까요? 이름과 성별, 그리고 당신에게 어울리는 클래스를 정해주세요." },
    { speakerId: "minerva", expressionId: "cheer", text: "어떤 모험가가 되실지 기대되네요. 준비되셨다면 시작해 볼까요?" },
  ],
};

export const FIRST_BATTLE_SCENE: SceneDefinition = {
  id: "guild-first-battle-briefing",
  lines: [
    { speakerId: "minerva", expressionId: "welcome", text: "첫 전투는 길드의 연습 상대인 슬라임과 함께할 거예요. 서두르지 말고, 모험가님의 힘을 하나씩 익혀보세요." },
    { speakerId: "minerva", expressionId: "explain", text: "처음에는 무기로 사용하는 공격 카드 한 장과, 클래스에 맞는 준비 카드 한 장이 주어져요. 기본 공격과 이동은 카드 없이도 할 수 있답니다." },
    { speakerId: "minerva", expressionId: "explain", text: "자기 턴에는 행동을 세 번 할 수 있어요. 카드마다 필요한 행동 수가 다르니 내용을 확인해보세요. 턴을 마칠 때는 바라볼 방향도 골라주세요." },
    { speakerId: "minerva", expressionId: "firm", text: "이번 연습전에서는 길드의 보호로 HP가 1보다 낮아지지 않아요. 이 보호는 길드의 세 연습전에만 적용된다는 점을 기억해주세요." },
    { speakerId: "minerva", expressionId: "cheer", text: "실수해도 괜찮아요. 무기와 카드를 직접 사용해보면서 익혀보세요. 준비되셨다면 시작해볼까요?" },
  ],
};

export const PRONE_RECOVERY_SCENE: SceneDefinition = {
  id: "guild-prone-recovery",
  lines: [
    { speakerId: "minerva", expressionId: "surprise", text: "넘어졌군요! Prone 상태에서는 Off-Guard가 되어 AC가 2 낮아져요. 이번 상태 대응 훈련도 길드 보호로 HP가 1 아래로 내려가지 않으니 안심하세요." },
    { speakerId: "minerva", expressionId: "explain", text: "이동하려면 먼저 일어나야 해요. 자기 캐릭터가 있는 칸을 선택해서 Ring Menu를 열어보세요." },
    { speakerId: "minerva", expressionId: "cheer", text: "Ring에서 Stand를 선택하면 행동 하나를 사용해 일어날 수 있어요. 대화를 마쳐도 넘어진 상태는 그대로랍니다. 직접 일어난 다음 남은 행동으로 전투를 계속해보세요!" },
  ],
};

export const FLANKING_TRAINING_SCENE: SceneDefinition = {
  id: "guild-flanking-training",
  lines: [
    { speakerId: "minerva", expressionId: "welcome", text: "이번에는 Aerin과 함께 싸워요. 두 사람 모두 길드 보호로 HP가 1 아래로 내려가지 않아요. 이 훈련 다음 전투부터는 보호가 사라져요." },
    { speakerId: "minerva", expressionId: "explain", text: "두 사람이 적의 서로 반대편에서 근접 무기나 맨손으로 위협하면 협공, Flanking이 돼요. 적을 향해 서서 안드로이드를 사이에 두도록 움직여보세요." },
    { speakerId: "minerva", expressionId: "explain", text: "협공하면 지난 훈련에서 봤던 Off-Guard가 되어 적의 AC가 2 낮아져요. 이번 안드로이드는 협공하지 않은 공격의 피해를 전부 무효화해요. 주문 피해도 같아요. 뒤에서 공격하거나 넘어뜨리는 것만으로는 부족하답니다." },
    { speakerId: "minerva", expressionId: "cheer", text: "공격하기 전에 미리보기의 Off-Guard −2, Flanking, 협공 아군 이름을 확인해보세요. 위치를 바꾸면 협공도 풀릴 수 있어요. 두 사람의 위치와 방향을 함께 살펴보세요!" },
  ],
};
