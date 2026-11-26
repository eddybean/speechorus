import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "src-tauri/", ".engine/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The classic hook rules only: the React Compiler rules in `recommended` (refs, immutability,
      // set-state-in-effect, ...) flag patterns that are fine without the compiler, which this app does not use.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    languageOptions: { globals: { ...globals.vitest } },
  },
  {
    files: ["*.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
