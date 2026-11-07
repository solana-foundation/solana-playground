# Spec Delta

## ADDED Requirements

### Requirement: A call goal passes on the account it creates already existing

A step whose `call` goal names the account its instruction creates (`creates`) SHALL also pass when the goal's instruction is refused by the System Program because that account is already in use (its log line `Allocate: account ... already in use` or `Create Account: account ... already in use`, custom error 0x0). A call refused for any other reason SHALL fail as before. The call act, the client run and the Call panel SHALL pass the same goal.

#### Scenario: The Call panel's init_player on an existing player (manual)

- **GIVEN** Lumberjack's step 2, with a player this wallet created on an earlier walk
- **WHEN** the learner calls `initPlayer` from the Call panel and the System Program refuses it with "already in use"
- **THEN** step 2 passes, the step bar moves on, and nothing changes on chain

#### Scenario: A refusal for another reason (manual)

- **WHEN** on Lumberjack's step 2 the `init_player` call fails for a reason other than the account being in use
- **THEN** the step does not pass and the result is a failure, explained as any other

### Requirement: A client run passes when the account it would create exists

When a client run on a step whose `call` goal has `creates` sends no transaction, the runner SHALL derive the account's address from the seeds the step's IDL gives it for the goal's instruction, with the wallet and the deployed program, and read it. An account found there SHALL pass the goal. An account with no seeds in the IDL SHALL NOT be looked up, and the run SHALL stay "No transaction".

#### Scenario: client.ts finds the player (manual)

- **GIVEN** Lumberjack's step 2, with a player this wallet created on an earlier walk
- **WHEN** the learner runs `client.ts`, which finds the player and sends no transaction
- **THEN** step 2 passes

#### Scenario: client.ts sends nothing and no player exists (manual)

- **WHEN** a client run sends no transaction and no account is at the derived address
- **THEN** the result is "No transaction" and the step does not pass

### Requirement: An existing account reads as a pass, with the tutorial's explanation

A result that passed its goal because the account already exists SHALL show a passing outcome titled "Already exists" that names the account, on the result card and in the Call panel, never the red "Failed". Its card SHALL offer neither Explain nor "I'll fix it myself". The step's win SHALL show the definition's `existsLine` in place of `line` and `callPanelLine`, with the usual Next. A pass on a created account SHALL show `line` as before.

#### Scenario: A repeat walk of Lumberjack's step 2 (manual)

- **GIVEN** a player this wallet created on an earlier walk
- **WHEN** step 2 passes because the player already exists
- **THEN** the result reads "Already exists" with `player`
- **AND** the win explains that the player exists because this wallet ran the step before, that Anchor's `init` creates an account only once, and that the player keeps its wood and energy for the next step, then offers Next

#### Scenario: A first walk of Lumberjack's step 2 (manual)

- **WHEN** step 2 passes on a run that created the player
- **THEN** the win shows its usual line and no word of an existing account

### Requirement: The step's pass says it passed on an existing account

`tutorial_step_passed` SHALL carry `reason` with the value `"exists"` when the step passed because the account its goal creates already exists, and SHALL carry no `reason` on any other pass. Its other parameters (`tutorial`, `step`, `via`, `seconds`) are unchanged. A reload SHALL keep the reason with the step's pass.

#### Scenario: The event on an existing account (manual)

- **WHEN** Lumberjack's step 2 passes from the Call panel on an existing player
- **THEN** `tutorial_step_passed` fires once with `step` 2, `via` `call_panel` and `reason` `exists`
