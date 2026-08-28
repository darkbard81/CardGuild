import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/**"] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: globals.browser,
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
            "ajv",
            "node:*",
          ],
        },
      ],
    },
  },
);
