# Design

## Context

`modelShown` (`widgets/assistant/model/choice.ts`) already decides what the composer's model button names: `checking`, `none`, the hosted `default`, or `keyed`. The head (`BaseAssistantHead`) takes a `title` string, the project's name, from `Assistant`. `shared/ui` is installed from the design system and is not edited here, so `ComposerModel` and `Tooltip` are used as they are, through `className` and composition.

## Goals / Non-Goals

**Goals:**

- One source for the name: the head and the button both read `modelShown`.
- A tooltip only where it adds something: when the name was cut.

**Non-Goals:**

- Middle truncation, or a per-provider short name.
- A change to the design system's `ComposerModel`.

## Decisions

- **Head label as parts.** A pure `headLabel(shown)` in `model/head-label.ts` returns a `HeadLabel`: `plain` text ("Assistant") while there is no model, or a `model` head of `lead`, `model` and `tail` ("Assistant · ", "GLM 5.3 Flash", " · hosted"); `headText` joins it for the heading's accessible name. The head renders `model` in its own `truncate` span between `shrink-0` spans, so only the name is cut. Alternative: one string with CSS truncation of the whole `h2`, which would cut "· hosted" first; rejected.
- **`OverflowTooltip`.** A small component in `widgets/assistant/ui/` wraps a trigger and controls `Tooltip`'s `open`: on `onOpenChange(true)` it opens only when the element marked `data-overflow` inside the trigger has `scrollWidth > clientWidth`. Used by the head and the model button; there it sits inside the `DropdownMenuTrigger` and passes the menu trigger's props through, so the button keeps the menu's `data-state`. Alternative: the native `title` attribute; rejected, as it is not the design system's tooltip and never shows on focus.
- **Cap in the composer at 12rem** (`max-w-48 min-w-0` on `ComposerModel`, `truncate` on its label span). It keeps Effort and Send in the box at phone width (390 px, checked in the browser); `min-w-0` lets the button shrink below the cap should the toolbar ever be narrower.
- **Menu wraps.** The radio item's label gets `[overflow-wrap:anywhere]` and the content a viewport-bound `max-w`, so a long id breaks inside the menu instead of widening it off screen.
- **Provider names for "your … key"** live beside `headLabel` as a `Record<KeyedProviderId, string>`: the provider list's `name` reads "OpenAI-compatible", which is wrong in "your … key".

## Risks / Trade-offs

- [The head loses the project's name] → Spec 04 ("The assistant column sits on the left", as drawn) heads the column with "Assistant", the model and the status, never the project, so the shipped project name was the deviation; the project stays in the frame's navigation and the thread's empty state. The status is not part of this change.
- [jsdom has no layout, so `scrollWidth` is 0] → unit tests stub `scrollWidth`/`clientWidth` on the marked element; the composer's real truncation at desktop and phone width is a Playwright test, the head's is checked in the browser with screenshots.
