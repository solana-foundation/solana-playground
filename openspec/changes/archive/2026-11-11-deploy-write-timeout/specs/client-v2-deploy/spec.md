# Spec Delta

## ADDED Requirements

### Requirement: A buffer write with no answer counts as refused

A buffer write that gets no answer within 20 seconds SHALL print the refusal line with "No answer in 20 s" as its
message, under the once-per-round rule of "A refused buffer write shows in the terminal", and SHALL end its round: no
further chunk is sent in that round, and the stalled-round limit counts the round as any other. A write the cluster
answers within 20 seconds SHALL be unaffected by the limit. A stop while a write waits for its answer SHALL end the
deploy at once, with no refusal line.

#### Scenario: A write with no answer prints a refusal line (manual)

- **WHEN** a deploy to Localnet is writing its buffer and the local validator is paused, so a write gets no answer
- **THEN** 20 seconds after that write the terminal prints "Warning: The cluster refused a buffer write (No answer
  in 20 s), sending it again...", and the round sends no further chunk

#### Scenario: Writes that never answer end the deploy (manual)

- **WHEN** an RPC answers reads of the buffer but never answers its writes
- **THEN** each round prints the refusal line once, and after 5 rounds that land nothing the deploy fails with "The RPC
  kept refusing buffer writes: no chunk landed in 5 rounds in a row (last refusal: No answer in 20 s)"
