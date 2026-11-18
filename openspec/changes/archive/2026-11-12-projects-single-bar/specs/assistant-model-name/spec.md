## MODIFIED Requirements

### Requirement: The head names the model in use

The assistant's head (`h2` in the column bar) SHALL read the open project's
name while a project is open, following a rename, and SHALL NOT name the
model then; the composer's model button shows it. Beside a tutorial not yet
started, with no project open, it SHALL read the tutorial's name. With
neither open the head SHALL read as before: "Assistant · {model} · hosted" while the
deployment's hosted model is shown, "{model} · your {provider} key" while a
key-based backend is shown ({provider} one of Anthropic, OpenAI,
OpenRouter, Gemini), and "Assistant" while no model is available or the
hosted model is still being checked. {model} is the same display name the
composer's model button shows. A project name too long for the head SHALL
end in "…" and stay whole in the heading's accessible name.

#### Scenario: Hosted model in the head (manual)

- **WHEN** no project or tutorial is open, the deployment serves GLM 5.3 Flash and
  nothing else is connected
- **THEN** the head reads "Assistant · GLM 5.3 Flash · hosted"

#### Scenario: Own key in the head (manual)

- **WHEN** no project or tutorial is open and the user is connected to OpenRouter with
  the model `deepseek/deepseek-chat-v3.1:free`
- **THEN** the head reads "deepseek/deepseek-chat-v3.1:free · your
  OpenRouter key"

#### Scenario: The project in the head

- **WHEN** the project `anchor-project` is open and the deployment serves
  GLM 5.3 Flash
- **THEN** the head reads "anchor-project" and does not contain
  "GLM 5.3 Flash"
