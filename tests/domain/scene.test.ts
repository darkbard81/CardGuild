import { assertScene } from "../../src/scene/validation";
import { describe, expect, it } from "vitest";
import { ScenePlayer } from "../../src/scene/player";
import { FIRST_BATTLE_SCENE, SCENE_CATALOG, WELCOME_SCENE } from "../../src/scene/catalog";
import type { SceneResult } from "../../src/scene/types";

describe("D-SCENE independent presentation playback", () => {
  it("plays narration without characters and rejects stale page advances and repeated completion", () => {
    const pages: string[] = [], results: SceneResult[] = [];
    let revision = 0;
    const player = new ScenePlayer({ id: "narration", lines: [{ text: "First" }, { text: "Second" }] },
      (line, _index, token) => { pages.push(line.text); revision = token; }, result => results.push(result));
    player.start(); player.start();
    const first = revision;
    player.next(first); player.next(first);
    expect(pages).toEqual(["First", "Second"]);
    expect(results).toEqual([]);
    player.next(revision); player.next(revision); player.skip(); player.cancel(); player.start();
    expect(results).toEqual(["completed"]);
  });
  it.each(["skip", "cancel"] as const)("%s settles once and stops injected audio", action => {
    const results: SceneResult[] = [], sounds: unknown[] = [];
    const cue = { bgm: "guild", voice: "hello", sfx: ["bell"] };
    const player = new ScenePlayer({ id: "audio", lines: [{ text: "Hello", audio: cue }] }, () => {},
      result => results.push(result), { apply: value => sounds.push(value), stop: () => { sounds.push("stop"); } });
    player.start(); player[action](); player[action](); player.next(1);
    expect(sounds).toEqual([cue, "stop"]);
    expect(results).toEqual([action === "skip" ? "skipped" : "cancelled"]);
  });
  it("audio failure cannot block the visual lifecycle", () => {
    let shown = false, finished = false;
    const player = new ScenePlayer({ id: "silent", lines: [{ text: "Read me", audio: { voice: "missing" } }] },
      () => { shown = true; }, () => { finished = true; }, { apply: () => { throw Error("unavailable"); }, stop: () => { throw Error("unavailable"); } });
    player.start(); player.next(1);
    expect(shown && finished).toBe(true);
  });
  it("validates authored references and supports speakerless lines", () => {
    expect(() => assertScene(WELCOME_SCENE, SCENE_CATALOG)).not.toThrow();
    expect(() => assertScene(FIRST_BATTLE_SCENE, SCENE_CATALOG)).not.toThrow();
    expect(() => assertScene({ id: "narration", lines: [{ text: "Hello" }] }, { speakers: {}, faceSets: {} })).not.toThrow();
    expect(() => assertScene({ id: "bad", lines: [{ text: "Hello", speakerId: "minerva", expressionId: "missing" }] }, SCENE_CATALOG)).toThrow();
    expect(() => assertScene({ id: "bad", lines: [{ text: "Hello", expressionId: "welcome" }] }, SCENE_CATALOG)).toThrow();
    expect(() => new ScenePlayer({ id: "empty", lines: [] }, () => {}, () => {})).toThrow();
  });
});
