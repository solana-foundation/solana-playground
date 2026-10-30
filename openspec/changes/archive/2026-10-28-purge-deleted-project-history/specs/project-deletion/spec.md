# Spec Delta

## Purpose

Defines what deleting a project removes, on the device and in the signed-in
user's account, and what the user is told before confirming the delete.

## ADDED Requirements

### Requirement: Deleting a project erases its chat history from the account

When a signed-in user deletes a project, the server SHALL erase the content of
every assistant conversation under that project: all of its messages and its
title. Only a marker that the conversation existed and was deleted with its
project SHALL remain.

#### Scenario: Messages of a deleted project are gone

- **WHEN** a signed-in user deletes a project whose conversation holds messages
- **THEN** the account's database holds no message of that conversation and no
  title for it

#### Scenario: Another project's history is untouched

- **WHEN** a signed-in user deletes one of two projects that each hold a
  conversation
- **THEN** the other project's conversation keeps every message and its title

#### Scenario: Another user's history is untouched

- **WHEN** a user deletes a project whose id another account also uses
- **THEN** the other account's conversation under that id keeps every message

### Requirement: A device holding a deleted thread is told it was deleted

After a project's history is erased, a write to one of its conversations SHALL
still be refused as deleted with the project, never accepted and never treated
as a thread that does not exist.

#### Scenario: Pushing to an erased thread

- **WHEN** a device that still holds a deleted project's thread pushes a message
  to it
- **THEN** the server answers 410 with reason `deleted` and scope `project`, and
  stores nothing

### Requirement: History deleted before this behaviour is erased too

Conversations that were marked deleted before this behaviour existed SHALL have
their messages and titles erased once, when the database is migrated.

#### Scenario: An earlier delete

- **WHEN** the database holds a conversation marked deleted that still has
  messages, and the migration runs
- **THEN** the conversation holds no messages and no title, and live
  conversations keep theirs

### Requirement: The delete confirmation names the chat

The confirmation dialog for deleting a workspace (`delete-workspace`) SHALL tell
the user that the project's assistant chat is deleted with it, from the account
as well when signed in.

#### Scenario: Confirming a delete (manual)

- **WHEN** the user opens the delete dialog for a workspace
- **THEN** the dialog lists the assistant chat among what will be deleted
