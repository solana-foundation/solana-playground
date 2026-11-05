# Proposal

## Why

Design alignment settled on 4 Nov (GAP 2 on HOO-2581) that a terminal line takes
the design system's `TerminalLine` variant by its meaning, and that plain text
is only for command output. HOO-2581 coloured its own two lines; the rest of
Spec 13's lines still print plain, so a refused command looks like its output.
Ticket: HOO-2599.

## What Changes

- Refused or failed lines print as `error`: an unknown command, a shell habit, a
  declined wallet question, a deploy refused because the network is down, and
  every other failure a command throws ("Process error: ...").
- Notices print as `warning`: "can't be stopped", every "Stopped." line, and
  deploy's "Warning: ..." lines.
- Progress prints as `info`: "Stopping after this step…".
- Lines that already have their variant ("Building...", "Airdrop successful.")
  and command output do not change.
- No telemetry event changes: no slice under `features/` or `widgets/` is touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-terminal`: adds the rule mapping a line's meaning to its variant.

## Impact

- `client-v2/src/utils/terminal/line-error.ts`, `terminal.ts`, `utils/command.ts`,
  `commands/deploy/deploy.ts`, and their tests.
- Out of scope: the words of any line; colours of the variants (the palette
  tickets own them); Spec 13 lines the code does not print yet (Kora check,
  "Build passed in 3.4 s."); the DS terminal component.
