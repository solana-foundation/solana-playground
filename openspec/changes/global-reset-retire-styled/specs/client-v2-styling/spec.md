# Spec Delta

## Purpose

How client-v2 resets browser styles, how it honours a request for reduced
motion, and which code may still style with styled-components while the
move to the design system finishes.

## ADDED Requirements

### Requirement: One reset across the page

The product SHALL apply one CSS reset to the whole page, so that an element
looks the same whether or not it belongs to a design-system component. The
code editor and the terminal SHALL render and behave as they did before the
reset: text, cursor, selection, scrollbars, the minimap and the terminal's
cell grid line up and keep their size.

#### Scenario: A plain form control

- **WHEN** a native `button` or `input` that no design-system component wraps
  is rendered
- **THEN** it has no browser border, face or font of its own, and takes the
  font of the text around it

#### Scenario: Editor and terminal under the reset

- **WHEN** a project opens with a file in the editor and the terminal shown
- **THEN** the editor's text, cursor and selection line up with the
  characters, and the terminal fills its pane with no clipped or shifted
  rows, as in the screenshots taken before the reset

### Requirement: Reduced motion stops overlay animation

When the operating system asks for reduced motion
(`prefers-reduced-motion: reduce`), every animation and transition of the
product's menus, dialogs, popovers, tooltips, toasts, sheet and phone pager
SHALL finish at once, so the element appears or leaves in its end state.

#### Scenario: Opening a dialog with reduced motion

- **WHEN** reduced motion is set and the user opens a dialog
- **THEN** the dialog is shown in its final position and opacity with no
  visible movement or fade

#### Scenario: Without reduced motion

- **WHEN** reduced motion is not set
- **THEN** overlays animate as the design system defines

### Requirement: styled-components is confined while it leaves

No module SHALL import `styled-components` except those under
`src/components/Wallet/` and `src/widgets/layout-shell/`, which move with
their own tickets, and the two that serve them until then: the theme
provider in `src/providers/theme/` and the theme's type declaration in
`src/types/declarations.d.ts`. The lint step SHALL fail on such an import
anywhere else.

#### Scenario: A new styled import

- **WHEN** a module outside the two folders imports `styled-components`
- **THEN** `yarn lint` fails and names the import
