# Proposal

## Why

The HOO-2434 copy diff (3 Nov 2026) found terminal and wallet strings in
client-v2 that predate Nikita's Spec 13 (the terminal and commands) and
Spec 12 (wallet and devnet SOL). No landing touches them, so they reach
Breakpoint as they are unless a change of their own fixes them. A typo in a
command prints "Process error: Command `biuld` not found." and suggests
nothing; a command that needs a wallet asks "Would you like to connect?
[yes/no] (default: yes)"; the wallet panel says nothing about what the
Playground wallet is. Ticket: HOO-2524.

## What Changes

- An unknown command prints "`biuld` is not a command. Did you mean
  `build`?" when a command is 2 edits or fewer away, and Up then Enter runs
  the suggestion. With nothing close it prints "`foo` is not a command. Type
  `help` to see commands." Shell habits (`ls`, `cd`, `cat`, `npm`, `yarn`,
  `cargo`) print "This terminal runs Playground commands, not a system shell.
  Type `help` to see them." None of these lines carries "Process error:".
- Every yes or no question in the terminal ends with `[Y/n]`, `[y/N]` or
  `[y/n]`, the default in capitals, and takes `y`, `yes`, `n` or `no` in any
  case; "(default: …)" goes from these questions.
- The wallet question reads "Playground Wallet is not connected. Connect it?
  [Y/n]" (or "No wallet is connected. Connect the Playground Wallet? [Y/n]"
  for a command that takes any wallet). A "no" ends the command with "Run
  `connect` to connect a wallet, then try again.", with no "Process error:".
- The stopped-deploy line for a buffer that could not be closed becomes two
  sentences: "… The buffer account <address> still holds its SOL. Run
  `solana program close --buffers` to reclaim it."
- The wallet panel shows a help mark beside a Playground wallet's name with
  Spec 12's help text: "A wallet kept in this browser. Playground uses it to
  sign your calls without asking. Use it for devnet, testnet and local
  clusters only."
- Telemetry: none added, renamed or removed. The code touched sits in the
  legacy roots (`utils/`, `commands/`, `components/`), outside `features/`
  and `widgets/`.

## Capabilities

### New Capabilities

- `client-v2-terminal`: how the terminal answers an unknown command and how
  it asks a yes or no question, the wallet question included.
- `client-v2-wallet`: what the wallet panel tells the person about the
  Playground wallet.

### Modified Capabilities

- `client-v2-command-stop`: the line after a stopped deploy whose buffer
  could not be closed.

## Impact

- Code: `src/utils/command.ts` (unknown command), `src/utils/terminal/`
  (question suffix and answers, a plain line with no "Process error:", the
  suggestion offered to history), `src/commands/checks.ts` (wallet question
  and its "no"), `src/commands/deploy/stopped.ts` (buffer line),
  `src/components/Wallet/Wallet.tsx` (help mark).
- Every confirm question changes its suffix, including `deploy`'s and
  `sugar`'s; answers typed as `yes` and `no` still work.
- Out of scope: the rest of Spec 13's copy table (welcome text, echo
  suffixes, offline and busy lines, the sign-in question for `airdrop`),
  "Process error:" on other failures, the wallet panel's title, its redesign
  as a popover (Spec 12 section "Screens and parts"), and every Spec 12
  string other than the panel help.
