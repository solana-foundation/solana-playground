# openspec

Specs and change proposals for `client-v2`, managed with
[OpenSpec](https://openspec.dev). The CLI is installed per machine
(`npm i -g @fission-ai/openspec` or `brew install openspec`); the Claude
Code commands it generated live in `.claude/commands/opsx/` and
`.claude/skills/openspec-*/` and are committed, so every agent on this
repository has them. `yarn spec:validate` in `client-v2/` runs
`openspec validate --all`, and CI runs it too.

```
openspec/
  config.yaml                  project context and rules every /opsx:* command reads
  specs/<capability>/spec.md   what the system does today; filled by archiving changes
  changes/<change>/            a change in progress
    .openspec.yaml             schema and creation date
    proposal.md                why, what changes, which capabilities
    specs/<capability>/spec.md the delta: ADDED / MODIFIED / REMOVED requirements
    design.md                  context, decisions, risks
    tasks.md                   checklist; one PR per task
  changes/archive/<date>-<change>/   closed changes, deltas merged into specs/
```

`specs/` starts nearly empty and grows one change at a time; nothing is
back-filled for code that is not changing. How a change moves through here
is in `client-v2/CLAUDE.md`, section "Specs and changes".

Useful commands:

```
openspec list                      active changes
openspec view                      one-screen dashboard
openspec status --change <name>    which artifacts exist
openspec validate --all            structure check, the same as CI
```
