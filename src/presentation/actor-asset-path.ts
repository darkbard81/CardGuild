import type { ActorDefinitionId } from "../game/types";

/**
 * One directory component of an actor's path: lowercase words joined by single hyphens.
 * Strict on purpose — it is what stops an empty, upper-cased or dot-relative segment from
 * reaching a filesystem path, and every shipped definition already reads this way.
 */
const ACTOR_PATH_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ActorSide = "front" | "back";

/** Both sides of a standee, in the order a two-sided source must author them. */
export const ACTOR_SIDES: readonly ActorSide[] = ["front", "back"];

/**
 * The whole of an actor's path contract, in one place, because the same identity has to
 * survive three separate destinations — the normalized PNG, the QC sheet and the runtime
 * WebP. Dropping the namespace at any one of them lets `hero.aerin` and `enemy.aerin`
 * land on the same file, and since the runtime export reads the processed PNG back, a
 * collision upstream silently ships one character wearing another's art.
 *
 * Every dotted segment becomes one directory, so a deeper namespace stays unambiguous:
 *
 *   hero.aerin              -> hero/aerin
 *   enemy.goblin-skirmisher -> enemy/goblin-skirmisher
 *   enemy.goblin.elite      -> enemy/goblin/elite
 */
export function actorPathSegments(definitionId: ActorDefinitionId): readonly string[] {
  const segments = definitionId.split(".");
  // A bare `aerin` has no namespace to keep it apart from anything else named aerin.
  if (segments.length < 2) {
    throw new Error(`Actor definition "${definitionId}" needs a namespace and a name.`);
  }
  for (const segment of segments) {
    if (!ACTOR_PATH_SEGMENT.test(segment)) {
      throw new Error(`Actor definition "${definitionId}" has a segment that is not a usable path component.`);
    }
  }
  return segments;
}

/** Where the browser asks for one side of a standee. */
export function runtimeActorHref(definitionId: ActorDefinitionId, side: ActorSide): string {
  return `/${["assets", "actors", ...actorPathSegments(definitionId), `${side}.webp`].join("/")}`;
}

/**
 * The same rule as a pattern, so a test asserting the shape of a request cannot drift
 * into a narrower contract than the generator above actually produces.
 */
const SEGMENT_SOURCE = "[a-z0-9]+(?:-[a-z0-9]+)*";
export const ACTOR_RUNTIME_HREF = new RegExp(
  `^/assets/actors/${SEGMENT_SOURCE}(?:/${SEGMENT_SOURCE})+/(?:front|back)\\.webp$`,
);

/**
 * Every actor path derives from the same segments, so one uniqueness check covers the
 * processed, QC and runtime destinations at once.
 */
export function assertDistinctActorPaths(definitionIds: readonly ActorDefinitionId[]): void {
  const seen = new Map<string, ActorDefinitionId>();
  for (const definitionId of definitionIds) {
    const key = actorPathSegments(definitionId).join("/");
    const clash = seen.get(key);
    if (clash !== undefined) {
      throw new Error(`Actor definitions "${clash}" and "${definitionId}" resolve to the same output path.`);
    }
    seen.set(key, definitionId);
  }
}
