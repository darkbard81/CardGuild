import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DATABASE_PATH,
  DEV_DATABASE_PATH,
  assertDevDatabase,
  isDevDatabase,
  resolveDatabasePath,
} from "./database-path";

describe("M9-2 database path", () => {
  it("resolves the configured path, falling back to the deployed default", () => {
    expect(resolveDatabasePath({})).toBe(path.resolve(process.cwd(), DEFAULT_DATABASE_PATH));
    expect(resolveDatabasePath({ CARDGUILD_DB_PATH: "/srv/cardguild/live.sqlite" }))
      .toBe("/srv/cardguild/live.sqlite");
  });

  it("keeps the development database apart from the deployed default", () => {
    // A shared path is what would let development seeding reach a real database.
    expect(DEV_DATABASE_PATH).not.toBe(DEFAULT_DATABASE_PATH);
    expect(isDevDatabase(resolveDatabasePath({ CARDGUILD_DB_PATH: DEV_DATABASE_PATH }))).toBe(true);
    expect(isDevDatabase(resolveDatabasePath({ CARDGUILD_DB_PATH: `./${DEV_DATABASE_PATH}` }))).toBe(true);
  });
});

describe("M9-2 development seeding guard", () => {
  it("allows seeding only into the development database", () => {
    expect(() => assertDevDatabase(resolveDatabasePath({ CARDGUILD_DB_PATH: DEV_DATABASE_PATH }))).not.toThrow();
  });

  it("refuses the deployed default, which is what an unset CARDGUILD_DB_PATH falls back to", () => {
    // The development accounts carry passwords committed to a public repository, so this
    // is the case that must fail: a deployment that simply never set the variable.
    expect(() => assertDevDatabase(resolveDatabasePath({}))).toThrow(/may only be seeded into/);
  });

  it("refuses any other database, whatever the environment claims to be", () => {
    for (const databasePath of ["/srv/cardguild/live.sqlite", ".data/cardguild.sqlite", "cardguild.dev.sqlite"]) {
      expect(() => assertDevDatabase(resolveDatabasePath({ CARDGUILD_DB_PATH: databasePath }))).toThrow();
    }
    // NODE_ENV is not consulted at all: it cannot open the gate and cannot close it.
    expect(() => assertDevDatabase(resolveDatabasePath({ CARDGUILD_DB_PATH: DEV_DATABASE_PATH, NODE_ENV: "production" })))
      .not.toThrow();
  });
});
