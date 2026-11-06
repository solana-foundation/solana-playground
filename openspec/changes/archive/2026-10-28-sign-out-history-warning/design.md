# Design

## Context

Sign-out runs `relinquish` in `effects/session`: it pushes every thread
(`PgChatSync.handOver`) and every project (`releaseLocalProjects`), removes
from the browser what the account demonstrably holds, then closes the open
thread. Whatever the person types afterwards is stored only in this browser,
capped at 200 items a thread (`MAX_MESSAGES_PER_THREAD`), until they sign in
here again, when `adoptAccountThreads` merges it into the account's copy.

The dialog's current text says projects and chats stay in the browser, which is
false for everything already in the account.

## Goals / Non-Goals

**Goals:**

- The dialog's strings from Spec 02, "Account copy".
- The AI-11 line from Spec 08.

**Non-Goals:**

- The sign-out leftovers line ("{n} projects stayed...").
- A line that says more than AI-11 (the 200-message cap, for instance):
  Spec 02 and Spec 04 state the cap but give it no string.

## Decisions

- **AI-11 shows for any signed-out person, not only after a sign-out in this
  tab.** The spec's trigger is "signed out". Tying it to a sign-out event
  would need state that survives a panel unmount and a reload, and would
  still leave a never-signed-in person untold. A sign-out in this tab ends in
  `closeThread`, so the panel is empty right after it; the line comes with the
  next thread that holds messages: a thread `handOver` could not upload and
  kept, or the first message written signed out (own key only: the default backend refuses a signed-out turn and opens
  Connect a model instead).
- **Drawn from state, like `unsaved`.** `BaseThread` takes a `signIn` prop
  (`null` when the line is hidden) and renders it after the items. A stored
  notice item would be uploaded into the account on the next sign-in.
- **Gated on `PgSyncClient.available()`.** On a deployment without a database
  "on your other devices" is false. A definite answer is memoised, so the
  panel adds no request once sync has answered; a probe with no answer is
  asked again on the next mount and hides the line until then. Exported through
  `features/persistence/index.ts` rather than a deep import.
- **Waits on `PgSession.afterRead`, a new wait that never reads.** Before the
  first session read `get()` is `null`, so the line would flash at a signed-in
  person. `whenRead` cannot be used: it starts the read when none has, the
  panel can mount before the session effect, and the effect then finds the
  user already signed in, never adopts the account, and holds every push --
  sign-out then waits on `pushCurrent` for good. `afterRead` settles on the
  page's own read.
- **Gated on a non-empty thread.** An empty thread shows its suggestions;
  there is no conversation to keep yet.
- **Sign-in from `assistant`.** The same origin Connect a model passes, so the
  session effect's `adopt` does not open the account's latest project over
  the one the person is in. Failures go to the account row
  (`PgSession.signInState`), as `SetupList`'s sign-in does; the button only
  logs them.
- **Layout.** A `Callout` with role `status`, like the thread's other notices,
  and an outline `Button` (size `sm`) under the text. No design-system part
  is drawn for it; the line reuses existing parts.

## Risks / Trade-offs

- The line shows on every signed-out thread with messages, which a person who
  never wants an account sees each time. AI-11 classes it as "Informs", which
  the spec chose knowing that.
