# Design

## Where the IDL lives

On the step, in `tutorial.json`, as `idl`: a string holding minified JSON. A
string, not an object, so the file stays readable around it and an author
never hand-edits it; one file, so the step and its program's IDL cannot drift
apart in two places. Only a step whose target program's IDL differs from the
previous step's carries one; the first step with a program always does.

`shippedIdl(definition, cursor)` is the `idl` of the latest step at or before
the cursor's that carries one, read through `entities/idl` (`readIdl`) into the
0.29 shape the client calls with. On the finish card it is the last one; on
the intro there is none.

## Which IDL wins

| Use | Tutorial ships one | Ships none |
| --- | --- | --- |
| Kept on a landed deploy (act card, recognised, terminal) | shipped, at the deploying act's step (the cursor's for a terminal deploy) | the build's |
| Call panel, call encoding, decoding | the deployed one (so shipped) | the deployed one |
| Build goal's instruction names | the build's if it lists any, else the `pub fn`s of the learner's `#[program]` module | the same |
| `pg.program` in a client run | the deployed one, stored for the program when the build left none | the build's |

The build goal reads what the learner wrote: the build's IDL when there is
one, else the learner's own source. The shipped IDL is the lesson's program,
so a goal judged on it would pass code that lacks the instruction. Everything that talks to the chain
uses the shipped one, because the build no longer returns any.

The deployed IDL is taken once, in `reduce`, on the action the runner
returned: runners stay unaware of tutorials. The build runners read the
learner's source themselves (`builtInstructions`), with no tutorial in it.

## Mismatch

The learner can change the program away from the step's interface. Three
signals, all on a call:

- the transaction did not decode with the IDL (`undecoded`): the goal gap
  becomes `mismatch`;
- the program refused it with Anchor's `InstructionFallbackNotFound` (101) or
  `InstructionDidNotDeserialize` (102);
- the IDL has no such instruction (`sendCall` throws).

The failed call says "Your code no longer matches what this step expects. Fix
it in the editor and build and deploy again." In the conversation, an act
card's failed call is followed by the offer alone, "I can show you the lines
this step needs.", with "Show me the fix", which writes the step's target
`src/lib.rs`. The Call panel has no such action, so its line offers none, and
neither does a landed call that did not decode (a landed run's record keeps no
fix). "IDL" stays out of the learner's text (Design alignment, 7 Nov).

## Generation

`client-v2/scripts/tutorial-idl` is a Cargo workspace: `program/` is an Anchor
1.1.2 crate whose `lib.rs` the script writes, `generator/` calls
`anchor_lang_idl::build::IdlBuilder` (0.1.4, pinned by anchor-lang 1.1.2) and
prints the IDL. `generate.mjs` walks every tutorial step's target `src/lib.rs`
and writes the minified IDL where it changes. It needs a Rust toolchain; CI
does not run it. The unit test that guards drift needs no Rust.
