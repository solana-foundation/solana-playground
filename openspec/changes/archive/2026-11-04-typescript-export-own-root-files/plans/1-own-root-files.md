# Plan: export a TypeScript project with its own package.json or playground.ts

Ticket: HOO-2596. Base: `scope/typescript`. Mode: inline.

## Success metric (from the ticket)

- A project with its own root `package.json` exports with scripts and
  dependencies that make `npm install` and `npm run client` work.
- A project with its own `playground.ts` exports with code that does not
  assume the profile's `playground.ts`.
- A project with both exports and runs `npm run client`.
- A project with neither still exports as before.
- Tests cover the three cases above.

## Design gaps

None: nothing visible changes.

## Steps

1. Tests first, in `typescript-profile.ts`'s vitest block: own
   `package.json` completed (own versions, scripts and `type` win; missing
   scripts, deps, dev deps added; a package declared in any dependency
   field is not added again; `config.client` only with the added `client`
   script; unreadable file kept), own `playground.ts` (shim at
   `playground-shim.ts`, imports and README follow), the next free name
   past `playground.js` and `playground-shim/`, both at once, README naming
   an own `client` script. The existing tests are the "neither" case.
2. `shimStemFor(paths)`: the first of `playground`, `playground-shim`,
   `playground-shim-<n>` no root file or folder resolves; thread it through
   `convertScriptWith` and `shimImport`.
3. `completePackageJsonWith(ours)(own)`; `toNodeProjectWith` writes its text in
   place of the project's `package.json`.
4. Verify: unit tests; generate the four cases with the real profile,
   `npm install`, `npm run client` against devnet with a fresh keypair, and
   `tsc -p .` in each.
5. Spec delta, archive the change, PR into `scope/typescript` as a draft.
