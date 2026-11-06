## MODIFIED Requirements

### Requirement: The Deploy stage opens the guide

The Deploy stage SHALL show an outlined button "Deploy with the CLI", on every
cluster, which opens the guide on the current cluster. It SHALL sit in one row
of outlined buttons with "Upload IDL" (and "Show full log" after a failed
deploy), in the deploy pill's height and shape. On a desk the row SHALL follow
the deploy pill; on a phone, where only the pill is pinned to the foot, the row
SHALL stay in the page above the foot.

#### Scenario: Guide from the Deploy stage

- **WHEN** the user presses "Deploy with the CLI" on the Deploy stage
- **THEN** the "Deploy from your machine" dialog opens

#### Scenario: The row on a phone (manual)

- **WHEN** a 390 px wide screen shows the Deploy stage before a deploy
- **THEN** "Upload IDL" and "Deploy with the CLI" sit in the page above the
  pinned deploy pill
