import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Production code cannot import builders, harnesses or browser reporters.
const NO_TEST_FIXTURES = {
  group: ["**/tests/**", "tests/**"],
  message: "Production code must not import test fixtures. Move the data into src/, or keep the code in a test.",
};

/**
 * The rules layer decides movement, Fly and line of sight from tile traits alone.
 * Presentation is on this list so an asset's size, id or pixels can never reach a legality
 * decision: a taller wall is a different picture, not a different rule.
 */
const NO_PRESENTATION = {
  group: ["pixi.js", "../pixi/**", "../dom/**", "../app/**", "../presentation/**"],
  message: "The rules layer decides from content and state alone, never from how something is drawn.",
};

const NO_HOST = {
  group: ["ajv", "node:*"],
  message: "The rules layer runs in the browser and on the server, so it cannot depend on either.",
};

const NO_CONTENT = {
  group: ["../content/**"],
  message: "GameCore is handed its content; it never selects or loads a pack itself.",
};

export default defineConfig(
  { ignores: ["dist/**", "dist-server/**"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["src/**/*.ts", "tools/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_TEST_FIXTURES] }],
    },
  },
  {
    files: ["src/game/**/*.ts", "src/adventure/**/*.ts", "src/loadout/**/*.ts", "src/session/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_TEST_FIXTURES, NO_PRESENTATION, NO_HOST] }],
    },
  },
  {
    files: ["src/game/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [NO_TEST_FIXTURES, NO_PRESENTATION, NO_HOST, NO_CONTENT] },
      ],
    },
  },
);
