# Spec Delta

## ADDED Requirements

### Requirement: The mainnet warning opens the CLI deploy guide

In the Deploy stage's "Mainnet deploy warning" callout, the body's own words
"deploy from your own machine" SHALL be a link button that opens the CLI
deploy guide on Mainnet. The body's wording SHALL stay the terminal's; no
words are added.

#### Scenario: Guide from the mainnet warning

- **WHEN** the endpoint is mainnet-beta and the user presses "deploy from
  your own machine" in the mainnet warning
- **THEN** the "Deploy from your machine" dialog opens with Mainnet picked
