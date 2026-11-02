# Design

## Context

See proposal.md, Why. Below `LAYOUT_BREAKPOINTS.phone` the app is three pages
(`BasePhonePager`); the first is the navigation, `BaseAppNav` with
`phone`. Projects reach another device through account sync
(`features/persistence`), which needs a GitHub sign-in (`PgSession`).

## Goals / Non-Goals

**Goals:** one way out on the phone, built from design-system parts
(`Drawer`, `Button`, `BrandButton`), in the shape of Almaz's lesson sheet
(`design-system/src/prototype/tutorial/sheets/ContinueSheet.tsx` on
`almaz/mobile-tutorial-prototype`) so the phone has one "continue on a
computer" look (Design alignment, 2 Nov).

**Non-Goals:** a GitHub save, a short link, a QR code, other entry points.

## Decisions

- **Where the row sits.** The phone's menu page, under the project list, as a
  ghost row like the list's own. Spec 15 puts it in "the project menu"; the
  menu page is the phone's project menu, and the work page's bar has no room
  (Menu, title, Chat | Code, Preview). Phone only by construction:
  `BaseAppNav` draws its `handoff` slot only with `phone`.
- **What carries the project.** Account sync, not a GitHub save: spec 15's
  step 25 rests on GitHub sharing, which is not built. Signed in, the project
  is already in the account; the sheet says so.
- **The link.** `location.origin` + the router's current path. A project has
  no address of its own; the account's project list opens it on the
  computer. A tutorial's path does open that tutorial.
- **The sheet's shape.** As Almaz's: a Monitor icon in a 48 px
  `surface-raised` tile, a heading-face title, a read-face muted line, the
  whole link in a mono well (`surface-well`, `select-all`, a break after each
  slash), "Copy link" and Share as 48 px secondary buttons, "Stay on the
  phone" in the footer. The DS `CopyButton` is an icon with a tooltip, not
  this labelled button, so the sheet copies itself: "Copied" with a check
  for 2 s, announced by `aria-live`; a refused clipboard goes to
  `reportButtonFailure("copy the link")` and never shows Copied. Share only
  when `navigator.share` exists; a cancelled share (`AbortError`) is not a
  failure, any other rejection is reported.
- **Pair.** `BaseHandoff` (props only: `login`, `link`, `canShare`, `onCopy`,
  `onShare`, `onSignIn`, `signingIn`, `open`, `onOpenChange`) and `Handoff` (reads
  `PgSession`, the router, sends events). Both in `widgets/app-nav/ui/`.

## Risks / Trade-offs

- Signed out, the link opens an empty Playground on the computer: the sheet
  says the project stays on the phone and offers sign-in, so the link is not
  sold as carrying it.
