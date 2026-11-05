## MODIFIED Requirements

### Requirement: The head names the program it calls
When the Interact stage has a program to call, its head SHALL show the program
id shortened in the middle (first four and last four characters joined by
"…") with a copy button labelled "Copy program id" that copies the full id,
and the network name, capitalised ("Devnet", "Mainnet" for mainnet-beta).

#### Scenario: A deployed program (manual)
- **WHEN** a program is deployed on devnet and the person opens Interact
- **THEN** the head shows "Program", the shortened id, a "Copy program id" button and "Devnet"
