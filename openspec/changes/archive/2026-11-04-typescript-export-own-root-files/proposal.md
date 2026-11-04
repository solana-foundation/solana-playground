# Proposal

## Why

The TypeScript profile (HOO-2541) leaves out any root file the project
already holds. For `README.md`, `tsconfig.json` and `.gitignore` that is
right. For `package.json` and `playground.ts` it breaks the export: the
project's own `package.json` lacks `tsx`, the `client` script and the
packages the converted code imports, and the converted scripts import `pg`
from `../playground`, which is now the project's own file and exports no
`pg`. `npm run client` fails. HOO-2596, from the sx review of SF#75 over #268.

## What Changes

- A project's own `package.json` is completed, not replaced: every field,
  script and package it holds stays as it is; the scripts, packages,
  `engines` and `type` (only when absent) the profile would write are added
  where missing. A file that is not a JSON object is kept as it is.
- When the project holds `playground` at the root (`playground.ts`,
  `playground.js`, a `playground/` folder, ...), the shim is written as
  `playground-shim.ts` (then `playground-shim-2.ts` and on), and the
  scripts and README name that file.
- The README says "the `client` script in `package.json`" when that script
  is the project's own.

## Impact

`client-v2/src/features/project-export/model/typescript-profile.ts` and the
`project-export` spec. No UI change; the dialog's wording is unchanged.
