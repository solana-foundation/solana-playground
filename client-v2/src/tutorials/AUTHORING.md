# Writing a Playground tutorial

This is the instruction an agent follows to write a tutorial for Solana
Playground's conversation flow. Give an LLM two files, this one and
`tutorial.schema.json`, and talk the tutorial through with it. It writes one
file, `tutorial.json`, that the check accepts and Playground runs with no
code change. A pull request that adds the tutorial's folder publishes it.

If you are the agent: the person you talk to knows what the tutorial should
teach. You know the format. Ask the questions in "Settle these first",
then write the definition section by section, and show each step to them
before you go on.

## What the learner sees

A tutorial is a conversation beside an editor. The assistant explains one
piece of a Solana program in a few sentences, asks a question with three
options, and writes the code into the file when the learner picks the right
one. Routine code it writes without asking. Cards with one button run the
real thing: a build on Playground's build server, a deploy to devnet from
the learner's Playground wallet, a client script, a call with arguments.
Each step ends on a win card when its goal passes on the real result, and
the tutorial ends on a finish card.

Everything the assistant says in the lesson comes from the definition. Free
messages the learner types go to a live assistant, so the definition holds
no scripted answers to typed text.

## Settle these first

Ask the person, and write the answers down before any JSON:

1. **Who is it for, and what do they know already?** This sets the level:
   `Beginner`, `Intermediate` or `Advanced`.
2. **What does the program do when it is finished?** One sentence, and the
   one log line the finished program prints. That line is the tutorial's
   signature moment: the learner sees it come back from devnet, so the last
   step's goal is the call that prints it. If no step calls the instruction
   that prints it, add that call to the last step rather than drop the line.
3. **What are the steps?** One idea a step, from one to six steps; a
   published tutorial has four to six. Check that no step carries two ideas
   and no step is only a button.
4. **For each step:** what it teaches, the one question it asks, what the
   learner presses (build, deploy, run, call), what passes it, and the win
   line.
5. **Is there a planned failure?** Usually in step 1: the build fails on the
   error every developer meets at that level, then the assistant explains it
   and asks a "Fix it" question.
6. **Which tutorial comes next,** and which few doc pages (at most eight) the
   learner may want open beside the code.
7. **Who are the authors, and is there a thumbnail?** The pull request
   carries the image.

## The shape of a definition

```text
tutorial.json
  version: 1, name, description, authors, level, framework, languages,
  categories, thumbnail, minutes
  intro: promise, log, files
  steps[1..6]: id, title, short, objective, learned, file, start, target,
               readOnly?, beats, planned?, failsWith?, onFail?, goal, win, explain
  finish: headline, line, learned, chips, next
  docs?: title, url, file
```

The schema describes every field. The parts that need judgement:

- `name` is the card's title, and its slug is the folder's name: "Hello
  Anchor" lives in `hello-anchor/`. Write the name in letters, digits and
  single spaces; the slug is then the name in lower case with each space a
  `-`.
- `description` is one line on the card; only 72 characters show.
- `authors` are the people who wrote it, each with an optional `link`.
  `languages` are the languages of the files the learner sees: `Rust` for
  `lib.rs`, `TypeScript` for a client. `minutes` is about three a step.
- `categories` is optional: up to three from the schema's list, left out
  when none fits.
- `thumbnail` is a 4:3 image next to `tutorial.json` (`thumbnail.jpg`),
  under 1 MB. Ask the person for
  it. The check does not look for the file, but the card shows a broken
  image without it, so the pull request must carry it.
- `intro.promise` says what the learner ends with. `intro.log` is the log
  line from question 2. `intro.files` is the finished program, shown read
  only before Start, usually the last step's `target`.
- Ids never change once published: saved progress names them. They are
  lower case letters, digits, `.` and `-`. A step's id
  is a short kebab-case name for what it does (`write-program`, `deploy`).
  A beat's id is `s<step>.<word>` (`s1.boil`, `s1.what`, `s1.q1`,
  `s1.build`), and `f<step>.<word>` for a planned failure's beats
  (`f1.explain`); a win's is `s<step>.win`. Steps' ids are unique among
  steps, beats' among all beats of the tutorial.
- The examples below come from Hello Anchor, Playground's first
  conversation tutorial: four steps that write, deploy, call and change a
  program that logs a greeting.
- Text fields take inline Markdown only: `code`, _emphasis_, links. A text
  can be `{ "text": "...", "phone": "..." }` when a shorter line reads
  better on a phone.
- Optional fields are left out, never written as `null`, except where the
  schema allows `null` (`finish.next`, a right option's `why`). Empty lists
  are fine where the schema allows them (`finish.chips`).

## Steps and their files

Every step carries whole files, never edits:

- `start`: every file as the step finds it. Step 1 usually starts with
  `{ "src/lib.rs": "" }`.
- `target`: every file as the step leaves it. Each block a beat writes must
  appear in the target's file, its lines in a row, unless the write names
  its own `ref` (the planned failure, below).
- `file`: the step's main file, the one the editor shows.
- `readOnly`: files the learner cannot edit in this step. A step that only
  deploys and calls changes no file: its `target` equals its `start`, and
  its files may be read only.

How a block lands: Playground finds the block's lines in the target and
rebuilds the file from the target, keeping the lines the file already has.
So blocks land in their place whatever order the beats write them in. The
check does not test rule 1, nor rule 3 for a write without its own `ref`;
break them and the check still passes, but blocks land in the wrong place.
The rules:

1. **A step's `start` is the previous step's `target`, copied exactly.** A
   line the learner's file has that neither the start nor the target knows
   makes the block go to the end of the file instead.
2. **Copy each block out of the target, never retype it.** The check
   compares the block's lines with the target's after trimming each line and
   dropping blank ones: any other difference, a space inside a line, a
   comment, the text in a `msg!`, is refused. Keep the target's indentation
   in the block, since what lands is the block's own text.
3. **Make each block, as a run of lines, unique in the target** (or in its
   `ref`, where the check enforces it). A block
   lands at the first place its lines appear in a row, so a block of only
   `}` lines lands at the first `}`. Start the block from a line that names
   something. Single lines may repeat, with one catch: a line the file
   already has (`Ok(())`, `}`, `#[account(mut)]`) can show early in a part
   of the target not written yet. Write look-alike pieces, two instructions
   or two account structs of the same shape, in one block.
4. **Leave `declare_id!("11111111111111111111111111111111")` as it is.**
   Playground writes the learner's program id into it.
5. **The learner's own words survive.** When the learner types the key
   line by hand, the text inside their `msg!("...")` is kept, as long as it
   fills as many `{}`; the rest of the block is the target's.
6. **A client file is TypeScript run by Playground**, with `pg.program`
   (the deployed program, from its IDL), `pg.wallet`, `pg.connection` and
   `web3` in scope.
7. **Keep state in accounts a call can find by itself.** A `call` card and
   the Call panel fill an instruction's accounts the way Anchor's client
   does: the learner's wallet as the signer, the System Program, and
   accounts at a program derived address (PDA) whose seeds are constants
   and other accounts (`seeds = [b"counter", user.key().as_ref()], bump`).
   An account made from a fresh keypair has no address a card can fill, so
   write such a program with a PDA, or create the account in a client file
   and use a `run` act.

For the planned failure, the beats before the first build write a file that
really fails with the error you want, and the fix question's block is what
makes it build. `failsWith` is a line of the build log that marks it, such as
``cannot find type `Hello` in this scope``: a failed build whose log does not
hold it is treated as unplanned. The error may have a code or not; the card
shows the one holding `failsWith`, with its file and line when the log gives
them. Ask the person to build that file in Playground and copy the line from
its log before you write the failure's copy around it.

**A write that builds something other than the target: `ref` and `start`.**
The failing file is not the step's target, and its blocks may not be in the
target as written (`InitPlayer` without `system_program`) or may sit there
in another order. Give each such write the file it belongs to:

- `ref`: the whole file the block lands in, here the failing build. The
  block lands where `ref` has it, and the file is rebuilt from `ref` instead
  of the target. The check wants the block in `ref` exactly once, and does
  not look for it in the target.
- `start`: the file as this write finds it, when that is not the step's
  `start`. Its lines count as known; any that `ref` lacks go when the file is
  rebuilt from `ref`. Every line the file can hold at that point must be in
  `ref` or `start`, or the block goes to the end of the file instead. The fix question's write usually needs it: it replaces lines of
  the failing build, which the step's `start` does not hold. Give it the
  failing build as `start` and the step's target as `ref`.

Each falls back on its own: a write with only `ref` still takes the step's
`start`. The write's `file` must still be a file of the step's target. A
write with neither lands against the step's target and start, as above. The
example below is a fix question's write.
Give every write of the failing build the same `ref`, so the lines the
failure's copy quotes ("line 20") are the lines the learner sees.

```text
"writes": {
  "file": "src/lib.rs",
  "block": "    pub board: Box<Account<'info, Board>>,",
  "ref": "<the step's target for src/lib.rs>",
  "start": "<the failing build of src/lib.rs>"
}
```

## The four beats

A step's `beats` play in order. Each is one of four kinds. A step usually
runs: routine `write`s and a `say`, its question, then its `act`s. Every
step has at least one beat; a question is what makes it a lesson.

### `say`: the assistant explains

Two to four sentences. It may quote one line of a file, lit or marked as an
error; `line` counts from 1 in the file as it stands at that moment.

```json beat
{
  "kind": "say",
  "id": "s1.what",
  "text": "A program does its work in instructions: functions inside a module marked `#[program]`. Yours is `hello`. I'll put the module under those two lines, and you pick its one line of code. A program on Solana has no terminal: the only place it can write is the program log, which comes back with every transaction."
}
```

```json beat
{
  "kind": "say",
  "id": "f1.explain",
  "text": "Line 9 asks for `Context<Hello>`: the accounts `hello` works with, described by a type called `Hello`. That type doesn't exist yet, so the compiler stops. `hello` reads no accounts, so the type can be empty. The fix goes at the bottom of lib.rs.",
  "quote": {
    "file": "src/lib.rs",
    "line": 9,
    "mark": "Hello",
    "tone": "error"
  }
}
```

### `write`: the assistant writes routine code

For code nobody needs to be asked about: imports, ids, boilerplate. The text
says so. `writes` is a block for a file, or `create` for a new empty file the
step's target holds.

```json beat
{
  "kind": "write",
  "id": "s1.boil",
  "text": "Every Anchor program opens with the same two lines: the import and the program's id. They're routine, so I've written them.",
  "writes": {
    "file": "src/lib.rs",
    "block": "use anchor_lang::prelude::*;\n\ndeclare_id!(\"11111111111111111111111111111111\");"
  }
}
```

```json beat
{
  "kind": "write",
  "id": "s3.file",
  "text": "A client is code outside your program that sends it transactions, like the app your users will open. I've made `client/client.ts` for it.",
  "writes": {
    "create": "client/client.ts"
  }
}
```

### `ask`: the question

Exactly three `options`, the right one's index in `answer` (0, 1 or 2), and
`why`: one reason per wrong option, `null` at the right one. `code` says
whether the options are code or prose. `right` is what the assistant says to
the right pick; `hint` helps without giving the answer away.

`writes` is the block a right pick (or Skip) writes. `key` is the one line
that counts as typing the answer by hand ("Type it myself"); a code
question's default key is its right option. Both are optional. The typed
line is compared loosely: whitespace, comments and a trailing semicolon do
not count, and the line may say more around it (`const tx =` before a
call). `typed` is what the assistant says when the learner typed it.

```json beat
{
  "kind": "ask",
  "id": "s1.q1",
  "kicker": "Question",
  "question": "Which line writes to the program log?",
  "options": [
    "println!(\"Hello, World!\");",
    "msg!(\"Hello, World!\");",
    "console.log(\"Hello, World!\");"
  ],
  "code": true,
  "answer": 1,
  "right": "Yes. `msg!` writes to the program log. I've put `hello` in the `#[program]` module, under the two lines.",
  "why": [
    "`println!` prints to a terminal, and a program on Solana has none. On chain, a program talks through `msg!`.",
    null,
    "That's TypeScript, and you'll use it in the client in step 3. Inside a Rust program the log line comes from `msg!`."
  ],
  "hint": "Think about where each line would print. A program on Solana runs on a validator, with no terminal and no console.",
  "writes": {
    "file": "src/lib.rs",
    "block": "#[program]\nmod hello_anchor {\n    use super::*;\n\n    pub fn hello(_ctx: Context<Hello>) -> Result<()> {\n        msg!(\"Hello, World!\");\n        Ok(())\n    }\n}"
  },
  "typed": "That's the line. `msg!` writes to the program log. I've put `hello` and the `#[program]` module around it."
}
```

A prediction question writes nothing: it has no `writes`, and `skipped` says
what Skip answers.

```json beat
{
  "kind": "ask",
  "id": "s2.q2",
  "kicker": "Question",
  "question": "What does a deploy give your program, so clients can find it?",
  "options": [
    "An address: its program id",
    "A URL where it runs",
    "A copy of lib.rs on devnet"
  ],
  "code": false,
  "answer": 0,
  "right": "Yes. Every program lives at an address, its program id. Watch for it when the deploy lands.",
  "why": [
    null,
    "A program isn't a web server, so there's no URL. Clients find it by its address and send it transactions.",
    "Devnet keeps the compiled program, not your source. What clients need from it is its address."
  ],
  "hint": "Clients don't browse to a program. They send transactions to it. To what?",
  "skipped": "No problem. A deploy gives your program an address, its program id. Watch for it."
}
```

The question that repairs a planned failure has the kicker `Fix it`. Its
`key` is the line that _is_ the fix, never a line that is there either way.

```json beat
{
  "kind": "ask",
  "id": "f1.q2",
  "kicker": "Fix it",
  "question": "So what does `Context<Hello>` need?",
  "options": [
    "A `Hello` account on devnet",
    "An import of `Hello` from Anchor",
    "A struct `Hello` with `#[derive(Accounts)]`"
  ],
  "code": false,
  "answer": 2,
  "right": "Exactly. `#[derive(Accounts)]` tells Anchor which accounts an instruction expects. I've added an empty one at the bottom.",
  "why": [
    "`Hello` does describe accounts, but it's a type in your code. The compiler needs it before anything reaches devnet.",
    "`Hello` isn't part of Anchor. It's yours to declare: the list of accounts `hello` reads.",
    null
  ],
  "hint": "The compiler wants a type in your own code that lists accounts.",
  "writes": {
    "file": "src/lib.rs",
    "block": "#[derive(Accounts)]\npub struct Hello {}"
  },
  "key": "struct Hello {}",
  "typed": "That's the struct. `#[derive(Accounts)]` is what tells Anchor it lists accounts, so I've put it on the line above."
}
```

### `act`: a card with one button

`act` is `build`, `deploy`, `buildDeploy` (an upgrade in place), `run` (the
step's client file) or `call`. `say` is the line above the card; `title`,
`context` and `button` are the card's.

```json beat
{
  "kind": "act",
  "id": "s1.build",
  "act": "build",
  "say": "That's a whole program. Let's compile it.",
  "title": "Build lib.rs",
  "context": "Compiles lib.rs on Playground's build server",
  "button": "Build"
}
```

A `call` names the instruction and the arguments the learner fills in, and
only a `call` has `call`. An instruction with no arguments has no `args`.
The card fills the instruction's accounts itself (see rule 7 of "Steps and
their files"). A step may hold more than one act: Hello Anchor's last step
builds and deploys, then calls.

An argument in `args` takes one of three forms:

- `"name"`: a field on the card, which the learner fills.
- `{ "name": "text", "value": "gm" }`: sent as given, with no field. The
  value is a string or a whole number (`{ "name": "at", "value": 35000 }`).
  The learner cannot change it on the card; the Call panel is where they
  try other values.
- `{ "name": "len", "value": 20480, "add": 10240 }`: the first press sends
  `value`, and each press that landed adds `add` for the next one, so the
  card sends 20480, then 30720. `add` is a whole number, at least 1. A press
  the program refused, or one that failed, sends the same value again, and
  calls made from the Call panel are not counted.

A card pressed again and again (chop until the energy runs out, grow until
the memory does) is one `call` act with `repeat`: it stays one card, with one
line per press, and offers a second button once the first press landed. Name
the first button for what the learner does, `"button": "Chop"`, and the second
for where it stops: `"repeat": { "label": "Chop until out of energy" }`.

The finished card reads its `record` and the count, with every press's line
under it: `"record": "Grew"` reads "Grew 4 times". On a repeating card `record`
is a bare past verb. Without one it reads "Called 4 times".

The card ends when the step's goal passes, so without `until` the step's goal
must be a `call` or `refused` goal of the card's own instruction. A card that is
a move on the way to the goal (Zero Copy's Grow to 40 KB before Paint) gives
`until`, a pattern over the press's log line, and needs a beat after it:
`"repeat": { "label": "Grow to 40 KB", "until": "is 40960 bytes" }`.

The account a lesson is about goes on its act, a `run` or a `call`, with
`account`, and its cards draw it after each landed run. Both kinds name the
account as the instruction does:
`"account": { "kind": "player", "name": "player", "energy": "energy", "wood": "wood", "max": 5, "refill": { "seconds": 30, "from": "lastLogin" } }`
or `"account": { "kind": "memory", "name": "map", "capacity": 40960 }`, with
`"zero": true` on an account read in place. Fields are named as Anchor's coder
gives them, camelCase. Give `refill` only on the acts whose program refills by
then. On a repeating card, `account` replaces the list of lines with one summed
line: "Chopped 6 times · 5 wood · out of energy", "Grew to 30 KB · out of memory
at 40 KB".

A call's accounts: the card fills what the IDL can derive, and each account an
earlier call of the lesson wrote to, other than the wallet, by its name. So
`grow`'s `map` takes the address `init_map` wrote to, as long as both call it
`map`.

`record`, on any act, is the line its card reads once the run landed, before
the time it took: `"record": "Created your map · 10 KB"`. Leave it out and
the card reads its usual record.

```json beat
{
  "kind": "act",
  "id": "s4.call",
  "act": "call",
  "say": "Now call it with your name. Here, or in the Call panel, where `name` just showed up.",
  "title": "Call hello",
  "context": "Sends hello with your name from your wallet",
  "button": "Call hello",
  "call": {
    "instruction": "hello",
    "args": ["name"]
  }
}
```

### The planned failure

A step with a planned failure has `planned`, `failsWith` and `onFail`;
`planned` needs the other two, and `onFail` needs `planned`. `planned` is the assistant's line inside the failed build's
card ("This one's on purpose..."). `failsWith` is the log line that marks
the failure. `onFail` holds the beats after the learner presses Explain: a
`say` with the error quoted, the `Fix it` question, and a second `build`.

## Goals, wins and the explanation

`goal` is checked on the real result, never on the assistant's opinion:

- `{ "kind": "build", "instructions": ["hello"] }`: the build passes and its
  IDL holds these instructions. Each must be a `fn` some step's target
  defines.
- `{ "kind": "deploy" }`: the program is on devnet.
- `{ "kind": "call", "instruction": "hello", "args": ["name"], "log": "Hello, .+!" }`:
  a transaction called the instruction, with a value for each of these
  arguments, and a line of its program log matches `log`. `log` is a regular
  expression, matched without regard to case, found anywhere in the line, so
  `Hello, World!` matches `Program log: Hello, World!`. Write it against what
  your own `msg!` prints, and use `.+` where the learner's input goes. Leave
  `log` out when the instruction prints nothing; Anchor's automatic
  `Instruction: ...` lines are not a goal. `$` anchors to the line's end
  (`Count: 1$` refuses `Count: 10`); the line starts with `Program log:`,
  so `^` needs it (`^Program log: Count`) or is better left out. `args` is
  optional too; each named argument needs a value that is not blank. A step
  with several calls passes on the first one that meets its goal, in
  whatever order they run.
- `{ "kind": "refused", "instruction": "chop_tree", "error": { "name": "NotEnoughEnergy", "code": 6000 } }`:
  the program refused a call of the instruction with this error. Give the
  error's `name` (the variant of your `#[error_code]` enum), its `code`
  (Anchor numbers them from 6000, in the order the enum declares them), or
  both; with both, both must match. A refusal with no error code, a panic or
  running out of memory, is named by `log` instead, a regular expression
  over the whole transaction log:
  `{ "kind": "refused", "instruction": "grow", "log": "out of memory" }`.
  Pick a phrase only the refusal you mean prints: Zero Copy's grow is also
  refused when it adds more than 10 KB at once, and "out of memory" is not
  in that log. A `refused` goal needs `error`, `log` or both. A transaction
  that never reached the program (no wallet, no funds) passes nothing, and a
  refusal on a step whose goal is not `refused` is an ordinary failure the
  assistant explains.

`win` closes the step: `headline` says what is now true ("Your program
compiles"), `line` says what that means. A headline, like a step's
`objective`, carries no closing period. `callPanelLine` replaces `line`
when the learner passed the step from the Call panel; `"extra": "openTest"`
adds an "Open Call" button. No values that only a live run knows (a program
id, a fee, a time); a value the program always gives, like `Count: 1`, is
fine.

`explain` answers "Explain this step": what the step does and how, in two to
four sentences.

## The finish and the docs

`finish.headline` and `finish.line` close the tutorial. `learned` lists one
item a step, usually each step's `learned`. `chips` are buttons that post
their `answer` with no model call. Each has a `label` and an `answer`, and
may have a `follow`, a quiet button after the answer: `nextTutorial` opens
`next`, and `openTest` opens the Call panel. The schema lists the others;
use them only when the person asks for them. `next` is the slug of a tutorial that exists,
or `null`.

`docs` lists the pages the tutorial needs, each with a `title`, its `url` on
its own site (`https` only) and a Markdown copy in the tutorial's `docs/`
folder (`"file": "idl.md"`). Links inside that Markdown are `https` too.

## The voice

- Two to four sentences a message. One rich block at most: a quoted line or
  a block of code. Inline `code` in a sentence does not count.
- Explain, then ask, then write. The assistant writes routine code itself and
  says so.
- Three options, all plausible. Each wrong option gets one or two sentences
  on why it is wrong for this program, not "incorrect".
- A hint points at the idea, never at the option.
- Every step ends on a win, and something changes in the first seconds.
- The assistant says "I", the learner is "you". Plain words; name Solana's
  terms (instruction, account, program id) the first time they appear.
- No headings, lists or tables inside a text.

## A worked example

A two-step tutorial: write a program that logs a message, then deploy it and
call it. It passes the check as it stands.

```json tutorial
{
  "version": 1,
  "name": "Echo Anchor",
  "description": "An Anchor program that logs back what you send it.",
  "authors": [{ "name": "Playground" }],
  "level": "Beginner",
  "framework": "Anchor",
  "languages": ["Rust"],
  "thumbnail": "thumbnail.jpg",
  "minutes": 5,
  "intro": {
    "promise": "You'll write a program that logs back what you send it, and call it on devnet.",
    "log": "Program log: Echo: gm",
    "files": {
      "src/lib.rs": "use anchor_lang::prelude::*;\n\ndeclare_id!(\"11111111111111111111111111111111\");\n\n#[program]\nmod echo_anchor {\n    use super::*;\n\n    pub fn echo(_ctx: Context<Echo>, text: String) -> Result<()> {\n        msg!(\"Echo: {}\", text);\n        Ok(())\n    }\n}\n\n#[derive(Accounts)]\npub struct Echo {}\n"
    }
  },
  "steps": [
    {
      "id": "program",
      "title": "Program",
      "short": "Program",
      "objective": "Write echo, which logs the text it gets",
      "learned": "Taking an argument and logging it",
      "file": "src/lib.rs",
      "start": { "src/lib.rs": "" },
      "target": {
        "src/lib.rs": "use anchor_lang::prelude::*;\n\ndeclare_id!(\"11111111111111111111111111111111\");\n\n#[program]\nmod echo_anchor {\n    use super::*;\n\n    pub fn echo(_ctx: Context<Echo>, text: String) -> Result<()> {\n        msg!(\"Echo: {}\", text);\n        Ok(())\n    }\n}\n\n#[derive(Accounts)]\npub struct Echo {}\n"
      },
      "beats": [
        {
          "kind": "write",
          "id": "s1.boil",
          "text": "Every Anchor program opens with the same two lines: the import and the program's id. They're routine, so I've written them.",
          "writes": {
            "file": "src/lib.rs",
            "block": "use anchor_lang::prelude::*;\n\ndeclare_id!(\"11111111111111111111111111111111\");"
          }
        },
        {
          "kind": "write",
          "id": "s1.accounts",
          "text": "At the bottom goes `Echo`, the list of accounts your instruction works with. `echo` reads none, so it's empty.",
          "writes": {
            "file": "src/lib.rs",
            "block": "#[derive(Accounts)]\npub struct Echo {}"
          }
        },
        {
          "kind": "ask",
          "id": "s1.q1",
          "kicker": "Question",
          "question": "Where does the text the caller sends go?",
          "options": [
            "pub fn echo(_ctx: Context<Echo>, text: String) -> Result<()> {",
            "pub fn echo(text: String) -> Result<()> {",
            "pub struct Echo { text: String }"
          ],
          "code": true,
          "answer": 0,
          "right": "Yes. Anchor hands `echo` its `Context` first, then the caller's arguments. I've written the rest of `echo` around it.",
          "why": [
            null,
            "Anchor always passes the `Context` first, even when the instruction reads no accounts.",
            "`Echo` lists accounts, not the values a caller sends. Text is a plain argument."
          ],
          "hint": "Anchor passes the accounts first. What comes after them?",
          "writes": {
            "file": "src/lib.rs",
            "block": "#[program]\nmod echo_anchor {\n    use super::*;\n\n    pub fn echo(_ctx: Context<Echo>, text: String) -> Result<()> {\n        msg!(\"Echo: {}\", text);\n        Ok(())\n    }\n}"
          }
        },
        {
          "kind": "act",
          "id": "s1.build",
          "act": "build",
          "say": "That's the whole program. Let's compile it.",
          "title": "Build lib.rs",
          "context": "Compiles lib.rs on Playground's build server",
          "button": "Build"
        }
      ],
      "goal": { "kind": "build", "instructions": ["echo"] },
      "win": {
        "id": "s1.win",
        "headline": "Your program compiles",
        "line": "Its IDL has one instruction, `echo`, with one argument, `text`."
      },
      "explain": "This step writes a program with one instruction, `echo`, that logs the text it is sent. Then the build checks it."
    },
    {
      "id": "call",
      "title": "Deploy and call",
      "short": "Call",
      "objective": "Deploy the program and call echo",
      "learned": "Deploying and calling with an argument",
      "file": "src/lib.rs",
      "start": {
        "src/lib.rs": "use anchor_lang::prelude::*;\n\ndeclare_id!(\"11111111111111111111111111111111\");\n\n#[program]\nmod echo_anchor {\n    use super::*;\n\n    pub fn echo(_ctx: Context<Echo>, text: String) -> Result<()> {\n        msg!(\"Echo: {}\", text);\n        Ok(())\n    }\n}\n\n#[derive(Accounts)]\npub struct Echo {}\n"
      },
      "target": {
        "src/lib.rs": "use anchor_lang::prelude::*;\n\ndeclare_id!(\"11111111111111111111111111111111\");\n\n#[program]\nmod echo_anchor {\n    use super::*;\n\n    pub fn echo(_ctx: Context<Echo>, text: String) -> Result<()> {\n        msg!(\"Echo: {}\", text);\n        Ok(())\n    }\n}\n\n#[derive(Accounts)]\npub struct Echo {}\n"
      },
      "readOnly": ["src/lib.rs"],
      "beats": [
        {
          "kind": "act",
          "id": "s2.deploy",
          "act": "deploy",
          "say": "Deploy it to devnet, Solana's test network. Your Playground wallet pays in devnet SOL, which is free.",
          "title": "Deploy to devnet",
          "context": "From your Playground wallet on devnet",
          "button": "Deploy"
        },
        {
          "kind": "act",
          "id": "s2.call",
          "act": "call",
          "say": "Now send it something, and watch the log.",
          "title": "Call echo",
          "context": "Sends echo with your text from your wallet",
          "button": "Call echo",
          "call": { "instruction": "echo", "args": ["text"] }
        }
      ],
      "goal": {
        "kind": "call",
        "instruction": "echo",
        "args": ["text"],
        "log": "Echo: .+"
      },
      "win": {
        "id": "s2.win",
        "headline": "Your program answered from devnet",
        "line": "The log line came back in the transaction your wallet signed.",
        "callPanelLine": "You called `echo` from the Call panel, which Playground built from the IDL."
      },
      "explain": "This step puts the program on devnet and calls `echo` with your text. The log line comes back in the transaction."
    }
  ],
  "finish": {
    "headline": "You built and called a Solana program",
    "line": "Your text went to devnet and came back in the program log.",
    "learned": [
      "Taking an argument and logging it",
      "Deploying and calling with an argument"
    ],
    "chips": [],
    "next": null
  }
}
```

## From a prototype script

The person may hand you a script from Playground's design prototype: a
TypeScript lesson module that exports a `Lesson` with `card`, `steps` and
copy. Given one, carry its copy over word for word, and map its fields:

- `card.name`, `card.level`, `card.framework` → `name`, `level`, `framework`
- `by` → `authors[0].name`
- `line` → `description`
- `intro`, `proof`, `preview` → `intro.promise`, `intro.log`, `intro.files`
- `headline`, `proofLine` → `finish.headline`, `finish.line` (fixed text, no live data)
- `next`, `nextLine` → `finish.next`, a chip with `"follow": "nextTutorial"`
- a step's `start`, `target` (strings) → `{ "<file>": "..." }` objects with every file of the step
- `explainStep`, `testWin` → `explain`, `win.callPanelLine`
- `goal: "build"`, `"deploy"` → `{ "kind": "build", "instructions": [...] }`, `{ "kind": "deploy" }`
- `goal: "run"` or `"call"` → `{ "kind": "call", "instruction": ..., "log": ... }`
- an act `chop`, `send` or `grow` → a `call` act: its `ix` (or the
  instruction its program's move sends, `chop_tree` for a chop) →
  `call.instruction`, its `button` and `record` kept; the values the move
  sends → `args` with a `value` (and `add` when it grows each press)
- a goal `chop`, `send` or `grow` → read the lesson's `chopPasses`,
  `growPasses` or `panelPasses` for the step: a step that passes when the
  program refuses (`!c.ok` or `!row.ok`: `chop_tree` refused with
  `NotEnoughEnergy`, a grow out of memory) → `{ "kind": "refused", ... }`
  with the error or log the lesson's refusal carries; a step that passes when
  a call lands (`c.ok`, or `panelPasses` naming an instruction such as
  `paint`) → `{ "kind": "call", "instruction": ... }`. When the function
  checks anything else, stop and report.
- beats, `planned`, `onFail` → the same, minus the fields below

Drop, because Playground does it for real or the live assistant does it:
`win.stats`, every `chips`, `errorChips` and `answers` with a `match`,
`plannedShort`, an ask's `n`, a write's `ref`, an act's `ix` (now in
`call`), and the lesson's `checks`, `game`, `memory`, `runTx`, `callTx`, `programId`,
`idlAccount` and `txSignature`.

**Stop and report** when the script needs something the format cannot say: a
goal on an account's size, or a value read from the data of an account the
lesson made earlier (the address carries over, the data does not). Do not invent a field: the check refuses any field the schema does not
name. Tell the person which step needs what, and ask the Playground team.

## Running the check

In a clone of the repository, from `client-v2/`:

```sh
yarn tutorial:check <slug>
```

It prints `<slug>: ok`, or every error and exits with code 1. Fix them all and
run it again; never hand in a definition the check refuses.

## Reading the check's errors

Each error is a JSON path into `tutorial.json`, what was expected there, and
what was found. `steps[0].beats[2]` is the third beat of the first step;
counting starts at 0. These are the lines the check prints for the worked
example above, broken one way each:

- `steps[0].beats[2].why[2]: a wrong option needs a reason, found null`
  Option 2 is wrong (`answer` is not 2) and has no reason. Write one sentence
  on why it is wrong, or fix `answer` if option 2 is the right one.
- `steps[0].beats[2].why[0]: null at the right option, found "Right, but why?"`
  The right option's reason must be `null`; its words go in `right`.
- `steps[0].beats[2].answer: the right option is 0, 1 or 2, found 3`
  `answer` counts from 0.
- `steps[0].beats[1].writes.block: a block in the step's target src/lib.rs, found "pub struct Other {}"`
  The block's lines are not in the target's file in a row; the found value is
  its first line. Copy the block out of the target again.
- `steps[0].beats[0].writes.file: a file in the step's target, found "src/other.rs"`
  A block or a `create` names a file the step's target does not have.
- `steps[1].goal.instruction: an instruction a step's target defines, found "shout"`
  No step's target has `fn shout`. Check the spelling, in snake case as in
  Rust.
- `finish.next: the slug of a tutorial, found "nowhere"`
  `next` names no tutorial. Use an existing slug, or `null`.
- `steps[1].beats[0].id: an id no other beat has, found "s1.boil", also at steps[0].beats[0].id`
  Two beats share an id.
- `steps[1].goal: one of the shapes the schema allows, found an object`
  A goal whose fields fit no kind: most often a `refused` goal with neither
  `error` nor `log`. Name the error, a log phrase, or both.
- `steps[1].beats[1].call.args[1]: a name no other argument of this call has, found "text", also at steps[1].beats[1].call.args[0]`
  One argument appears twice in `args`. Keep one: a field or a value.
- `steps[1].goal.log: a regular expression, found "("`
  `log` is a regular expression. Escape `( ) [ ] { } . * + ? | ^ $` when you
  mean the character itself, written `\\(` inside JSON.
- `name: a name whose slug is the folder's, "echo-anchor", found "Echo Program"`
  The folder and the name disagree. Rename one.
- `steps[0]: needs "title", found none`
  A required field is missing.
- `colour: no such field, found "red"`
  A field the schema does not name. Remove it; there is no place for it.
- `steps[1].beats[0].kind: one of "say", "write", "ask", "act", found "shout"`
  A beat kind that does not exist.
- `steps[1].beats[1]: needs "call", found none`
  A `call` act without its `call`. Only a `call` act may have one.
- `steps[0]: needs "planned", found none`
  `onFail` and `planned` come together.
- `steps[0]: needs "failsWith", found none`
  A planned failure names the log line that marks it, with `planned` and
  `onFail`.
- `steps[1].readOnly[1]: a file in the step's start or target, found "Anchor.toml"`
  A read-only file the step does not have.
- `docs[0].file: a Markdown file in the tutorial's docs folder, found no "programs.md" there`
  Add the page under `docs/`.
- `docs[0].file: https links only, found "http://solana.com" in idl.md`
  Links in a doc page are `https`.
- `level: one of "Beginner", "Intermediate", "Advanced", found "Expert"`
  A value outside the list the schema allows.

## Trying it locally

In a clone, from `client-v2/` (Node as pinned in the repository, Yarn 1).
The check reads the other tutorials' names from `client/public`, a
submodule that `yarn generate-fast` copies in:

```sh
git submodule update --init ../client/public
../wasm/stub-packages.sh
yarn install --frozen-lockfile
yarn generate-fast
yarn tutorial:check <slug>
yarn dev
```

Open `http://localhost:3000/tutorials`: the card shows under its level with
its thumbnail and its level and framework. Opening it runs the conversation
once the conversation view is in the branch you run (it is being built in
November 2026); until then, the check and the pull request's review are the
gate.

## The pull request

The tutorial is one folder, `client-v2/src/tutorials/<slug>/`:

```text
<slug>/
  tutorial.json
  thumbnail.jpg
  docs/          only when the definition lists docs
    <page>.md
```

Open a pull request that adds it, titled `feat(tutorials): <name> tutorial`.
Its description says what the tutorial teaches, lists the steps, and pastes
the output of `yarn tutorial:check <slug>`. CI runs the check on every pull
request; the merge publishes the tutorial. There is no admin panel and no
upload service.
