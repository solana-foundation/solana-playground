# Draft a tutorial with an LLM

For an author outside the Playground team, such as Cat McGee, who wants to
draft a new conversation tutorial. You talk the tutorial through with an
LLM; it writes one file, `tutorial.json`; a check on your computer says
whether Playground can run it. Three steps.

## 1. Give the LLM the skill

The skill is three files: [`SKILL.md`](SKILL.md),
[`AUTHORING.md`](AUTHORING.md) and
[`tutorial.schema.json`](tutorial.schema.json). They come packed as
`tutorial-author.zip`, which the Playground team sends you. Once you have
the copy from step 2, `yarn tutorial:skill` in its `client-v2/` folder
writes the same zip there.

- **Claude:** add `tutorial-author.zip` under Skills in Claude's settings.
  Then, in a new chat: "Let's write a Solana Playground tutorial. It should
  teach: _what the learner builds, for whom_."
- **Any other LLM:** unzip it, attach the three files to a new chat and
  paste:

  ```text
  Follow SKILL.md, AUTHORING.md and tutorial.schema.json to write a Solana
  Playground conversation tutorial. It should teach: <what the learner
  builds, for whom, in one or two sentences>.
  ```

It asks you about the level, the steps, the question each step asks and the
log line the finished program prints. Answer as the person who knows what to
teach; the format is its job. A thumbnail is optional.

## 2. Check the draft

Once, with Node 22, Yarn 1 and Git installed. The tutorial files live on the
`scope/tutorial-flow` branch until they reach the main repository:

```sh
git clone --branch scope/tutorial-flow https://github.com/hoodieshq/solana-playground.git
cd solana-playground/client-v2
../wasm/stub-packages.sh
yarn install --frozen-lockfile
yarn generate-fast
```

Once they are there, clone
`https://github.com/solana-foundation/solana-playground.git` instead, with no
`--branch`.

Save the draft as `src/tutorials/<slug>/tutorial.json`. The LLM tells you
the slug: the tutorial's name in lower case with `-` for spaces ("Hello
Vault" is `hello-vault`). Then run:

```sh
yarn tutorial:check <slug>
```

It prints `<slug>: ok`, or one line per error. Paste the errors back to the
LLM; it fixes them. Repeat until `ok`.

To see the card, run `yarn dev:with-stubs` and open
`http://localhost:3000/tutorials`.

## 3. Send it back

Send the `<slug>/` folder to the person who asked you to try this. If you
got stuck, send the last check output and where you stopped instead: that
tells us what to fix in the instruction. The Playground team adds the
thumbnail if there is none and opens the pull request that publishes it
("The pull request" in `AUTHORING.md`).
