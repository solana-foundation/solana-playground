## Context

`InteractBody` draws a `Segmented` chip group and one `Instruction` form;
`Instruction` draws Args/Accounts folds, Fee payer and "Call <name>". On
foundation master, #272 made `Instruction` a card through `Interaction`
(head with meta, body under a hairline), with groups, Test, quiet Fill with
Random and Reset, and a held reason. scope/users-work-2 has neither, and its
Instruction carries what #272 lacks: `onCall` into `runCall`, `callBlocked`,
Fee payer, the fieldset lock, restored-values check.

## Goals / Non-Goals

**Goals:** the #272 card on users-work, keeping users-work's call path,
result, history and layout, so the landing's rebase onto master resolves
toward one shape.

**Non-Goals:** #272's SearchBar work (Random inline, Copy inside the field,
placeholders); the phone page per instruction; the Test vs "Call" wording of
the result and history.

## Decisions

- **Independent folds, controlled from `InteractBody`.** `Interaction` takes
  optional `open`/`onOpenChange` (still uncontrolled for Accounts and Events).
  `InteractBody` keeps the set of open instruction names, empty on arrival
  (Almaz's #272 card and the DS prototype's foldable list; Design alignment,
  6 Nov). A history row adds its name and scrolls the card into view.
- **Card is `Instruction` through `Interaction` with `meta`**, as #272, so the
  file matches master's shape and the rebase conflict is small.
- **Result under its card**: `last` keeps the instruction name with the
  outcome; `InteractBody` renders `BaseCallResult` after that card.
- **Test via `AsyncButton loadingText="Testing…"`**; held reason as #272's
  `heldBecause` with a fee reason between wallet and filled ("Add devnet SOL
  to test"): filling fields does not help while the fee cannot be paid
  (Design alignment, 6 Nov). `callBlocked` becomes the network the SOL is
  needed on, so the row can name it.
- **Labels**: `InputLabel` takes #272's neutral tags and quiet type.

## Risks / Trade-offs

- e2e specs that press "Call <name>" or pick a chip break → updated in this
  change (the ones it touches run in CI).
- Each card creates its instruction's stored form on mount, folded or not,
  as the old Test list did.
