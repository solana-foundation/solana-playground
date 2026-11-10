# Keep toasts clear of the expanded navigation

<!-- tldr:proposal — rewrite before grooming -->

## TLDR

Toasts sit clear of the navigation, whether it's expanded or collapsed to the rail. Today every toast covers the account menu while the navigation is expanded, so the toast and the controls under it are both hard to read and use.

**Ballpark:** S — fill the estimate from this, then delete this line

<!-- /tldr -->

---

## Problem

**Symptom:** with the navigation expanded, every toast renders over the bottom of the navigation: the account menu and the "Connect a wallet" row. Seen in a headless walk-through at 1440×900 with the explorer's drag-and-drop refusal toast (`explorer-move-refused`, "A file path can be at most 256 characters.") and the project list's "Could not duplicate …" toast.

**Cause:** `ToastHost` in `client-v2/src/widgets/overlays/ui/ToastHost.tsx` renders the sonner `Toaster` with `position="bottom-left"` and a left offset of `calc(${RAIL_WIDTH} + 1rem)`. `RAIL_WIDTH` (`shared/lib/hooks/use-viewport.ts`) is `3.25rem`, the collapsed rail's width (`--sidebar-width-icon`). The expanded navigation is `--sidebar-width-value: 14.5rem` (`app/styles/playground-tokens.css`), so the offset clears only the collapsed rail.

**Evidence:** `ToastHost.tsx`, `use-viewport.ts` and `playground-tokens.css` at `dc22a4740`, which `foundation-master` contains. The offset came in with `1c435d562` (the new face).

## Why to solve

Every toast in the app is affected, and they're how the app reports failed actions. While one is showing, it hides the account menu, and the message sits where nobody looks for feedback on an action in the editor or the explorer.

## Potential Solution

- Offset the `Toaster` by the navigation's current width: the expanded width when expanded, `RAIL_WIDTH` when collapsed, `1rem` on a phone. Or move the toasts to a position design picks, such as bottom-right or bottom-centre of the work area.
- Agree the position with design before changing it.

## Done when

- With the navigation expanded, collapsed and on a phone, a toast covers no part of the navigation.
- A test pins the offset for each of those three states.

## Context

`ToastHost` is the app's one toast surface: `PgView.setToast` sends to it, and so does `reportButtonFailure`. Which messages are toasts is out of scope. Found while walking through HOO-2418 (sync size limits), where the explorer's drag-and-drop refusal stays a toast.
