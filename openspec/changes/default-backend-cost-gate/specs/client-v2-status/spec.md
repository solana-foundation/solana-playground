# Spec Delta

## MODIFIED Requirements

### Requirement: The AI indicator

The AI indicator SHALL be ready while a model is connected and usable, show
the model's name and be named "AI, ready" (not the model's name, which the
composer's model button is named by). With no model connected,
or the default backend while nobody is signed in, it SHALL be idle (grey
dot), read "AI · Off" and be named "AI, off": no model is the user's choice,
not a failure. While no model is connected and the app is still asking the
deployment whether it serves a hosted model, it SHALL read "AI · Off" as
above: there is no "Checking" state. While no model is connected, the
browser is online and that asking failed (no answer, an error status or a
bad body), it SHALL be failed (red dot), read "AI · Not responding" and be
named "AI, not responding"; a click SHALL open a panel titled "AI" with the
line "The hosted model is not responding. Try again, or add a key of your
own.", "Try again", which asks again and, when it still fails, says "Could
not reach the hosted model.", and "Add an API key". After the hosted model
refused a turn because the free daily limit is used (its daily cap or its
spent pool), it SHALL be waiting (warning dot), read "AI · Limit reached" and
be named "AI, limit reached", until a turn on the hosted model goes through,
until another backend is connected, until the backend is forgotten, or until
another user signs in, and after a daily-cap refusal also until the next
00:00 UTC; a reload forgets it. A click SHALL open Connect a model, except at
Not responding (above) and at Limit reached, where it SHALL open a panel
titled "AI" with "AI · Limit reached", a line and the button "Add an API
key", which opens Connect a model. After a daily-cap refusal the line SHALL
be "The free daily limit is used. It comes back at <HH:MM>, or add a key of
your own to keep going." (the next 00:00 UTC in the user's own clock). After
a spent-pool refusal, whose refill only the upstream knows, it SHALL be "The
free assistant is out of capacity for now. Try again later, or add a key of
your own to keep going."

#### Scenario: No model connected

- **WHEN** a signed-out user with no model connected opens the app
- **THEN** the AI indicator reads "AI · Off" with a grey dot, and a click
  opens Connect a model

#### Scenario: The free daily limit is used

- **WHEN** a signed-in user on the hosted model sends a turn the hosted
  model refuses under its daily cap
- **THEN** the AI indicator reads "AI · Limit reached" with the warning dot;
  a click opens a panel saying when the limit comes back, with "Add an API
  key", which opens Connect a model

#### Scenario: The free pool is spent

- **WHEN** a signed-in user on the hosted model sends a turn the hosted
  model refuses because its tier's pool is spent
- **THEN** the AI indicator reads "AI · Limit reached" with the warning dot;
  a click opens a panel saying the free assistant is out of capacity for
  now, naming no time, with "Add an API key", which opens Connect a model

#### Scenario: The hosted model does not answer

- **WHEN** a user with no model connected opens the app while the hosted
  model's check fails with a server error
- **THEN** the AI indicator reads "AI · Not responding" with a red dot, and
  its panel offers "Try again" and "Add an API key"
