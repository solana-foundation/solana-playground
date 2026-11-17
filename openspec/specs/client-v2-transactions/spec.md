# client-v2-transactions Specification

## Purpose

How the Playground sends a transaction: when it signs one again with a fresh blockhash, and when it stops and
hands the error to its caller.

## Requirements

### Requirement: A send is signed again with a fresh blockhash at most three times

When the RPC answers a send with "Blockhash not found" or "This transaction has already been processed", the
Playground SHALL sign the transaction again with a freshly fetched blockhash and send it, at most 3 times, waiting one
slot before the second and third of those sends. When the RPC still answers so, the send SHALL fail with the RPC's
error, and SHALL NOT report the signature of another transaction as its own.

#### Scenario: A stale blockhash is sent again (manual)

- **WHEN** the RPC answers a send "Blockhash not found" once and accepts the next
- **THEN** the send succeeds with the signature of the transaction it sent again

#### Scenario: A stalled cluster fails the send (manual)

- **WHEN** the RPC answers a send and its three resends "Blockhash not found"
- **THEN** the send fails with "Blockhash not found", and a deploy prints the refused-write line for that buffer write
