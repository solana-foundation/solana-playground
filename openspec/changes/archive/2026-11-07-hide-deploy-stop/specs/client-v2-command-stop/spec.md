## RENAMED Requirements

- FROM: `### Requirement: The strip offers Stop while a build or a deploy runs`
- TO: `### Requirement: The strip offers Stop while a build runs`

## MODIFIED Requirements

### Requirement: The strip offers Stop while a build runs

While a build runs, the console strip SHALL show a button named "Stop build"
(its `aria-label`; its text is "Stop"), whether the console is folded or
open. This includes the build a deploy runs first when the program is not
built. On a desktop, Clear SHALL stay beside it, turned off; below the phone
breakpoint Stop SHALL take Clear's place and be at least 44 px tall. Pressing
Stop SHALL stop the run, and with it the deploy that started the build. While
a deploy runs with no build in flight, and when nothing runs, Stop SHALL not
be there.

#### Scenario: Stop shows while a build runs

- **WHEN** a build is running and the console is open on a desktop
- **THEN** the strip shows a button labelled "Stop build" and Clear turned off

#### Scenario: Stop leaves when the run ends

- **WHEN** a build that was running finishes
- **THEN** the strip shows no "Stop build" button

#### Scenario: No Stop while a deploy runs (manual)

- **WHEN** a deploy is running and no build is in flight
- **THEN** the strip shows no Stop button

### Requirement: A deploy stops only while it funds and writes

A deploy SHALL be stopped from the terminal, with Ctrl+C or ⌘.; a question
the deploy asks SHALL be answered, not stopped. Stopping a deploy SHALL take
effect while it funds the wallet or writes the buffer: at its next
transaction, or between chunks of the write, after "Stopping after this
step…". It SHALL ask no question. A stop after the
buffer exists SHALL close the buffer and return its SOL. The terminal SHALL
print `^C` and one line:

- before the buffer exists: "Stopped. The program was not deployed."
- after the buffer was closed: "Stopped. The program was not deployed. Its
  buffer account was closed and the SOL returned."
- if closing failed: "Stopped. The program was not deployed. Its buffer
  <address> still holds its SOL. Run `solana program close
  --buffers` to get it back."

The program on chain SHALL stay as it was. From the final deploy or upgrade
on, a stop SHALL print "This step can't be stopped. Wait for it to finish."
and the deploy SHALL go on. After a stop the Deploy stage SHALL return to
what it showed before the run, and the strip SHALL read "Deploy stopped"; a
stop of the build that a deploy runs first reads "Build stopped". No deploy is
recorded in the history.

#### Scenario: Stop during the write step (manual)

- **WHEN** a deploy is writing chunks to its buffer on devnet and the person
  presses Ctrl+C
- **THEN** the write ends after the chunks in flight, the buffer is closed and
  the terminal says so, the strip reads "Deploy stopped", and the program on
  chain is unchanged

#### Scenario: Stop before the buffer exists (manual)

- **WHEN** a deploy is fetching its program binary and the person presses
  Ctrl+C
- **THEN** no transaction is sent and the terminal prints "Stopped. The
  program was not deployed."

#### Scenario: Stop during the final step (manual)

- **WHEN** a deploy has written its buffer and sends the deploy transaction,
  and the person presses Ctrl+C
- **THEN** the terminal prints "This step can't be stopped. Wait for it to
  finish." and the deploy ends as it would have

#### Scenario: A stop whose buffer could not be closed (manual)

- **WHEN** a deploy is stopped after its buffer exists and closing the buffer
  fails
- **THEN** the terminal prints "Stopped. The program was not deployed. Its
  buffer <address> still holds its SOL. Run `solana program close
  --buffers` to get it back.", in two sentences with no semicolon

