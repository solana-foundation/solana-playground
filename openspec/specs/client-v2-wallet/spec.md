# client-v2-wallet Specification

## Purpose
What the wallet panel tells the person about the wallet it shows.

## Requirements

### Requirement: The wallet panel says what the Playground wallet is

While the wallet panel shows a Playground wallet, a help mark (`data-slot`
`help-tip`, `aria-label` "About the Playground wallet") SHALL sit beside the
wallet's name. Hovering or focusing it SHALL show "A wallet kept in this
browser. Playground uses it to sign your calls without asking. Use it for
devnet, testnet and local clusters only." While the panel shows a wallet
from a browser extension, the mark SHALL not be there.

#### Scenario: The help on a Playground wallet (manual)

- **WHEN** the wallet panel is open on a Playground wallet and the person
  hovers the help mark beside its name
- **THEN** the tooltip reads "A wallet kept in this browser. Playground uses
  it to sign your calls without asking. Use it for devnet, testnet and local
  clusters only."

#### Scenario: No help on an extension wallet (manual)

- **WHEN** the wallet panel shows a wallet connected from a browser extension
- **THEN** no help mark sits beside its name
