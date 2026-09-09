import { describe, expect, it } from "vitest";

import {
  ACTOR_RUNTIME_HREF,
  actorPathSegments,
  assertDistinctActorPaths,
  runtimeActorHref,
} from "./actor-asset-path";

describe("actor path segments", () => {
  it("keeps every dotted segment as its own directory component", () => {
    expect(actorPathSegments("hero.aerin")).toEqual(["hero", "aerin"]);
    expect(actorPathSegments("enemy.goblin-skirmisher")).toEqual(["enemy", "goblin-skirmisher"]);
    // A deeper namespace stays supported rather than being flattened into the leaf.
    expect(actorPathSegments("enemy.goblin.elite")).toEqual(["enemy", "goblin", "elite"]);
  });

  it("refuses an ID that cannot safely become a path", () => {
    expect(() => actorPathSegments("aerin")).toThrow(/needs a namespace and a name/);
    expect(() => actorPathSegments("hero..aerin")).toThrow(/not a usable path component/);
    expect(() => actorPathSegments("hero.")).toThrow(/not a usable path component/);
    expect(() => actorPathSegments("hero.Aerin")).toThrow(/not a usable path component/);
    expect(() => actorPathSegments("hero.aerin-")).toThrow(/not a usable path component/);
    expect(() => actorPathSegments("hero./etc/passwd")).toThrow(/not a usable path component/);
  });
});

describe("runtime actor href", () => {
  it("names both sides under the full namespace", () => {
    expect(runtimeActorHref("hero.aerin", "front")).toBe("/assets/actors/hero/aerin/front.webp");
    expect(runtimeActorHref("hero.aerin", "back")).toBe("/assets/actors/hero/aerin/back.webp");
    expect(runtimeActorHref("enemy.goblin-skirmisher", "front"))
      .toBe("/assets/actors/enemy/goblin-skirmisher/front.webp");
    expect(runtimeActorHref("enemy.goblin.elite", "back"))
      .toBe("/assets/actors/enemy/goblin/elite/back.webp");
  });

  it("matches the pattern the tests assert requests against, at every namespace depth", () => {
    // The generator and the request-shape assertion have to be the same contract, or a
    // deeper namespace would ship fine and fail only in a test.
    for (const definitionId of ["hero.aerin", "enemy.goblin-skirmisher", "enemy.goblin.elite"]) {
      for (const side of ["front", "back"] as const) {
        expect(runtimeActorHref(definitionId, side)).toMatch(ACTOR_RUNTIME_HREF);
      }
    }
    expect("/assets/actors/aerin/front.webp").not.toMatch(ACTOR_RUNTIME_HREF);
    expect("/assets/m3-atlas.webp").not.toMatch(ACTOR_RUNTIME_HREF);
    expect("/assets/actors/hero/aerin/east.webp").not.toMatch(ACTOR_RUNTIME_HREF);
  });
});

describe("path collisions across namespaces", () => {
  it("keeps the same leaf name in two namespaces apart", () => {
    // The collision this whole helper exists to prevent: the runtime export reads the
    // processed PNG back, so two actors sharing a processed path ship the same art.
    expect(runtimeActorHref("hero.aerin", "front")).not.toBe(runtimeActorHref("enemy.aerin", "front"));
    expect(actorPathSegments("hero.aerin")).not.toEqual(actorPathSegments("enemy.aerin"));
    expect(() => assertDistinctActorPaths(["hero.aerin", "enemy.aerin"])).not.toThrow();
  });

  it("names both sides of a genuine clash", () => {
    expect(() => assertDistinctActorPaths(["hero.aerin", "enemy.goblin-brute", "hero.aerin"]))
      .toThrow(/"hero\.aerin" and "hero\.aerin" resolve to the same output path/);
  });
});
