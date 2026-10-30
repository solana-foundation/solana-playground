# Proposal

## Why

Import from GitHub accepts only a repository that holds a program in the
Anchor, native or Seahorse layout. A repository of plain TypeScript, such as
a client and its tests, is refused, and so is a hand-made gist of one, so
users cannot bring that kind of work into the Playground. HOO-1761 left the
gist side refused on purpose until this change lifts it for both imports.

## What Changes

- A repository (from GitHub, or local files dropped in the import dialog)
  that no framework recognises but that holds TypeScript or JavaScript, and
  no Rust or Python, imports as a project with no program; one holding Rust
  or Python no framework recognises is still refused. Test files (`*.test.*`,
  `*.spec.*`) and files in a leading `tests/` or `test/` folder land under
  `tests/`; other TypeScript and JavaScript files land under `client/`; both
  keep their subfolders. Other files of a supported language are dropped,
  since a project with no program has no place for them.
- A repository that holds a program imports exactly as it does today.
- A gist with no program that holds TypeScript or JavaScript opens as a
  project with no program instead of being refused. A gist that holds
  neither is still refused, under the same reason, with a message that says
  it holds no program and no TypeScript or JavaScript.
- A project has no program when its `src/` holds no Rust or Python file,
  which is what Build compiles. This is read from the files each time, not
  stored, so a program added later brings the stages back.
- For a project with no program, the dev-loop stepper shows only Write:
  Build, Deploy and Interact are hidden and their keys (Ctrl+2..4) do
  nothing. The row stays, so the frame does not move.
- Telemetry: no event is added, renamed or removed. The gist slice's
  `gist_import_failed` keeps `reason: no-program` for a gist with nothing
  to open; repository import and the Flow stepper live in legacy roots that
  send no events today.

## Capabilities

### New Capabilities

- `project-without-program`: importing a repository that holds no program,
  how its files are placed, and how the dev loop presents a project that
  has no program.

### Modified Capabilities

- `gist-sharing`: a gist with no program but with TypeScript or JavaScript
  is no longer refused; the `no-program` refusal now covers only a gist with
  neither a program nor TypeScript or JavaScript.

## Impact

- Code: `client-v2/src/utils/framework.ts` (the no-program layout and the
  "has a program" check), `client-v2/src/features/gist/model/import.ts`
  (the refusal), `client-v2/src/views/flow/header/` and
  `client-v2/src/views/flow/state/stage.ts` (the stages shown).
  `utils/github.ts` and `ImportFs.tsx` pass the imported folder, so a
  sub-folder or a dropped folder is not nested under `client/`.
- Users: a TypeScript repository or gist opens instead of failing; in such
  a project the stepper shows one stage.
- Out of scope: the terminal's `build` and `deploy` commands and the
  assistant's build and deploy tools, which already fail with their own
  message on a project with nothing to build; running the imported client
  or tests (unchanged); importing other files of a repository with no
  program (`README.md`, `package.json`); a design for the one-stage stepper
  beyond hiding stages, which no design source covers yet.
