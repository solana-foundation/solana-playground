# Spec Delta

## Purpose

How the assistant names the model it talks to, in its head, its composer and its model menu, and what its composer does while no model is available.

## ADDED Requirements

### Requirement: The head names the model in use

The assistant's head (`h2` in the column bar) SHALL read "Assistant · {model} · hosted" while the deployment's hosted model is shown, "{model} · your {provider} key" while a key-based backend is shown ({provider} one of Anthropic, OpenAI, OpenRouter, Gemini), and "Assistant" while no model is available or the hosted model is still being checked. {model} is the same display name the composer's model button shows.

#### Scenario: Hosted model in the head (manual)

- **WHEN** the deployment serves GLM 5.3 Flash and nothing else is connected
- **THEN** the head reads "Assistant · GLM 5.3 Flash · hosted"

#### Scenario: Own key in the head (manual)

- **WHEN** the user is connected to OpenRouter with the model `deepseek/deepseek-chat-v3.1:free`
- **THEN** the head reads "deepseek/deepseek-chat-v3.1:free · your OpenRouter key"

### Requirement: A long model name truncates and shows in full on demand

A model name that does not fit SHALL end in "…" on one line, in the composer's model button and in the head's model part; the rest of the head ("Assistant ·", "· hosted", "· your … key") SHALL stay whole. The composer's model button SHALL be at most 12rem wide. While a name is cut, hovering it SHALL show the whole name in a tooltip, and so SHALL keyboard focus on the composer's model button (the head is no tab stop; its heading's accessible name is the whole text); a name that fits SHALL show no tooltip. The model menu SHALL show every name in full, wrapping a long one. The whole name SHALL stay in the accessible name of the button and the text of the head.

#### Scenario: Long name in the composer, desktop and phone

- **WHEN** the connected model's name is longer than the button can show
- **THEN** the button is at most 12rem wide and ends the name in "…", Send stays inside the composer, and focusing the button shows the whole name in a tooltip

#### Scenario: Short name shows no tooltip (manual)

- **WHEN** the model's name fits
- **THEN** hovering the model button opens no tooltip

### Requirement: Send waits while there is no model

With no model available (the deployment serves no hosted model and nothing is connected), Send SHALL be `aria-disabled` with the tooltip "Connect a model to send", Enter and Send SHALL send nothing and SHALL leave the typed text in the input, the model button SHALL read "Connect a model", and the head's More menu SHALL offer "Connect a model…".

#### Scenario: PAL-60 No model (manual)

- **WHEN** the hosted model is off, no key is saved, and the person types a question and presses Enter
- **THEN** nothing is sent, the text stays, Send is disabled, and More offers "Connect a model…"
