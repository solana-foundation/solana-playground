// The whole ESLint configuration. The first objects rebuild `eslint-config-react-app` 7 from its plugins, the
// rest are the project's own; a later object wins on a rule both set.

import path from "node:path";
import { fileURLToPath } from "node:url";
import sdl from "@microsoft/eslint-plugin-sdl";
import confusingBrowserGlobals from "confusing-browser-globals";
import importPlugin from "eslint-plugin-import";
import jest from "eslint-plugin-jest";
import jsxA11y from "eslint-plugin-jsx-a11y";
import noUnsanitized from "eslint-plugin-no-unsanitized";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

import layers from "./eslint-layers.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const UUID_MESSAGE =
  "Import uuid() / isUuid() from src/shared/lib/ids; it is the one module that talks to the library.";
const CN_MESSAGE =
  "Import cn from src/shared/lib/utils; it knows the theme type scale, the bare package drops text-control, font-act and the rest.";
const STYLED_MESSAGE =
  "Style with Tailwind over the design-system tokens; styled-components is leaving (HOO-2077). Only the wallet, the layout shell and the theme provider keep it until they move.";
const RANDOM_UUID_MESSAGE =
  "Mint ids with uuid() from src/shared/lib/ids; crypto.randomUUID exists only in secure contexts.";
const UUID_REGEX_MESSAGE =
  "Check an id with isUuid() from src/shared/lib/ids instead of a copied UUID regex.";
const REPORT_BUTTON_FAILURE_MESSAGE =
  'reportButtonFailure takes what did not happen first: .catch(reportButtonFailure("<action>")). Passed bare, it returns a handler nobody calls and the failure is swallowed.';
const CLUSTER_URL_MESSAGE =
  "Take a cluster's address from Endpoint (src/entities/cluster), or, in a test that needs some RPC, from TEST_ENDPOINT in src/test-utils/endpoints.mjs, whose hosts never resolve.";

const RANDOM_UUID_SELECTORS = [
  {
    selector: "MemberExpression[property.name='randomUUID']",
    message: RANDOM_UUID_MESSAGE,
  },
  {
    selector:
      "VariableDeclarator > ObjectPattern > Property[key.name='randomUUID']",
    message: RANDOM_UUID_MESSAGE,
  },
];
const UUID_REGEX_SELECTOR = {
  selector: "Literal[regex.pattern=/\\{8\\}\\\\?-/]",
  message: UUID_REGEX_MESSAGE,
};
const REPORT_BUTTON_FAILURE_SELECTOR = {
  selector:
    "CallExpression[callee.property.name=/^(catch|then)$/] > Identifier.arguments[name='reportButtonFailure']",
  message: REPORT_BUTTON_FAILURE_MESSAGE,
};
const CLUSTER_URL = String.raw`/api\.(devnet|testnet|mainnet-beta)\.solana\.com/`;
const CLUSTER_URL_SELECTORS = [
  { selector: `Literal[value=${CLUSTER_URL}]`, message: CLUSTER_URL_MESSAGE },
  {
    selector: `TemplateElement[value.raw=${CLUSTER_URL}]`,
    message: CLUSTER_URL_MESSAGE,
  },
  { selector: `JSXText[value=${CLUSTER_URL}]`, message: CLUSTER_URL_MESSAGE },
];
/** The one module that spells the clusters' addresses */
const ENDPOINT_MODULE = "src/entities/cluster/model/endpoint.ts";

const UUID_PATH = { name: "uuid", message: UUID_MESSAGE };
const CN_PATH = { name: "cn", message: CN_MESSAGE };
const STYLED_PATH = { name: "styled-components", message: STYLED_MESSAGE };
const UUID_PATTERN = { group: ["uuid/*"], message: UUID_MESSAGE };

const UNUSED_VARS = {
  args: "after-used",
  ignoreRestSiblings: true,
  // ESLint 8's default; ESLint 9 and typescript-eslint 8 report unused catch bindings
  caughtErrors: "none",
};

const LAYERS = "src/{app,features,shared,entities,widgets}/**";

/** `eslint-config-react-app` 7, `index.js` and `base.js` */
const reactApp = [
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      import: importPlugin,
      "jsx-a11y": jsxA11y,
      react,
      "react-hooks": reactHooks,
    },
  },
  {
    files: ["**/*.{js,ts,tsx,mjs,mts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.es2015,
        ...globals.jest,
        ...globals.node,
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-uses-vars": "warn",
      "react/jsx-uses-react": "warn",

      "array-callback-return": "warn",
      "default-case": ["warn", { commentPattern: "^no default$" }],
      "dot-location": ["warn", "property"],
      eqeqeq: ["warn", "smart"],
      "new-parens": "warn",
      "no-array-constructor": "warn",
      "no-caller": "warn",
      "no-cond-assign": ["warn", "except-parens"],
      "no-const-assign": "warn",
      "no-control-regex": "warn",
      "no-delete-var": "warn",
      "no-dupe-args": "warn",
      "no-dupe-class-members": "warn",
      "no-dupe-keys": "warn",
      "no-duplicate-case": "warn",
      "no-empty-character-class": "warn",
      "no-empty-pattern": "warn",
      "no-eval": "warn",
      "no-ex-assign": "warn",
      "no-extend-native": "warn",
      "no-extra-bind": "warn",
      "no-extra-label": "warn",
      "no-fallthrough": "warn",
      "no-func-assign": "warn",
      "no-implied-eval": "warn",
      "no-invalid-regexp": "warn",
      "no-iterator": "warn",
      "no-label-var": "warn",
      "no-labels": ["warn", { allowLoop: true, allowSwitch: false }],
      "no-lone-blocks": "warn",
      "no-loop-func": "warn",
      "no-mixed-operators": [
        "warn",
        {
          groups: [
            ["&", "|", "^", "~", "<<", ">>", ">>>"],
            ["==", "!=", "===", "!==", ">", ">=", "<", "<="],
            ["&&", "||"],
            ["in", "instanceof"],
          ],
          allowSamePrecedence: false,
        },
      ],
      "no-multi-str": "warn",
      "no-global-assign": "warn",
      "no-unsafe-negation": "warn",
      "no-new-func": "warn",
      "no-new-object": "warn",
      "no-new-symbol": "warn",
      "no-new-wrappers": "warn",
      "no-obj-calls": "warn",
      "no-octal": "warn",
      "no-octal-escape": "warn",
      "no-redeclare": "warn",
      "no-regex-spaces": "warn",
      "no-restricted-syntax": ["warn", "WithStatement"],
      "no-script-url": "warn",
      "no-self-assign": "warn",
      "no-self-compare": "warn",
      "no-sequences": "warn",
      "no-shadow-restricted-names": "warn",
      "no-sparse-arrays": "warn",
      "no-template-curly-in-string": "warn",
      "no-this-before-super": "warn",
      "no-throw-literal": "warn",
      "no-undef": "error",
      "no-restricted-globals": ["error", ...confusingBrowserGlobals],
      "no-unreachable": "warn",
      "no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "no-unused-labels": "warn",
      "no-unused-vars": [
        "warn",
        { args: "none", ignoreRestSiblings: true, caughtErrors: "none" },
      ],
      "no-use-before-define": [
        "warn",
        { functions: false, classes: false, variables: false },
      ],
      // ESLint 9 turned `enforceForClassMembers` on by default
      "no-useless-computed-key": ["warn", { enforceForClassMembers: false }],
      "no-useless-concat": "warn",
      "no-useless-constructor": "warn",
      "no-useless-escape": "warn",
      "no-useless-rename": [
        "warn",
        {
          ignoreDestructuring: false,
          ignoreImport: false,
          ignoreExport: false,
        },
      ],
      "no-with": "warn",
      "no-whitespace-before-property": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "require-yield": "warn",
      "rest-spread-spacing": ["warn", "never"],
      strict: ["warn", "never"],
      "unicode-bom": ["warn", "never"],
      "use-isnan": "warn",
      "valid-typeof": "warn",
      "no-restricted-properties": [
        "error",
        {
          object: "require",
          property: "ensure",
          message:
            "Please use import() instead. More info: https://facebook.github.io/create-react-app/docs/code-splitting",
        },
        {
          object: "System",
          property: "import",
          message:
            "Please use import() instead. More info: https://facebook.github.io/create-react-app/docs/code-splitting",
        },
      ],
      "getter-return": "warn",

      "import/first": "error",
      "import/no-amd": "error",
      "import/no-anonymous-default-export": "warn",
      "import/no-webpack-loader-syntax": "error",

      "react/forbid-foreign-prop-types": ["warn", { allowInPropTypes: true }],
      "react/jsx-no-comment-textnodes": "warn",
      "react/jsx-no-duplicate-props": "warn",
      "react/jsx-no-target-blank": "warn",
      "react/jsx-no-undef": "error",
      "react/jsx-pascal-case": ["warn", { allowAllCaps: true, ignore: [] }],
      "react/no-danger-with-children": "warn",
      "react/no-direct-mutation-state": "warn",
      "react/no-is-mounted": "warn",
      "react/no-typos": "error",
      "react/require-render-return": "error",
      "react/style-prop-object": "warn",

      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/anchor-is-valid": [
        "warn",
        { aspects: ["noHref", "invalidHref"] },
      ],
      "jsx-a11y/aria-activedescendant-has-tabindex": "warn",
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-role": ["warn", { ignoreNonDOM: true }],
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/heading-has-content": "warn",
      "jsx-a11y/iframe-has-title": "warn",
      "jsx-a11y/img-redundant-alt": "warn",
      "jsx-a11y/no-access-key": "warn",
      "jsx-a11y/no-distracting-elements": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "jsx-a11y/scope": "warn",

      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2018,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        warnOnUnsupportedTypeScriptVersion: true,
      },
    },
    rules: {
      "default-case": "off",
      "no-dupe-class-members": "off",
      "no-undef": "off",
      "@typescript-eslint/consistent-type-assertions": "warn",
      "no-array-constructor": "off",
      "@typescript-eslint/no-array-constructor": "warn",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "warn",
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": [
        "warn",
        { functions: false, classes: false, variables: false, typedefs: false },
      ],
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { args: "none", ignoreRestSiblings: true, caughtErrors: "none" },
      ],
      "no-useless-constructor": "off",
      "@typescript-eslint/no-useless-constructor": "warn",
    },
  },
];

/** The project's rules, formerly `package.json` `eslintConfig.overrides`, in their order */
const project = [
  {
    files: ["src/**", "e2e/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...RANDOM_UUID_SELECTORS,
        REPORT_BUTTON_FAILURE_SELECTOR,
        ...CLUSTER_URL_SELECTORS,
      ],
    },
  },
  {
    files: ["api/**", "scripts/**"],
    // `WithStatement` is react-app's selector, kept; error in place of react-app's warn changes nothing: a module cannot hold `with`
    rules: {
      "no-restricted-syntax": [
        "error",
        "WithStatement",
        ...CLUSTER_URL_SELECTORS,
      ],
    },
  },
  {
    files: ["e2e/**"],
    rules: {
      // e2e holds no React components, and Playwright's fixture callback is named `use`
      "react-hooks/rules-of-hooks": "off",
      "no-restricted-imports": [
        "error",
        { paths: [UUID_PATH], patterns: [UUID_PATTERN] },
      ],
      "no-restricted-syntax": [
        "error",
        ...RANDOM_UUID_SELECTORS,
        UUID_REGEX_SELECTOR,
        ...CLUSTER_URL_SELECTORS,
      ],
    },
  },
  {
    files: [LAYERS],
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-nested-ternary": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [UUID_PATH, CN_PATH, STYLED_PATH],
          patterns: [UUID_PATTERN],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...RANDOM_UUID_SELECTORS,
        UUID_REGEX_SELECTOR,
        REPORT_BUTTON_FAILURE_SELECTOR,
        ...CLUSTER_URL_SELECTORS,
      ],
    },
  },
  {
    files: [ENDPOINT_MODULE],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...RANDOM_UUID_SELECTORS,
        UUID_REGEX_SELECTOR,
        REPORT_BUTTON_FAILURE_SELECTOR,
      ],
    },
  },
  {
    files: ["src/widgets/layout-shell/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [UUID_PATH, CN_PATH], patterns: [UUID_PATTERN] },
      ],
    },
  },
  {
    files: ["src/**"],
    ignores: [
      LAYERS,
      "src/components/Wallet/**",
      "src/providers/theme/**",
      "src/types/declarations.d.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", { paths: [STYLED_PATH] }],
    },
  },
  {
    files: ["api/**"],
    rules: { "no-console": "error" },
  },
  {
    files: ["src/shared/lib/logger/providers/**"],
    ignores: [
      "src/shared/lib/logger/providers/sentry.ts",
      "src/shared/lib/logger/providers/sentry.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [UUID_PATH, CN_PATH, STYLED_PATH],
          patterns: [
            UUID_PATTERN,
            {
              group: ["@sentry/*"],
              message:
                "The browser logger reaches Sentry only through providers/sentry.ts; the server logger is handed the SDK by with-observability.mjs. See the client-v2-logging spec.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/shared/lib/ids.ts", "src/shared/lib/ids.test.mts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": ["error", ...CLUSTER_URL_SELECTORS],
    },
  },
  {
    files: ["src/shared/lib/utils.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.test.mts",
      "**/*.test.mjs",
      "e2e/**",
    ],
    rules: { "import/first": "off" },
  },
  {
    files: ["**/*.mts"],
    languageOptions: {
      parser: tseslint.parser,
      // eslintrc gave `.mts` the base parser options, which enable no JSX
      parserOptions: { ecmaFeatures: { jsx: false } },
    },
    rules: {
      "default-case": "off",
      "no-dupe-class-members": "off",
      "no-undef": "off",
      "no-array-constructor": "off",
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "warn",
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": [
        "warn",
        { functions: false, classes: false, variables: false, typedefs: false },
      ],
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", UNUSED_VARS],
    },
  },
  {
    files: ["src/**", "api/**", "e2e/**"],
    plugins: { unicorn },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "warn",
      "layers/curry-order": "warn",
      "layers/no-test-spread": "warn",
      "unicorn/no-null": ["warn", { checkStrictEquality: false }],
      "max-params": ["warn", 2],
    },
  },
  {
    files: [
      "src/**",
      "api/**",
      "e2e/**",
      "scripts/**",
      "eslint-plugin-layers/**",
    ],
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "no-shadow": "error",
      "no-unused-vars": ["error", UNUSED_VARS],
      "simple-import-sort/imports": [
        "error",
        { groups: [["^\\u0000"], ["^node:", "^@?\\w"], ["^@/"], ["^\\."]] },
      ],
    },
  },
  {
    files: [
      "src/**/*.{ts,tsx,mts}",
      "api/**/*.{ts,tsx,mts}",
      "e2e/**/*.{ts,tsx,mts}",
    ],
    rules: {
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", UNUSED_VARS],
    },
  },
  {
    files: ["src/**", "e2e/**"],
    rules: {
      "no-console": "error",
      "prefer-promise-reject-errors": "warn",
    },
  },
  {
    files: [
      "src/shared/lib/logger/providers/console.ts",
      "src/shared/lib/logger/providers/server-console.mjs",
    ],
    rules: { "no-console": "off" },
  },
  {
    files: ["api/**"],
    rules: { "max-params": "off" },
  },
  {
    files: ["scripts/**", "eslint-plugin-layers/**"],
    languageOptions: { globals: globals.es2021 },
  },
  {
    files: ["src/**/*.{test,spec}.{js,ts,tsx,mjs,mts}"],
    plugins: { jest },
    rules: {
      "jest/valid-title": [
        "warn",
        {
          mustNotMatch: {
            describe:
              "\\b([Uu][Nn][Ii][Tt]|[Ii][Nn][Tt][Ee][Gg][Rr][Aa][Tt][Ii][Oo][Nn]|[Ee]2[Ee])\\b",
          },
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.raw.d.ts"],
    languageOptions: {
      parserOptions: { project: true, tsconfigRootDir: dirname },
    },
    rules: {
      "no-throw-literal": "off",
      // typescript-eslint 8 renamed `no-throw-literal`
      "@typescript-eslint/only-throw-error": "warn",
    },
  },
];

// sdl's own localhost default is unanchored (`http://localhost.evil.test` passes), so only its XML namespaces stay
const INSECURE_URL_EXCEPTIONS = [
  ...sdl.rules["no-insecure-url"].defaultExceptions
    .map(({ source }) => source)
    .filter((source) => !source.includes("localhost")),
  String.raw`^(http|ws)://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)`,
];

/** Security rules; sdl's are named one by one, since its recommended config pulls in all of its framework configs */
const securityChecks = [
  {
    files: ["src/**", "api/**", "e2e/**"],
    plugins: { "no-unsanitized": noUnsanitized, "@microsoft/sdl": sdl },
    rules: {
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "@microsoft/sdl/no-postmessage-star-origin": "error",
      "@microsoft/sdl/no-document-domain": "error",
      "@microsoft/sdl/no-document-write": "error",
      "@microsoft/sdl/no-insecure-url": [
        "error",
        { exceptions: INSECURE_URL_EXCEPTIONS },
      ],
    },
  },
  {
    // A test importing its own module, and the factories that import their folder's modules by name
    files: [
      "{src,api,e2e}/**/*.test.mjs",
      "src/frameworks/create.ts",
      "src/themes/create.ts",
      "src/tutorials/create.tsx",
      "src/views/main/secondary/create.ts",
      "src/views/sidebar/create.ts",
    ],
    rules: {
      "no-unsanitized/method": ["error", {}, { import: { properties: [] } }],
    },
  },
  {
    // Not scripts/: build tooling reads paths and spawns processes by design
    files: ["src/**", "api/**"],
    plugins: security.configs.recommended.plugins,
    rules: {
      ...security.configs.recommended.rules,
      // Reports nearly every computed member access
      "security/detect-object-injection": "off",
    },
  },
];

const config = [
  // ESLint 9 lints `.cjs` by default; `yarn lint` never did
  { ignores: ["**/*.cjs"] },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off", // ESLint 8's default; TODO(HOO-2892): "warn", once the disables that suppress nothing are removed
    },
  },
  ...reactApp,
  ...layers,
  ...project,
  ...securityChecks,
];

export default config;
