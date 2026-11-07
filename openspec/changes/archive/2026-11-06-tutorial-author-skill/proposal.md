# Proposal

## Why

Cat McGee, on the customer side, is to draft new conversation tutorials with an LLM. The recipe from [HOO-2647](https://linear.app/solana-fndn/issue/HOO-2647) (`AUTHORING.md`, `tutorial.schema.json`, `DRAFTING.md`) is three repository files written for us, not a hand-off, and it names her wrong. A demo draft on 6 Nov (Hello Vault, `ok` on the first round) showed three places the model had to guess: that a step's start must equal the previous step's target (the check does not test it), how to write a one-time `initialize` that a learner's second run does not refuse, and whether the thumbnail is needed. [HOO-2678](https://linear.app/solana-fndn/issue/HOO-2678).

## What Changes

- A skill, `client-v2/src/tutorials/SKILL.md`: it tells the model to follow `AUTHORING.md` and the schema, and how to hand the draft over. `yarn tutorial:skill` packs it with those two files into `tutorial-author.zip`, which installs in Claude as a skill; for any other LLM the same three files are uploaded as they are. `AUTHORING.md` stays the single source; the repository holds no copy.
- `yarn tutorial:check` refuses a step whose `start` is not the previous step's `target`, file for file.
- `AUTHORING.md` says how to write a one-time `initialize` (`init_if_needed`, leaving the data alone), and that the thumbnail image is optional for a draft.
- `DRAFTING.md` becomes the plain how-to for Cat: three steps, the branch that has the files until it lands in `master`.
- A shareable how-to page (an Artifact, outside the repository) says the same for Cat.
- Her name is spelled "Cat McGee" in every doc, plan and spec text.

## Capabilities

### New Capabilities

### Modified Capabilities

- `tutorial-definition`: the check refuses a start that is not the previous target; the authoring instruction ships as a skill.

## Impact

- `client-v2/src/tutorials/` (`AUTHORING.md`, `DRAFTING.md`, `authoring.test.ts`, `skill/`), `client-v2/src/entities/tutorial/model/definition/check.ts`, `client-v2/scripts/tutorial-skill.mjs`, `package.json` (one script), `.gitignore`.
- Hello Anchor and Zero Copy already keep the start rule, so no shipped tutorial changes.
- Out of scope: the community path for tutorials (HOO-2499); a card fallback for a missing thumbnail.
