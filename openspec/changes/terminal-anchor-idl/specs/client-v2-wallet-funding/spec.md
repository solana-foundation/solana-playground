## MODIFIED Requirements

### Requirement: The amount is checked before the wallet is asked

The amount field (label "Amount (SOL)", id `fund-amount`) SHALL start at 0
and accept a positive number of SOL with at most 9 decimals. The arrow keys
and the field's − and + buttons SHALL step the amount by 0.1 SOL, to the next
multiple of 0.1 in that direction and never below 0. The send button,
labelled `Send <amount> SOL`, SHALL be disabled while the amount is not valid
or exceeds the paying wallet's balance less 0.001 SOL for fees, and while that
balance is unknown. At 0 the field SHALL ask for an amount above 0 as a hint,
not an error. A valid amount SHALL be noted as `Arrives in <receiver name> on
<network>.`, naming the Playground's cluster, and the balance SHALL be read
again when that cluster changes.

#### Scenario: The field starts at 0

- **WHEN** the user connects a paying wallet
- **THEN** the amount reads `0`, the send button is disabled and the field says "Enter an amount above 0." without an error

#### Scenario: Stepping by 0.1

- **WHEN** the amount reads `0` and the user presses + and then the up arrow
- **THEN** the amount reads `0.2`, and from `1.999` the up arrow gives `2` and the down arrow `1.9`

#### Scenario: Amount above the balance

- **WHEN** the paying wallet holds 0.5 SOL and the user enters 1
- **THEN** the send button is disabled and the field says the wallet holds 0.5 SOL

#### Scenario: Not a number (manual)

- **WHEN** the user enters `abc` or `-1`
- **THEN** the send button is disabled and the field asks for an amount above 0

#### Scenario: Where the SOL goes

- **WHEN** the Playground is on devnet and the amount is valid
- **THEN** the field says `Arrives in Wallet 1 on devnet.`

#### Scenario: Mainnet (manual)

- **WHEN** the Playground is on mainnet and a paying wallet is connected
- **THEN** a warning Callout titled "Mainnet uses real SOL" shows above the send button
