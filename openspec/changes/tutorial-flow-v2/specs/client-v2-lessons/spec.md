# Spec Delta

## MODIFIED Requirements

### Requirement: The assistant offers the lesson's questions

The assistant's empty thread SHALL offer "What does this program do?", "Why
did my build fail?" and "How do I deploy this?". The composer's context chips
SHALL read one chip per file in the context (`assistant-composer-context`). A
conversation tutorial has no assistant panel of its own; its composer is the
conversation's (`tutorial-conversation`).

#### Scenario: Suggestions in a lesson

- **WHEN** a conversation tutorial is open
- **THEN** no assistant panel offers lesson suggestions
- **AND** free questions go through the conversation's composer

#### Scenario: Suggestions outside a tutorial

- **WHEN** a project is open and the assistant has no messages
- **THEN** it offers "What does this program do?", "Why did my build fail?"
  and "How do I deploy this?"
- **AND** the chips read "lib.rs", "1 file"

## REMOVED Requirements

### Requirement: A lesson opens on its code

**Reason**: The reader and the band's "Read the page" served the lesson path
only. In the conversation the lesson is the chat and the intro card opens it
(`tutorial-conversation`).

**Migration**: None. Hello Anchor's page text moves into its definition's
beats.

### Requirement: The objective band is one row

**Reason**: The band served the lesson path, and Hello Anchor had the only
one. Hello Anchor now runs in the conversation (`tutorial-conversation`),
where the step bar and the cards take the band's place.

**Migration**: A tutorial with a lesson path gets a definition
(`tutorial-definition`). Its steps, goals and hints move into it.

### Requirement: The step rail reads as the prototype's

**Reason**: The conversation's step bar and dividers replace the rail
(`tutorial-conversation`, "Each step opens with a divider and the step bar
jumps to it").

**Migration**: None. No tutorial other than Hello Anchor had a rail.

### Requirement: The phone's lesson bar

**Reason**: The phone shows the conversation with its own header and tabs
(`tutorial-phone`).

**Migration**: None.
