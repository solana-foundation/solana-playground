# Proposal

## Why

Builds on Anchor 1.1.2 stop returning the IDL to the client (HOO-2281). The
Breakpoint tutorials call their program through the IDL: the Call panel lists
its instructions, a call is encoded with it, a transaction is decoded by it,
and a build goal checks its instruction names. Without it a tutorial cannot
get past its first call. Decided on the call with Sergey Prokhorov, 7 Nov
(HOO-2688): each tutorial ships its program's IDL, generated ahead of time and
minified, and reads it instead of the build's. Generation in the build comes
back with the new build backend; this is a workaround until then.

## What Changes

- A tutorial step may carry `idl`: the IDL of the step's target program, as
  one minified JSON string, generated with Anchor 1.1.2. It holds from that
  step until the next step that carries one.
- `scripts/tutorial-idl` generates them with `anchor-lang-idl` 0.1.4, the
  generator Anchor 1.1.2's own CLI runs, and writes them into `tutorial.json`
  only on the steps whose IDL changes. `yarn tutorial:idl` runs it.
- In a tutorial that ships an IDL, the engine uses it for a landed deploy, the
  Call panel and the calls, never the build's. A build goal checks the build's
  IDL when the build returned one, and the shipped IDL when it did not.
- A deploy from the terminal is kept even when the build returned no IDL.
- A call the program cannot match against the shipped IDL (it did not decode,
  the program refused it as an unknown or undecodable instruction, or the IDL
  has no such instruction) says the code no longer matches the step, and the
  conversation offers to show the step's lines.
- A unit test regenerates nothing: it checks each shipped IDL's instruction
  names and arguments against the step's target source.

## Capabilities

### Modified Capabilities
- `tutorial-definition`: a step can ship its program's IDL.
- `tutorial-runs`: where a tutorial's IDL comes from, and what a mismatch says.

## Impact

`client-v2/src/tutorials/*/tutorial.json`, `tutorial.schema.json`,
`entities/tutorial` (types and loader), `features/tutorial-conversation`
(reducer, deploy watch, call runner, view), `tutorials/AUTHORING.md`,
`scripts/tutorial-idl`. No server change.
