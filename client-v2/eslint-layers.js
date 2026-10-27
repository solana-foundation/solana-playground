/**
 * The layer rule from `CLAUDE.md` ("Layers") as ESLint errors. `package.json`
 * `eslintConfig` extends this file, so `yarn lint` and the dev server read it,
 * and so does `yarn lint:layers`, the first step of the production build,
 * which drops CRA's own lint (`BUILD_ONLY_CHECKS` in `craco.config.js`). It is
 * a module rather than part of `package.json` so the exception below can
 * carry its comment.
 *
 * The five layers under `src/` are checked, and `api/`, whose routes reach
 * `src/` only through a slice's `server.mjs` (or `shared`). The legacy roots
 * (`components/`, `views/`, `utils/` and the rest) sit outside
 * `boundaries/include`: a layer may import them, and what they import is not
 * checked.
 */

const path = require("path");

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

const slice = (type, name) => ({
  element: { type, captured: { slice: name } },
});

module.exports = {
  plugins: ["boundaries"],
  settings: {
    // Both read paths from here, not from the working directory, so ESLint
    // run from the repository root (an editor, `npx eslint client-v2/...`)
    // still places files in their layers instead of passing everything
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
          // The one recorded exception: `auth`'s server module uses
          // `persistence`'s pool, and `persistence` reads the session.
          // `ui-migration` task 1.4 breaks the cycle and deletes this policy.
          {
            from: slice("features", "{auth,persistence}"),
            allow: { to: slice("features", "{auth,persistence}") },
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
};
