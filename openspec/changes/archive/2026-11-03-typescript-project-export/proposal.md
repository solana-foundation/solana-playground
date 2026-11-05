# Proposal

## Why

Projects with no program arrived with HOO-2147 (#183), but "Convert and
export" knows only the framework conversions. A project with no program
matches no framework, so it leaves the Playground as a plain zip, with the
toast "Could not convert the layout; exported it as is.", no `package.json`
or `tsconfig.json`, and `client/` and `tests/` still calling `pg.connection`
and `pg.wallet`, which exist only in the browser. The exported code does not
run anywhere. HOO-2541.

## What Changes

- The export dialog resolves one of two profiles for the project it
  exports: the framework conversion (Anchor, Native, Seahorse, unchanged)
  when the project has a program, the TypeScript profile otherwise.
  "Export without changes" stays for both.
- The TypeScript profile writes `package.json` (its dependencies read from
  the code, as the framework conversions read them), `tsconfig.json`, run
  scripts for `client/` and `tests/`, a README, and a `playground.ts`
  module that gives `pg.connection`, `pg.wallet` and `sleep` a local
  meaning: a connection to `SOLANA_RPC_URL` (by default the cluster the
  Playground used at export time) and a wallet read from `SOLANA_KEYPAIR`
  (by default `~/.config/solana/id.json`, the Solana CLI's keypair). Each
  script imports what it uses from it, and imports the packages the
  Playground provides as globals (`web3`, `anchor`, `BN`, `assert`, ...).
- For a project with no program the dialog says what the conversion does
  for a TypeScript project instead of talking about a framework's layout.
- A new feature slice, `project-export`, owns the export flow and its
  events. It adds three telemetry events, under the prefix `export`:
  `export_downloaded`, `export_convert_failed` and `export_failed`. None is
  renamed or removed.

## Capabilities

### New Capabilities

- `project-export`: exporting a project as a zip, the profile the
  conversion uses, what the TypeScript profile writes, and the export's
  telemetry.

### Modified Capabilities

None. `project-without-program` keeps its import and stepper requirements;
the export of such a project is the new capability's.

## Impact

- Code: `client-v2/src/features/project-export/` (new),
  `client-v2/src/utils/framework.ts` (reading a workspace and zipping it
  become callable on their own; `exportWorkspace` keeps its behaviour),
  `client-v2/src/frameworks/common.ts` (the dependency reader returns a map
  too), `client-v2/src/views/sidebar/explorer/Component/Modals/ExportWorkspace.tsx`
  (calls the slice, shows the profile's copy),
  `client-v2/src/shared/lib/telemetry/prefixes.ts` (registers `export`).
- User-visible: a TypeScript-only project's "Convert and export" downloads
  a Node project that installs with `npm install` and runs with
  `npm run client` and `npm test`. A project with a program exports the same
  zip as before.
- The Playground wallet's secret key is never written into the zip.
- Out of scope: generating `public/crates/` in `yarn dev` (the framework
  conversion fails locally without `/crates/versions.json`; separate task);
  `pg.wallets`, `pg.program` and `pg.PROGRAM_ID`, which a project with no
  program has no use for (the README names them); `signMessage` on the
  local wallet; the designers' analytics names (`project_exported`,
  `project_action_failed`), which belong to the projects menu's slice once
  it is built.
