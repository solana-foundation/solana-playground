# client-v2-command-stop Specification

## Purpose
How a person stops a build or a deploy that is running, from the terminal or
from the console strip, and what the terminal says a stop left behind.

## Requirements

### Requirement: The strip offers Stop while a build or a deploy runs

While a build or a deploy runs, the console strip SHALL show a button named
"Stop build" or "Stop deploy" (its `aria-label`; its text is "Stop"),
whether the console is folded or open. On a desktop, Clear SHALL stay beside
it, turned off; below the phone breakpoint Stop SHALL take Clear's place and
be at least 44 px tall. Pressing Stop SHALL stop the run. When nothing runs,
Stop SHALL not be there.

#### Scenario: Stop shows while a build runs

- **WHEN** a build is running and the console is open on a desktop
- **THEN** the strip shows a button labelled "Stop build" and Clear turned off

#### Scenario: Stop leaves when the run ends

- **WHEN** a build that was running finishes
- **THEN** the strip shows no "Stop build" button

### Requirement: A stopped build keeps nothing

Stopping a build SHALL abort its request to the build server. A reply that
arrives after the stop SHALL be dropped: the project's build state, its IDL
and its build output stay as they were before the run. The terminal SHALL
print `^C` and "Stopped.", and return the prompt. The Build stage SHALL
return to what it showed before the run, and the strip SHALL read "Build
stopped". No failure message or toast SHALL appear.

#### Scenario: Stop during a build

- **WHEN** a build is waiting on the build server and the person presses
  "Stop build"
- **THEN** the terminal prints "Stopped." and the prompt, the strip reads
  "Build stopped", and no build output, error or toast is shown

#### Scenario: Ctrl+C during a build

- **WHEN** a build is waiting on the build server and the person presses
  Ctrl+C in the terminal with nothing selected
- **THEN** the terminal prints `^C` and "Stopped.", and the prompt returns

#### Scenario: ⌘. during a build

- **WHEN** a build is waiting on the build server and the person presses ⌘.
  in the terminal
- **THEN** the terminal prints `^C` and "Stopped.", and the prompt returns

### Requirement: A deploy stops only while it funds and writes

Stopping a deploy SHALL take effect while it funds the wallet or writes the
buffer: at its next transaction, or between chunks of the write, after
"Stopping after this step…". It SHALL ask no question. A stop after the
buffer exists SHALL close the buffer and return its SOL. The terminal SHALL
print `^C` and one line:

- before the buffer exists: "Stopped. The program was not deployed."
- after the buffer was closed: "Stopped. The program was not deployed. Its
  buffer account was closed and the SOL returned."
- if closing failed: "Stopped. The program was not deployed. The buffer
  account <address> still holds its SOL; run `solana program close
  --buffers` to reclaim it."

The program on chain SHALL stay as it was. From the final deploy or upgrade
on, a stop SHALL print "This step can't be stopped. Wait for it to finish."
and the deploy SHALL go on. After a stop the Deploy stage SHALL return to
what it showed before the run, and the strip SHALL read "Deploy stopped"; a
stop of the build that a deploy runs first reads "Build stopped". No deploy is
recorded in the history.

#### Scenario: Stop during the write step (manual)

- **WHEN** a deploy is writing chunks to its buffer on devnet and the person
  presses "Stop deploy"
- **THEN** the write ends after the chunks in flight, the buffer is closed and
  the terminal says so, the strip reads "Deploy stopped", and the program on
  chain is unchanged

#### Scenario: Stop before the buffer exists (manual)

- **WHEN** a deploy is fetching its program binary and the person presses
  "Stop deploy"
- **THEN** no transaction is sent and the terminal prints "Stopped. The
  program was not deployed."

#### Scenario: Stop during the final step (manual)

- **WHEN** a deploy has written its buffer and sends the deploy transaction,
  and the person presses Ctrl+C
- **THEN** the terminal prints "This step can't be stopped. Wait for it to
  finish." and the deploy ends as it would have

### Requirement: A command that cannot stop says so

Ctrl+C while a command that does not honour a stop is running SHALL print
`^C` and "`<command>` can't be stopped. Wait for it to finish.", and the
command SHALL go on. A stop pressed again while a run is already stopping
SHALL print nothing more.

#### Scenario: Ctrl+C during a command that cannot stop (manual)

- **WHEN** `airdrop` is running and the person presses Ctrl+C
- **THEN** the terminal says `airdrop` can't be stopped, and the airdrop goes
  on to its own result
