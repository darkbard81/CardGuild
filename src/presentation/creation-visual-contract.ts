import type { CharacterCreationPreset } from "../character/member";

/** Each authored gender/Class owns a distinct two-sided visual. Instances share these keys. */
export function assertCreationVisualCoverage(
  presets: Readonly<Record<string, CharacterCreationPreset>>,
  visuals: Readonly<Record<string, { readonly front?: string; readonly back?: string }>>,
): void {
  const templates = new Set<string>();
  const keys = new Set<string>();
  const assets = new Set<string>();
  for (const preset of Object.values(presets)) {
    if (templates.has(preset.actorDefinitionId)) throw new Error(`Duplicate creation template ${preset.actorDefinitionId}.`);
    templates.add(preset.actorDefinitionId);
    for (const gender of ["male", "female"] as const) {
      const key = preset.appearance[gender];
      if (keys.has(key)) throw new Error(`Duplicate creation visual ${key}.`);
      keys.add(key);
      const visual = visuals[key];
      if (!visual?.front || !visual.back) throw new Error(`Creation variant ${preset.id}/${gender} is missing front/back: ${key}.`);
      for (const side of ["front", "back"] as const) {
        const asset = visual[side]!;
        if (asset !== `actor.${key}.${side}` || assets.has(asset)) throw new Error(`Invalid creation visual mapping ${key}/${side}.`);
        assets.add(asset);
      }
    }
  }
}
