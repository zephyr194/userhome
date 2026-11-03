import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";
import userhome from "./scripts/eslint-rules/index.mjs";

export default tseslint.config(
  { ignores: ["dist", "src-tauri/target"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/forms/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXOpeningElement[name.name=/^(input|select|textarea|option|button)$/]",
          message: "请使用 src/components/ui/forms 的组件，不要直接使用原生表单元素",
        },
      ],
    },
  },
  {
    // 2026-11-03 试运行期满、零命中后升为 error；规则来历见 docs/agent-incidents/batch-1-proposals.md P3。
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { userhome },
    rules: { "userhome/no-raw-ipc-in-effect": "error" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
