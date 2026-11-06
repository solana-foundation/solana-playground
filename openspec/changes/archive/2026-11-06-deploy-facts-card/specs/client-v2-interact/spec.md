## MODIFIED Requirements

### Requirement: Call history sits beside the form on a wide stage
When the Interact stage is at least 40rem wide, the `ready` surface SHALL show
the instruction chips, the form and the last result in a left column and "Call
history" in a right column 18rem wide that stays in view beside the form
while the form scrolls. Before the first call the right column SHALL show the
heading, the title "No calls yet" and the line "Calls you make here show with
their result.". Accounts and Events SHALL sit below both columns. On a
narrower stage the surface SHALL keep one column in the order chips, form,
result, Call history, Accounts, Events, and SHALL NOT show a history section
before the first call.

#### Scenario: Wide stage (manual)
- **WHEN** the stage is 48rem wide and the program has calls in its history
- **THEN** "Call history" is to the right of the form, top-aligned with the chips

#### Scenario: Wide stage before the first call (manual)
- **WHEN** the stage is 48rem wide and the program has no calls on this network
- **THEN** the right column shows "Call history", "No calls yet" and "Calls you
  make here show with their result."

#### Scenario: Narrow stage (manual)
- **WHEN** the stage is 30rem wide
- **THEN** "Call history" follows the result in one column
