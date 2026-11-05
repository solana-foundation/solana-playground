## MODIFIED Requirements

### Requirement: Sign in to share

A signed-out user who opens the share dialog SHALL first see a sign-in prompt
in its place, titled "Sign in to share", saying "Your project goes to a gist on
your GitHub account.", with a "Sign in with GitHub" button that shows the
GitHub mark and a Cancel button (on a phone, the page's Close). Once the
sign-in succeeds the same dialog SHALL become the share dialog for the same
project, and nothing SHALL reach GitHub until the user presses "Create secret
gist" or "Create public gist". A signed-in user SHALL go straight to the
share dialog. A session that ends while the share dialog is open SHALL still
be mended from inside the dialog, which offers to sign in again and then
shares with the visibility the user chose, without a second press.

While a sign-in or the gist-access popup waits for GitHub, the primary
button of the prompt or the dialog SHALL read "Cancel sign-in" (the frame's
submit in both), as the prototype's own sign-in control does.
Pressing it SHALL stop the wait and keep the dialog open on the step it came
from (the prompt, signing in again, or allowing gists), saying "Sign-in
cancelled.", with the button back to its own label, which starts a new
sign-in. While it waits the frame SHALL draw no Cancel beside it, so the
footer holds one cancel; the header's Close SHALL stay available: it closes
the dialog and cancels the sign-in. A sign-in that ends without a session SHALL keep
the dialog open with the reason shown.

#### Scenario: Signed out, the prompt comes first
- **WHEN** a signed-out user picks Share on the open project "counter"
- **THEN** a dialog titled "Sign in to share" opens with the line "Your
  project goes to a gist on your GitHub account.", a "Sign in with GitHub"
  button carrying the GitHub mark, and Cancel, and no request to
  `/api/gists` has been made

#### Scenario: Signed out, then signed in
- **WHEN** the user presses "Sign in with GitHub" in the prompt and completes
  sign-in
- **THEN** the dialog becomes "Share counter as a gist" with Secret selected
  and a "Create secret gist" button, and no request to `/api/gists` has been
  made

#### Scenario: Signed in, no prompt
- **WHEN** a signed-in user picks Share on "counter"
- **THEN** the dialog opens titled "Share counter as a gist", without the
  prompt

#### Scenario: Sign-in cancelled
- **WHEN** the user presses "Sign in with GitHub" and, while the popup waits
  and the button reads "Cancel sign-in", presses it
- **THEN** the sign-in stops, the dialog stays open on the prompt saying
  "Sign-in cancelled.", no gist is created, and pressing "Sign in with
  GitHub" starts a new sign-in

#### Scenario: Closing the dialog while sign-in waits
- **WHEN** the user presses "Sign in with GitHub" and, while it waits,
  presses the header's Close
- **THEN** the sign-in stops, the dialog closes, and no gist is created

#### Scenario: A sign-in that cannot start
- **WHEN** the user presses "Sign in with GitHub" and sign-in cannot start
- **THEN** the prompt stays open and says "Could not start sign-in", and no
  gist is created

#### Scenario: Cancel leaves without signing in
- **WHEN** the user presses Cancel in the prompt
- **THEN** the dialog closes and no sign-in starts
