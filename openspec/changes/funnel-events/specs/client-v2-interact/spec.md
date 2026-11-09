# Spec Delta

## ADDED Requirements

### Requirement: Instruction call events

`runCall` (`views/flow/stages/run-call.ts`) SHALL send, through the
`features/program-interact` tracker, `interact_sent { cluster }` once the
transaction has gone out (a signature came back), `interact_succeeded
{ cluster }` when it confirmed without an error, and `interact_failed
{ cluster, phase }` when it did not: `phase` is `send` when no signature came
back and `confirm` when the transaction failed or its confirmation is unknown. A
wallet the user said no to before a signature came back (EIP-1193's 4001, or
the wallet's wording of a refusal: `isWalletRejection` in
`shared/lib/wallet-rejection.ts`) sends `interact_cancelled { cluster }`
instead, so the funnel tells abandonment from a failed send.
`cluster` is the cluster the call went to, or `custom` when the endpoint
names none. No event carries the instruction name, the program id, an
address or a signature. These are `wbdi-flow`'s "Interact telemetry" events;
its `validation` and `simulation` phases arrive with its Simulate task.

#### Scenario: A call that lands

- **WHEN** a call on Devnet confirms without an error
- **THEN** the memory provider records `interact_sent` and then
  `interact_succeeded`, each with `{ cluster: "devnet" }`

#### Scenario: A failed confirmation is tracked

- **WHEN** a sent transaction fails on Devnet
- **THEN** the memory provider records `interact_sent`, then
  `interact_failed` with `{ cluster: "devnet", phase: "confirm" }`

#### Scenario: The user says no in the wallet

- **WHEN** the wallet throws "User rejected the request." before signing
- **THEN** the memory provider records `interact_cancelled` with
  `{ cluster: "devnet" }` and no `interact_failed`

#### Scenario: A call the wallet never sends

- **WHEN** the send throws before a signature comes back, and not because the
  user said no
- **THEN** the memory provider records `interact_failed` with
  `phase: "send"` and no `interact_sent`
