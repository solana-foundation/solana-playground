# Design

## Context

Every terminal failure goes through `PgTerm.process`, which prints
"Process error: <message>" for any thrown error except a `StoppedError`,
whose message prints as is. The unknown command throws from
`PgCommandManager.execute`; the wallet "no" throws from `checks.ts`.
`waitForInput` builds the confirm suffix itself (` [yes/no]` plus
` (default: yes)`) and accepts only `yes` and `no`. The wallet panel is the
legacy styled-components window in `components/Wallet/Wallet.tsx`; the DS
prototype draws no wallet panel, so Spec 12 is the only source for its help.

## Goals / Non-Goals

**Goals:**

- The Spec 13 lines for an unknown command, a shell habit, the wallet
  question and its "no", and the stopped deploy's kept-buffer line.
- The Spec 12 help text in the wallet panel.

**Non-Goals:**

- "Process error:" on every other failure (Spec 13 bans it everywhere; that
  is a sweep of its own).
- The wallet panel's redesign as a popover, its title, its other strings.

## Decisions

- **A plain-line error.** A `TerminalLineError` (in `utils/terminal`) is a
  failure whose message the terminal prints as is. `PgTerm.process` prints
  it like a stop's message; it still rejects, so a button that ran the
  command still sees a failure. `StoppedError` stays separate: a stop is not
  a failure and is never toasted. Alternative: print and return from the
  unknown-command branch. Rejected: the wallet "no" happens deep in a
  command and must end it.
- **Suggestion by Damerau-Levenshtein distance** (optimal string alignment)
  over top-level command names, at most 2, ties to the earlier in
  `PgCommandManager.all` order, the order `help` lists. A swap counts as one
  edit, so `biuld` is 1 away from `build`.
- **Up runs the suggestion** by pushing it onto the shell's history before the
  line is printed. History moves a repeated entry to the
  end already, so the suggestion never duplicates.
  The suggestion and its line come from `unknownCommand`
  (`utils/terminal/unknown-command.ts`); the history push is
  `PgTerm.offerFromHistory`, and a failure there is logged, never shown in
  place of the line.
- **The confirm suffix is the terminal's**, not each caller's: `[Y/n]`,
  `[y/N]` or `[y/n]` from `default`. Every confirm in the app gets it,
  `deploy`'s and `sugar`'s included; Spec 13's rule is general. Answers are
  folded to lower case and `y`/`n` mapped to `yes`/`no`, so the programmatic
  `executeFromStr("yes")` answers still work.
- **The any-wallet question** ("No wallet is connected. Connect the
  Playground Wallet? [Y/n]") is ours: Spec 13 quotes only the Playground
  Wallet's. `connect` with no argument connects the Playground Wallet, so the
  question names what a yes does.
- **The kept-buffer line** splits at its semicolon. Spec 13 leaves that line
  to dev (open question 3); design confirmed the stop "as built" on 30 Oct
  without quoting it.
- **The wallet help** uses `HelpTip` from `shared/ui` beside the title, only
  for a Playground wallet: "kept in this browser" and "signs without asking"
  are false for an extension wallet.

## Risks / Trade-offs

- A distance-2 suggestion can be wrong for a short word (`ai` is 2 from
  `cd`). The shell-habit list is checked first, so the common shell words
  never get a suggestion.
- The suffix change touches every confirm. Tests that match "[yes/no]" move
  with it.
