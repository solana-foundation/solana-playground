## MODIFIED Requirements

### Requirement: Sign in to share

A signed-out user who opens the share dialog SHALL first see a sign-in prompt
in its place, titled "Sign in to share", saying "Your project goes to a gist on
your GitHub account.", with a "Sign in with GitHub" button that shows the
GitHub mark and a Cancel button (on a phone, the page's Close). Once the
sign-in succeeds the same dialog SHALL become the share dialog for the same
project, and nothing SHALL reach GitHub until the user presses its create
button. A cancelled or failed sign-in SHALL keep the prompt open with the
reason shown. A signed-in user SHALL go straight to the share dialog. A
session that ends while the share dialog is open SHALL still be mended from
inside the dialog, which offers to sign in again and then creates the gist.

#### Scenario: Signed out, the prompt comes first

- **WHEN** a signed-out user picks Share as gist on a project named "counter"
- **THEN** a dialog titled "Sign in to share" opens with the line "Your
  project goes to a gist on your GitHub account.", a "Sign in with GitHub"
  button carrying the GitHub mark, and Cancel, and no request to
  `/api/gists` has been made

#### Scenario: Signed out, then signed in

- **WHEN** the user presses "Sign in with GitHub" in the prompt and completes
  sign-in
- **THEN** the dialog becomes "Share counter as a gist" with the public-gist
  notice and a "Create public gist" button, and no request to `/api/gists`
  has been made

#### Scenario: Signed in, no prompt

- **WHEN** a signed-in user picks Share as gist
- **THEN** the dialog opens titled "Share counter as a gist", without the
  prompt

#### Scenario: Sign-in cancelled

- **WHEN** the user closes the sign-in popup without finishing
- **THEN** the prompt stays open, says sign-in was cancelled, and no gist is
  created

#### Scenario: Cancel leaves without signing in

- **WHEN** the user presses Cancel in the prompt
- **THEN** the dialog closes and no sign-in starts
