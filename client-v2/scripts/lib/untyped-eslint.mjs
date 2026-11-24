import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

const { rules } = tseslint.plugin;

const TYPED_RULES_OFF = Object.fromEntries(
  Object.entries(rules)
    .filter(([, rule]) => rule.meta.docs?.requiresTypeChecking)
    .map(([name]) => [`@typescript-eslint/${name}`, "off"])
);

/**
 * ESLint with `eslint.config.mjs`, minus type information, for tests of
 * import rules: typed parsing refuses a probe path outside `tsconfig.json`
 * and builds the whole program for a real file.
 */
export const untypedEslintAt = (cwd) =>
  new ESLint({
    cwd,
    overrideConfig: {
      languageOptions: { parserOptions: { project: null } },
      rules: TYPED_RULES_OFF,
    },
  });
