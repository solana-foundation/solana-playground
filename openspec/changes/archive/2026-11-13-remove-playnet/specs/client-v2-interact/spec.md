## MODIFIED Requirements

### Requirement: A sent transaction's toast

When the app sends a transaction, the toast SHALL read "Transaction sent" and
show the signature shortened in the middle (`9hJqVk…WxCvBz`), linked to the
transaction on the explorer picked in Settings. It SHALL fire for every
transaction the app sends, not only from Interact, except one a tutorial card
already links, and any while the "Show transaction notifications" setting is
off.

#### Scenario: The toast names the signature (manual)

- **WHEN** the person sends `increment` and the transaction goes out
- **THEN** a toast reads "Transaction sent" beside the shortened signature, which opens the transaction on the picked explorer
