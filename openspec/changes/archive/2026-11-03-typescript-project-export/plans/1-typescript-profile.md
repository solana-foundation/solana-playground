# Plan: tasks 1.1–1.5, the TypeScript export profile (HOO-2541)

Success criteria (from the ticket):

- Happy path: a TypeScript-only project exported with the TypeScript profile
  installs with `npm install`, and `npm run client` and `npm test` run its
  client and tests.
- Edge case: a project with a program still exports through its framework
  conversion and produces the same zip as before.
- Edge case: a client that uses only `pg.connection` runs with no keypair file.
- Events asserted through the telemetry memory provider.

Steps, each test first (as shipped):

1. `utils/framework.ts`: `readWorkspaceFiles(name)`, `downloadZip(name, files)` and
   `convertToFramework(files)` -> `{ files, readme }` out of `exportWorkspace`, which composes them;
   existing in-source tests stay green. `frameworks/common.ts`: `getJSDependencyMap(files)` returns the
   name -> version map; `getJSDependencies` builds its text on it.
2. `features/project-export/model/typescript-profile.ts`:
   `toNodeProjectWith(getDependencies)(importGlobals)(endpoint)(name)(files)` -> `{ files, readme }`. The
   dependency reader and `addImports` are passed in, because `frameworks/common` imports the `utils`
   barrel, whose settings need the app's build-time globals. In-source tests: generated files; existing
   root files kept; `pg`/`sleep` import at each depth, with no semicolons, destructured, or by
   reference; no import a script declares or imports itself; globals imported; Node builtins left out;
   scripts only when there is a client / a test; client entry order; endpoint escaped; the shim parses
   as TypeScript and reads the keypair only in the `pg.wallet` getter.
3. `model/telemetry.ts` + prefix `export` in `shared/lib/telemetry/prefixes.ts`.
4. `model/export.ts`: `readProjectKind(name)`, `exportAsIs(name)`, `exportConverted(name)` -> the
   README, `exportedEndpoint()`, `isDownloadFailure`. The profile is decided from the files once and carried to the failure event;
   events through the memory provider (`model/export.test.ts`, mocks `utils` and `frameworks/common`).
5. `ExportWorkspace.tsx` calls the slice; a failed download is not retried as is; test covers both
   copies, the fallback, and the download failure.
6. Manual: dev server on a free slot port, export through Playwright, unzip, `npm install`,
   `npm run client`, `npm test`; screenshots.
