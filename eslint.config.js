import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    // The rules layer decides movement, Fly and line of sight from tile traits alone.
    // Presentation is on this list so an asset's size, id or pixels can never reach a
    // legality decision: a taller wall is a different picture, not a different rule.
    files: ["src/game/**/*.ts", "src/adventure/**/*.ts", "src/loadout/**/*.ts", "src/session/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "pixi.js",
            "../pixi/**",
            "../dom/**",
            "../app/**",
            "../presentation/**",
            "ajv",
            "node:*",
          ],
        },
      ],
    },
  },
  {
    files: ["src/game/**/*.ts"],
    ignores: ["src/game/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "pixi.js",
            "../pixi/**",
            "../dom/**",
            "../app/**",
            "../content/**",
            "../presentation/**",
            "ajv",
            "node:*",
          ],
        },
      ],
    },
  },
);
