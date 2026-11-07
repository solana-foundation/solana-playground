## ADDED Requirements

### Requirement: Max fills the sendable balance
The amount field SHALL carry a `Max` button at its end. Pressing it SHALL set
the amount to the paying wallet's balance less 0.001 SOL for fees, written
with at most 9 decimals, so the send button is enabled on it. `Max` SHALL be
disabled while the balance is unknown or unreadable, and when the balance is
0.001 SOL or less.

#### Scenario: Max then send
- **WHEN** the paying wallet holds 2 SOL and the user presses Max
- **THEN** the amount reads `1.999`, and pressing `Send 1.999 SOL` transfers 1.999 SOL

#### Scenario: Balance below the fee
- **WHEN** the paying wallet holds 0.0005 SOL
- **THEN** the Max button is disabled

#### Scenario: Balance loading (manual)
- **WHEN** the paying wallet's balance is still being read
- **THEN** the Max button is disabled
