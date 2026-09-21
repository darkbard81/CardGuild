import { PRODUCTION_CONTENT } from "../../src/content/production-content";
import { createSessionCoreState, dispatchSessionIntent } from "../../src/session";
import { dispatchCombatCommand } from "../../src/game/engine";
import { chooseAiCommand } from "../../src/game/ai";
import { chooseHeroCommand, chooseReactionCommand } from "./hero-policy";

// Bounded solo starter evidence against the currently shipped first encounter.
// This is not a win-rate estimate or a substitute for #67's new Tutorial validation.
const context = { pack: PRODUCTION_CONTENT.pack, adventureId: PRODUCTION_CONTENT.adventureId };
const rows = [];
for (const preset of Object.values(context.pack.creationPresets ?? {})) {
  for (const seed of [1, 2, 3]) {
    const lobby = createSessionCoreState({ sessionId: "starter-audit", playerId: "host", displayName: "Audit", adventureSeed: seed }, context);
    const control = { connectedPlayerIds: ["host"], effectiveControllerByMemberId: {} };
    const created = dispatchSessionIntent(lobby, "host", { type: "create-character", name: "Audit", gender: "male", creationPresetId: preset.id }, context, control);
    if (!created.accepted) throw new Error(`${preset.id}: ${created.error}`);
    const started = dispatchSessionIntent(created.state, "host", { type: "start-encounter" }, context, control);
    if (!started.accepted || !started.state.combat) throw new Error(`${preset.id}: could not start`);
    let combat = started.state.combat;
    let commands = 0;
    for (; commands < 300 && !combat.outcome; commands++) {
      const active = combat.actors[combat.turn.activeActorId]!;
      const command = combat.pendingReaction ? chooseReactionCommand(combat)
        : active.team === "heroes" ? chooseHeroCommand(combat, context.pack.combatContent)
          : chooseAiCommand(combat, context.pack.combatContent);
      if (!command) throw new Error(`${preset.id}, seed=${seed}: no legal policy command`);
      const result = dispatchCombatCommand(combat, command, context.pack.combatContent);
      if (!result.accepted) throw new Error(`${preset.id}, seed=${seed}, command=${command.type}: rejected`);
      combat = result.state;
    }
    rows.push({ preset: preset.id, seed, encounter: combat.scenarioId, outcome: combat.outcome ?? "stalled", commands,
      remainingHp: Object.values(combat.actors).filter(actor => actor.team === "heroes").map(actor => actor.hp) });
  }
}
process.stdout.write(`${JSON.stringify({ contentIdentity: PRODUCTION_CONTENT.contentIdentity, policy: "existing greedy hero policy; first encounter only; seeds 1-3", rows }, null, 2)}\n`);
