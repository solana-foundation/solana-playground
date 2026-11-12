# Account views Implementation Plan

**Goal:** the player and memory cards on the tutorial's act and result cards, from real readings.

**Architecture:** the definition names a view on an act; the runner reads that account after landing and saves the reading in the result; `view.ts` hands the cards the view with its latest reading; pure functions in `model/account-view.ts` do the projection, the heap and the summed record.

**Spec:** `openspec/changes/tutorial-account-views/`. Mode: inline.

## Review Focus

- An IDL's `big_map` against a definition's `bigMap`: matched with `sameIdlName`.
- An account too small for its layout (a 10 KB zero copy map): size kept, fields empty.
- A saved reading that does not parse: dropped, the run stays.
- A refused press: no reading; the card keeps the one before it.
- A field missing from a reading: the player card reads 0, never NaN.

## Tasks

- [x] 1 Definition: `AccountView` in types, schema, `check.ts` (only on `run`/`call`), AUTHORING.md. Test: check rejects it on a build.
- [x] 2 Model: `AccountReading` on the landed result, `parseResult` keeps a sound one, `model/account-view.ts`: `latestReading`; the widget's `model/account-card.ts`: `playerNow`, `heapOf`, `summedRecord`. Tests per Review Focus and the spec's scenarios.
- [x] 3 Runner: `RunInput.account`, `RunPort.readAccount`, `runners/account-read.ts` (`readingOf`, scalars only). Tests: landed read, failed read reported, refused press unread.
- [x] 4 View: `account` on act and result turns.
- [x] 5 UI: `BasePlayerCard`, `BaseMemoryCard`, `BaseAccountView` (ticks), act card and result card, summed record. Component tests.
- [x] 6 Verify: `yarn run check`, screenshots on a fixture, gate.
