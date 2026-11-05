# Draft a tutorial with an LLM

For an author outside the Playground team who wants to try a new
conversation tutorial. You talk the tutorial through with an LLM; it writes
one file, `tutorial.json`; a check on your machine says whether Playground
can run it. [`AUTHORING.md`](AUTHORING.md) is the full instruction, written
for the LLM, not for you.

## 1. Give the LLM two files

Any capable LLM works: a chat with file upload, or an agent in a folder.
Give it these two files from this folder:

- [`AUTHORING.md`](AUTHORING.md)
- [`tutorial.schema.json`](tutorial.schema.json)

Then paste this, with your own topic in the second line:

```text
Follow AUTHORING.md to write a Solana Playground conversation tutorial.
It should teach: <what the learner builds, for whom, in one or two sentences>.
Ask me the questions in "Settle these first", then write tutorial.json step
by step and show me each step before you go on.
```

It asks you about the level, the steps, the question each step asks and the
log line the finished program prints. Answer as the person who knows what to
teach; the format is its job.

## 2. Check the draft

Once, with Node 22 and Yarn 1 installed:

```sh
git clone https://github.com/solana-foundation/solana-playground.git
cd solana-playground/client-v2
git submodule update --init ../client/public
../wasm/stub-packages.sh
yarn install --frozen-lockfile
yarn generate-fast
```

Put the draft at `src/tutorials/<slug>/tutorial.json`, where `<slug>` is the
tutorial's name in lower case with `-` for spaces and no punctuation
("Hello Counter" is `hello-counter`), and run:

```sh
yarn tutorial:check <slug>
```

It prints `<slug>: ok`, or one line per error: where in the file, what was
expected, what it found. Paste the errors back to the LLM and ask it to fix
them; repeat until `ok`. "Reading the check's errors" in `AUTHORING.md`
explains each kind.

To see the card, run `yarn dev:with-stubs` and open
`http://localhost:3000/tutorials`.

## 3. Send it back

Send the `<slug>/` folder, with a 4:3 `thumbnail.jpg` if you have one, to
the person who asked you to try this, or the
last check output and where you got stuck. Either is useful: a stuck point
tells us what to fix in `AUTHORING.md`. To publish it, open a pull request
as "The pull request" in `AUTHORING.md` describes.
