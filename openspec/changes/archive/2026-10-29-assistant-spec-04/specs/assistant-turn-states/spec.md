# Spec Delta

## Purpose

Says honestly what the assistant is doing while a reply is pending, and offers a way to ask again when a reply was stopped or cut off.

## ADDED Requirements

### Requirement: Thinking counts the seconds
While a turn runs and its reply has no text yet, the thread SHALL show a status named "Assistant is working" that reads "Thinking" and, from the first full second, the seconds elapsed ("Thinking 3s"). The count SHALL NOT be announced each second. Under reduced motion nothing in it SHALL animate.

#### Scenario: Before the first text (manual)
- **WHEN** a message is sent and three seconds pass with no text
- **THEN** the status "Assistant is working" reads "Thinking" and "3s"

#### Scenario: Text arrives (manual)
- **WHEN** the reply's first text streams in
- **THEN** the "Assistant is working" status is gone

### Requirement: A stopped reply can be asked again
Stop, or Escape in the composer while a reply runs, SHALL leave the notice "Stopped." in the thread. While it is the thread's last item and no turn runs, it SHALL carry a button named "Try again" that sends the last message the person sent again, as a new turn, and sends `assistant_reply_retried` with `after: "stopped"`.

#### Scenario: Try again after Stop
- **WHEN** the person stops a reply to "What does this program do?" and presses "Try again"
- **THEN** "What does this program do?" is sent again as a new turn and `assistant_reply_retried` is sent with `after: "stopped"`

#### Scenario: Escape stops a reply (manual)
- **WHEN** a reply is streaming and the person presses Escape in the composer
- **THEN** the reply stops and the thread shows "Stopped." with "Try again"

#### Scenario: Try again goes once the conversation moves on (manual)
- **WHEN** the person sends another message after "Stopped."
- **THEN** the "Stopped." notice no longer shows "Try again"

### Requirement: A cut-off reply says so
A reply SHALL read as cut off when the request failed with a network error after the reply began streaming, or when the thread is opened and the reply was still streaming in no turn this tab is running (the page was reloaded or closed mid-reply). A cut-off reply SHALL keep its text and show "This reply was cut off."; while it is the thread's last item and no turn runs, it SHALL carry "Try again", which sends `assistant_reply_retried` with `after: "interrupted"`. A network cut SHALL send `assistant_reply_failed` with `reason: "interrupted"`. Any other failure SHALL still show its error.

#### Scenario: The connection drops mid-reply (manual)
- **WHEN** the reply has streamed "The program" and the request then fails with a network error
- **THEN** "The program" stays, "This reply was cut off." shows with "Try again", and `assistant_reply_failed` is sent with `reason: "interrupted"`

#### Scenario: A reload mid-reply (manual)
- **WHEN** the page is reloaded while a reply is streaming and the thread opens again
- **THEN** the partial reply shows "This reply was cut off." with "Try again"

#### Scenario: A failure before any text (manual)
- **WHEN** the request fails with a network error before any text streamed
- **THEN** the thread shows the error, not "This reply was cut off."
