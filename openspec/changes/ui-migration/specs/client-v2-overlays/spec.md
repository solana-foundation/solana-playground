# Spec Delta

## Purpose

What floats above the IDE: menus, dialogs, tooltips and toasts. How they
open, close and answer, where they sit on the screen, and what they report.

## ADDED Requirements

### Requirement: Menus keep their items and keys

A menu SHALL show each item's name, the line under it where one exists and
its key hint, run the chosen item once and close. Escape and a click outside
SHALL close it without running anything. Items keep their labels and test
ids.

#### Scenario: Choosing an item from the explorer's menu

- **WHEN** a user right-clicks a file in the explorer and chooses "Rename"
- **THEN** the menu closes and the rename dialog opens for that file

#### Scenario: Escape closes a menu

- **WHEN** a user opens a file's menu in the explorer and presses Escape
- **THEN** the menu closes and nothing else changes

### Requirement: A dialog answers its caller

A dialog SHALL return what its submit produced to the code that opened it, or
nothing when it is closed. A submit that fails SHALL keep the dialog open and
show the error inside it. Enter SHALL submit. Opening a dialog SHALL close the
navigation's sheet on a narrow screen. On a phone a dialog SHALL be a page of
its own, with its buttons pinned to the foot.

#### Scenario: Renaming a file through its dialog

- **WHEN** a user opens a file's rename dialog, types a new name and presses Enter
- **THEN** the dialog closes and the explorer shows the file under the new name

#### Scenario: A failing submit keeps the dialog

- **WHEN** a user submits a rename to a name that already exists
- **THEN** the dialog stays open and shows why

#### Scenario: Escape closes a dialog without an answer

- **WHEN** a user opens the rename dialog and presses Escape
- **THEN** the dialog closes and the file keeps its name

#### Scenario: A dialog closes the left sheet

- **WHEN** the navigation is open as a sheet on a narrow screen and a dialog opens
- **THEN** the sheet closes and the dialog has the focus

#### Scenario: A dialog closes the Files sheet on a phone

- **WHEN** the Files sheet is open on a screen narrower than 720 px and a dialog opens from the file tree
- **THEN** the sheet closes and the dialog has the focus

#### Scenario: A dialog on a phone (manual)

- **WHEN** a dialog opens on a screen narrower than 768 px
- **THEN** it fills the screen and its buttons stay at the foot while its body scrolls

### Requirement: Toasts sit bottom left, clear of the rail

A toast SHALL appear at the bottom left of the window without covering the
navigation's rail. A toast opened as persistent SHALL stay until it is closed.

#### Scenario: A toast clear of the rail

- **WHEN** the product shows a toast with the navigation folded to its rail
- **THEN** the toast sits at the bottom left and does not overlap the rail

#### Scenario: A persistent toast (manual)

- **WHEN** the product shows a persistent toast and the user waits ten seconds
- **THEN** the toast is still shown until the user closes it

### Requirement: Tooltips wait before they show

A tooltip SHALL show after the pointer rests on its target for 500 ms and
hide when the pointer leaves. A help mark SHALL show its text the same way.

#### Scenario: A tooltip's delay (manual)

- **WHEN** a user rests the pointer on a control that has a tooltip
- **THEN** nothing shows before 500 ms and the tooltip shows after

### Requirement: Overlays report what they do

The overlays SHALL send these telemetry events. `name` is a fixed kebab-case
name each dialog or toast declares (for example `rename-item`,
`tx-explorer-link`); it never carries user content.

- `overlay_modal_opened {name}`: a dialog opened.
- `overlay_modal_submit_failed {name}`: a dialog's submit threw; the dialog
  stays open with the error.
- `overlay_toast_shown {name}`: a toast was shown. A dialog that throws
  while rendering is closed with no answer and shown as the `modal-failed`
  toast.

#### Scenario: Events of a failing dialog

- **WHEN** a user opens the rename dialog and submits a name that already exists
- **THEN** `overlay_modal_opened` and `overlay_modal_submit_failed` are sent with `name` `rename-item`
