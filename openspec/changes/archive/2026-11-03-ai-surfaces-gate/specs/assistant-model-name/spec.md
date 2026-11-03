# Spec Delta

## MODIFIED Requirements

### Requirement: Send waits while there is no model

While nothing usable is connected and the hosted model cannot answer this user, Send SHALL be `aria-disabled` with a tooltip naming the reason, and Enter and Send SHALL send nothing and SHALL leave the typed text in the input. The tooltip SHALL read "Connect a model to send" when the deployment serves no hosted model, "Sign in to send" when it serves one and nobody is signed in, and "Can't reach the model" when the hosted model's availability could not be read. With no hosted model, the model button SHALL read "Connect a model" and the head's More menu SHALL offer "Connect a model…". While the deployment's answer is still being read, Send SHALL stay enabled, and a send SHALL wait for that answer.

#### Scenario: PAL-60 No model (manual)

- **WHEN** the hosted model is off, no key is saved, and the person types a question and presses Enter
- **THEN** nothing is sent, the text stays, Send is disabled, and More offers "Connect a model…"

#### Scenario: Signed out with a hosted model (manual)

- **WHEN** the deployment serves a hosted model, nobody is signed in, nothing is connected, and the person types a question and presses Enter
- **THEN** nothing is sent, the text stays, and Send is disabled with the tooltip "Sign in to send"
