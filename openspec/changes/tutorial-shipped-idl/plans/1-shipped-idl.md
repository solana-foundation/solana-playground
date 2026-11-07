# Plan: shipped tutorial IDL (tasks 1.1-1.3)

Goal: the Breakpoint tutorials call their program through an IDL they ship,
so a build that returns no IDL (Anchor 1.1.2) still gets through every step.

Steps, each test-first:

1. `entities/tutorial`: `Step.idl?: string` in the type, the JSON schema and
   the loader's check (a string that parses as JSON with `instructions`).
   `shippedIdl(definition, cursor)` in the conversation model, unit-tested on
   a three-step definition (before, on and after the carrying step; finish;
   intro).
2. `reduce`: a landed deploy (`ended`, `recognised`) keeps the shipped IDL
   when there is one, else the result's; a `deployed` action without an IDL
   is kept with the shipped one; an ok build with no instructions gets the
   shipped IDL's names. Reducer tests for each, and one that a tutorial with
   no `idl` behaves as before.
3. `deploy-watch`: a landed deploy with no IDL still calls `onIdl`
   (`undefined`); the `deployed` action's `idl` becomes optional.
4. Mismatch: `goalGap` answers `mismatch` for an undecoded call;
   `whyRefused` words it; the call runner rewrites a refusal with Anchor error
   101 or 102, and `sendCall`'s missing instruction, to the same line.
5. `scripts/tutorial-idl`: Cargo workspace + `generate.mjs`; run it, commit
   the IDLs in both tutorials.
6. Drift test in `src/tutorials/shipped-idl.test.ts`: per step with a target `src/lib.rs`, the
   `pub fn`s of the `#[program]` module and their argument names against
   `shippedIdl` at that step.
7. `AUTHORING.md`: when and how to regenerate.

Gate: `yarn run check` in `client-v2`; no e2e spec is added or changed.
