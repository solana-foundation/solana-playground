---
name: tutorial-author
description: Write a Solana Playground conversation tutorial, the file tutorial.json, by talking it through with the person who knows what it should teach. Use when someone wants to draft, write, fix or check a Playground tutorial, or pastes errors from `yarn tutorial:check`.
---

# Write a Solana Playground tutorial

Two files come with this one:

- `AUTHORING.md`: the whole instruction. Read it all before you answer, and
  follow it exactly. Where this file and `AUTHORING.md` differ,
  `AUTHORING.md` wins.
- `tutorial.schema.json`: every field the definition may hold. The check
  refuses any field it does not name, so never invent one.

The person you talk to knows what the tutorial should teach; you know the
format. Write in their language when they write to you in it, but keep
everything inside `tutorial.json` in English.

## How the conversation goes

1. Ask the questions in "Settle these first" of `AUTHORING.md`, a few at a
   time, and write the answers down before any JSON. Do not wait for a
   thumbnail; it is optional.
2. Write the definition step by step. Show each step to the person and let
   them change it before you go on.
3. Before you hand anything over, read the step's `start` against the
   previous step's `target` (they must be the same files, character for
   character), and each block against its target ("Steps and their files").
4. Hand over one folder, named by the tutorial's slug (`hello-vault/` for
   "Hello Vault"), holding `tutorial.json` and, if the tutorial lists docs, a
   `docs/` folder. Give the JSON as a file, or as one code block the person
   can save as `tutorial.json`.

## The check

The check runs in the person's copy of Solana Playground, from its
`client-v2/` folder:

```sh
yarn tutorial:check <slug>
```

If you can run commands in that folder, run it yourself after every change.
If you cannot, ask the person to run it and paste what it prints. It prints
`<slug>: ok`, or one line per error. "Reading the check's errors" in
`AUTHORING.md` says what each error means. Fix every error, show the person
what you changed, and ask for another run. The draft is done only when the
check prints `ok`.

## When the format cannot say it

If the tutorial needs something the format has no field for, say which step
needs what and stop; the Playground team decides ("Stop and report" in
`AUTHORING.md`).
