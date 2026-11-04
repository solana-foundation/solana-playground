# Proposal

## Why

Design's pass over the assistant (DES-196, under DES-191) found the refused key
error short of Spec 08: it names the backend by its list name ("OpenAI-compatible
did not accept this key"), offers one **Enter key** button where Spec 08 state
AI-05 offers two ways out, and that button is 28px tall on a phone. Spec 08's
"Open settings" does not fit this app: the Settings page can only delete a key,
and a key is entered in Connect a model.

## What Changes

- The refused key error names the provider the way the head does ("OpenAI did
  not accept this key."), and its buttons say what to do.
- Its **Enter key** button becomes **Change key**, beside a new **Use hosted
  model** button, offered while the deployment serves a hosted model. Use hosted
  model switches the thread to the hosted model and puts the refused message
  back in an empty composer; it never sends. Signed out, it opens Connect a
  model on the hosted model, where the sign-in is.
- Both buttons, and Try again on the same error, are the design system's new
  `CalloutAction`: a fill in the callout's tone, a step denser than the
  callout, no edge of its own, Change key first. The callout's message is at
  full strength when it has actions. An outline Button drew an opaque
  grey patch on the red tint. The AI-off row's buttons are 44px tall on a
  phone.
- Every other callout that holds buttons takes `CalloutAction` too: the
  assistant's "The model is busy" (Try now, Stop), the AI-off row (Sign in with
  GitHub, Try again, Add an API key), a stopped reply's Try again, and the sync
  conflict banner (Resolve…, its answers). The banner's `primary` flag goes:
  the first answer is the expected one, and the look no longer differs.
- Telemetry: `assistant_model_picked` gains `via: "key-rejected"` for a switch
  made from the error. No event is added, renamed or removed.
- Not in the specs, done in the same PR: the patch card's outcome lines in
  sentence case without `--`, the head's icon buttons 44px on a phone, the
  composer's model and effort buttons 48px on a phone (design system, through
  `yarn ds-add composer`), and the S and K shortcut hints hidden on a phone.

## Capabilities

### New Capabilities

### Modified Capabilities

- `assistant-own-key`: the refused key error's words and its two buttons, and
  the new `via` value of `assistant_model_picked`.

## Impact

- `client-v2/src/widgets/assistant`: the thread's error item, the thread's
  actions, the head, the composer's + menu, the AI-off row, the use-turn error
  words.
- `client-v2/src/views/sidebar/assistant`: the patch card's outcome strings.
- `client-v2/src/features/persistence/Component/SyncBanner.tsx`: the banner's
  buttons only; what each answer does is unchanged.
- `design-system/src/components/ui/composer.tsx` and `callout.tsx`
  (`CalloutAction`, `CalloutActions`), installed into `client-v2/src/shared/ui`.
- Out of scope: resending the refused message on Use hosted model, a settings
  page that enters a key, the composer's + menu items, and Spec 06's wording,
  which is a Linear document and is answered on DES-196.
