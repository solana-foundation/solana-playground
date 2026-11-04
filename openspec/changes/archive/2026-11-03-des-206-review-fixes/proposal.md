# Proposal

## Why

Review of the DES-206 share dialog (PR #276) found two places where the
footer reads wrong. While GitHub's popup waits, the footer showed Cancel
beside Cancel sign-in: two cancels side by side, one closing the dialog and
one stopping the popup. And on Refused and Too large, Close came out as a
filled button, the strongest in the dialog, though it is no call to action.

## What Changes

- While a sign-in or the gist-access popup waits, the prompt and the share
  dialog draw no Cancel beside Cancel sign-in. The header's Close is the way
  out; it closes the dialog and cancels the sign-in, as Cancel did.
- Close, where it is the only action (Refused, Too large), is an outlined
  button at the footer's height, on a desk and on a phone. This one is
  visual and needs no requirement change.
- No telemetry change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gist-sharing`: "Sign in to share" says the frame draws no Cancel while the
  popup waits, and the header's Close takes its place.
