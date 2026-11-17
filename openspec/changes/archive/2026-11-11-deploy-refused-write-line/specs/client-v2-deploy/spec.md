# Spec Delta

## ADDED Requirements

### Requirement: A refused buffer write shows in the terminal

While a deploy writes its buffer, the first write in each round that the cluster refuses SHALL print one warning line:
"Warning: The cluster refused a buffer write ({message}), sending it again...". {message} is the first line of the
cluster's message for the refusal, or of the error's message when the cluster sent none, cut to 200 characters and ended with an ellipsis. Further refusals in the same
round SHALL print nothing more, and a send that fails after the deploy is stopped SHALL print nothing. This holds for
the Deploy stage, the terminal and a tutorial's deploy.

#### Scenario: A round of refused writes prints one line (manual)

- **WHEN** a deploy writes its buffer and the cluster refuses several writes in one round with "Transaction simulation
  failed: Insufficient funds for fee"
- **THEN** the terminal prints "Warning: The cluster refused a buffer write (Transaction simulation failed: Insufficient
  funds for fee), sending it again..." once for that round, and the refused chunks are sent again in the next round

#### Scenario: Each round that refuses a write prints its own line (manual)

- **WHEN** two rounds of a buffer write each land some chunks and have others refused
- **THEN** the terminal prints the refusal line twice, once per round

#### Scenario: A send that fails after a stop prints nothing (manual)

- **WHEN** a deploy is stopped while a buffer write is in flight, and that write then fails
- **THEN** the terminal prints no refusal line for it

### Requirement: A write the browser could not send counts as refused

A buffer write the browser could not send at all, or whose blockhash it could not fetch, SHALL print the refusal line with "Failed to fetch" as its message,
in every browser, whatever the browser's own words for it ("Load failed" in Safari, a "NetworkError" in Firefox). The
browser reports an RPC that is down, and a 429 sent without CORS headers, this way.

#### Scenario: A stopped validator prints a refusal line (manual)

- **WHEN** a deploy to Localnet is writing its buffer and the local validator stops
- **THEN** the terminal prints "Warning: The cluster refused a buffer write (Failed to fetch), sending it again..."

### Requirement: A round prints one line for its refusals and rate limits

A buffer write the RPC answers with a rate limit it names (an HTTP 429 or a provider's rate-limit error) SHALL print
the "Reached rate-limits" warning line, and no refusal line; a tutorial's deploy prints it as a warning as the Deploy
stage does. A round SHALL print one of the two lines at most: the first that
happens. A round that printed the refusal line and is then rate-limited SHALL print no rate-limit line, and SHALL
still wait out the rate limit before the next round.

#### Scenario: A rate limit prints no refusal line (manual)

- **WHEN** the RPC answers a buffer write with a rate limit
- **THEN** the terminal prints "Warning: Reached rate-limits" and no refusal line

#### Scenario: A refusal and then a rate limit print one line (manual)

- **WHEN** the cluster refuses a buffer write and later in the same round the RPC rate-limits another
- **THEN** the terminal prints the refusal line only, and the next round starts after the rate-limit wait
