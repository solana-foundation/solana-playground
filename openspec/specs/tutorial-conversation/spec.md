# tutorial-conversation Specification

## Purpose
What a conversation tutorial's feed draws of the accounts a lesson is about: the player and memory views on its act and result cards, and the one line a finished repeating card sums to.

## Requirements

### Requirement: The cards draw the account as the lesson sees it

An act card with `account` SHALL draw the view under its button from the latest reading of that account, if any; the result card SHALL draw the reading of its own run as that run left it, with no timer. A player view SHALL show the address, energy as a meter with "n/max", the wood and, with `refill` and energy under `max`, "Next energy in m:ss · worked out by the client, no transaction" counting down each second with the energy worked out on the device. A memory view SHALL show the address, the account in 10 KB blocks against `capacity` and, on an act card, the heap against 32 KB, red past it; a `zero` view reads "0 KB, in place".

#### Scenario: Energy drops and comes back (manual)

- **WHEN** a press lands with energy 4 and `refill` of 30 seconds
- **THEN** the card shows 4/5 and "Next energy in 0:30"
- **AND** 30 seconds later it shows 5/5 and no timer, with no transaction sent

#### Scenario: The heap runs out (manual)

- **WHEN** a grow is refused with the map at 30 KB
- **THEN** the card shows 30 KB of 40 KB, and a 40 KB heap in red against 32 KB

#### Scenario: Reload (manual)

- **WHEN** the page reloads after a press
- **THEN** the card draws the same reading, without reading the chain

### Requirement: A finished repeating card sums its presses

A finished repeating card with `account` SHALL read one line: a player view "Chopped n times · w wood", with "· k energy came back" and "· out of energy" when they happened; a memory view "Grew to s KB", with "· out of memory at h KB" or "· nothing copied", and "Out of memory at h KB" alone when no press landed. A memory view SHALL stay drawn under the line. A repeating card with `account` SHALL show an axe for a player and an expand icon for memory, as the prototype does.

#### Scenario: Chopped until refused (manual)

- **WHEN** a chop card ends on a refusal after five landed presses, six in all
- **THEN** its record reads "Chopped 6 times · 5 wood · out of energy"
