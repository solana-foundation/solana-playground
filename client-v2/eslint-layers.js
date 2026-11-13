/**
 * The layer rule from `CLAUDE.md` ("Layers") as ESLint errors, and its one
 * recorded exception as warnings, as a flat config array that
 * `eslint.config.mjs` spreads in, so `yarn lint` reads it, and so does
 * `yarn lint:layers`, the first step of the production build.
 *
 * The five layers under `src/` are checked, and `api/`, whose routes reach
 * `src/` only through a slice's `server.mjs` (or `shared`). The legacy roots
 * (`components/`, `views/`, `utils/` and the rest) sit outside
 * `boundaries/include`: a layer may import them, and what they import is not
 * checked.
 */

const path = require("path");
const boundaries = require("eslint-plugin-boundaries");
const layers = require("eslint-plugin-layers");

const SLICE_LAYERS = ["widgets", "features", "entities"];

/**
 * What a file may import outside its own element (its slice, or all of `app`
 * or `shared`): the layers below its own
 */
const BELOW = {
  app: ["widgets", "features", "entities", "shared"],
  widgets: ["features", "entities", "shared"],
  features: ["entities", "shared"],
  entities: ["shared"],
  shared: [],
  api: ["features", "entities", "shared"],
};

/** A slice's doors: `index.ts` for the browser, `server.mjs` for server code */
const ENTRY_POINT = "{index.ts,server.mjs}";

/** Test files, by the names vitest and `node --test` collect */
const TEST_FILE = "**/*.{test,spec}.{ts,tsx,mts,mjs}";

const LAYER_MESSAGE =
  "{{from.element.type}} may import only the layers below it (app -> widgets -> features -> entities -> shared), and no other slice of its own layer: {{to.element.type}}/{{to.element.captured.slice}} is not allowed here. See client-v2/CLAUDE.md, Layers";

const ENTRY_MESSAGE =
  "Import {{to.element.type}}/{{to.element.captured.slice}} through its public entry (index.ts; server.mjs from server code), not {{to.element.fileInternalPath}}. See client-v2/CLAUDE.md, Layers";

const SERVER_MESSAGE =
  "{{to.element.type}}/{{to.element.captured.slice}}/server.mjs is the door for server code (.mjs); browser code imports index.ts. See client-v2/CLAUDE.md, Layers";

const API_MESSAGE =
  "api/ reaches {{to.element.type}}/{{to.element.captured.slice}} only through its server.mjs, not {{to.element.fileInternalPath}}. See client-v2/CLAUDE.md, Layers";

const RECORDED_EXCEPTION_MESSAGE =
  'features/{{from.element.captured.slice}} imports "{{dependency.source}}", another feature: the recorded auth <-> persistence exception, tolerated in these files only until ui-migration task 1.4 breaks the cycle. Add no other. See client-v2/CLAUDE.md, Layers';

/** The entries the recorded exception's imports go through */
const PAIR_ENTRIES = [
  {
    element: {
      type: "features",
      captured: { slice: "auth" },
      fileInternalPath: "index.ts",
    },
  },
  {
    element: {
      type: "features",
      captured: { slice: "persistence" },
      fileInternalPath: "server.mjs",
    },
  },
];

/**
 * The recorded exception: these files' imports of the other slice's entry
 * warn, and the same import from any other file errors. `eslint-layers.test.mjs`
 * pins the set; `ui-migration` task 1.4 empties it
 */
const RECORDED_EXCEPTION = [
  "src/features/auth/model/auth.mjs",
  "src/features/persistence/model/{chat-sync,project-sync,sync-base,sync-claim,sync-mark}.ts",
  "src/features/persistence/model/{project-restore,project-sync,two-devices}.test.ts",
];

module.exports = [
  {
    plugins: { boundaries, layers },
    settings: {
      // Both read `process.cwd()` unless set: the git hooks run `lint-changed.mjs`
      // from the repository root with ESLint's cwd in client-v2, and files must
      // still land in their layers instead of passing everything
      "boundaries/root-path": __dirname,
      // Relative paths and `@/` (tsconfig `paths`) both resolve to files, which
      // is what places an import in a layer; one that resolves to nothing is
      // not checked
      "import/resolver": {
        typescript: { project: path.join(__dirname, "tsconfig.json") },
        node: { extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"] },
      },
      "boundaries/include": [
        "src/{app,widgets,features,entities,shared}/**",
        "api/**",
      ],
      // `api` matches from the root only: as a partial match it would also
      // claim `src/features/api`
      "boundaries/elements": [
        { type: "app", pattern: "src/app" },
        ...SLICE_LAYERS.map((type) => ({
          type,
          pattern: `src/${type}/*`,
          capture: ["slice"],
        })),
        { type: "shared", pattern: "src/shared" },
        { type: "api", pattern: "api", partialMatch: false },
      ],
    },
    rules: {
      // Scoped inside `eslint-plugin-layers`, so no `files` of its own
      "layers/alias-across-modules": [
        "error",
        { src: path.join(__dirname, "src") },
      ],
      // Imports inside one element (the app, a slice, shared) are not checked.
      // Two slices of one layer are two elements, so a widget importing a
      // widget, or a feature a feature, matches no policy and is disallowed.
      // The last matching policy wins, so the entry-point ones come last.
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message: LAYER_MESSAGE,
          policies: [
            ...Object.entries(BELOW)
              .filter(([, below]) => below.length > 0)
              .map(([type, below]) => ({
                from: { element: { type } },
                allow: { to: { element: { type: below } } },
              })),
            // A slice's integration spec drives the route that serves it
            // (`features/agent/agent.integration.spec.ts`); code never does
            {
              from: { file: { path: "**/*.integration.spec.{ts,tsx,mjs}" } },
              allow: { to: { element: { type: "api" } } },
            },
            // `layers/recorded-exception` reports these as warnings instead
            {
              from: { file: { path: RECORDED_EXCEPTION } },
              allow: { to: PAIR_ENTRIES },
            },
            // A test file may reach past a slice's entry, so a `vi.mock` can
            // rebuild the entry from the modules behind it
            // (`app/ConnectDialog/ConnectDialog.test.tsx`); production code may
            // not, and the layer direction holds for tests too
            {
              from: { file: { path: `!${TEST_FILE}` } },
              to: { element: { type: SLICE_LAYERS } },
              disallow: {
                to: { element: { fileInternalPath: `!${ENTRY_POINT}` } },
              },
              message: ENTRY_MESSAGE,
            },
            // `server.mjs` is a slice's server side, for `api/` routes and
            // other `.mjs` server modules; browser code that imported it would
            // pull Node-only code into the bundle
            {
              from: { file: { path: "!**/*.mjs" } },
              to: { element: { type: SLICE_LAYERS } },
              disallow: { to: { element: { fileInternalPath: "server.mjs" } } },
              message: SERVER_MESSAGE,
            },
            {
              from: { element: { type: "api" } },
              to: { element: { type: SLICE_LAYERS } },
              disallow: {
                to: { element: { fileInternalPath: "!server.mjs" } },
              },
              message: API_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: RECORDED_EXCEPTION,
    rules: {
      // A warning: `yarn lint` shows it, the build's `lint:layers --quiet`
      // does not fail on it
      "layers/recorded-exception": [
        "warn",
        {
          default: "allow",
          message: RECORDED_EXCEPTION_MESSAGE,
          policies: [{ disallow: { to: PAIR_ENTRIES } }],
        },
      ],
    },
  },
];
