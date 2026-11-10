# Design

## Context

`noticeCondition` (`widgets/status/model/notice.ts`) is the one reading of "the network is down", through `networkIndicator`. `useStatus` gives the three indicators wherever they are drawn. The rail and the chip swap at breakpoints, so a region inside them would remount; Flow does not.

## Goals / Non-Goals

**Goals:** the three items in the proposal, with the status and the buttons unable to disagree.

**Non-Goals:** new words on the indicators, telemetry, a hold on Build (Build's own request fails with its own message, and Spec 06 lists only Deploy and Interact).

## Decisions

- **`announcement({ before, after, notice })` is pure** in `model/announce.ts`, and the module's `useAnnouncement` hook holds only the previous indicators and the text. It compares `words`, not `state`, so offline to not responding counts and a counting start does not. It speaks `label` ("Rust analyzer, failed", "AI, off"). The network's `label` names an action ("Change cluster, currently devnet, not responding"), so the network alone carries `announced`, "Devnet, not responding" (design alignment, 5 Nov).
- **Almaz's draft** exists on no branch; this follows the description in his DES-126 comment.
- **Hide Reload** rather than warn: DES-126 allows either; a button that loses the build is the thing to remove, and the panel still says why (Spec 06: every Not ready state has an action or says why it can't). `analyzerIndicator` stays as it was and pure; `holdingReload(indicator, run)` takes the Reload off, and `useStatus` reads the run from `PgFlow`.
- **Holds read one function**, `networkHold`, over `noticeCondition`, so a condition added there holds the buttons too. No new caption on Deploy (design alignment, 5 Nov): the notice over the stage says the reason already, so it goes on the pill's existing tooltip and Interact's existing "why Test waits" line.
- **The refusal is a `preCheck` on `deploy`**, the single door the assistant's tool, the file menu and the terminal all pass. A check at each caller would miss the next one. It runs only when `deployState` is `ready`, since the same command pauses and resumes.

## Risks / Trade-offs

- A refused run is a `NetworkRefusedError`, so it is told apart from a failure: Deploy keeps what it had (`deploy-refused`), and the assistant says the deploy did not start. It still asks for approval first, since the check lives in the command.
- `isConnected` is polled, so a hold can trail reality by one poll. The notice has the same lag, so they agree.
- A dismissed notice leaves a phone with no reason on Deploy but the status chip, which keeps saying it. Accepted by design alignment.
