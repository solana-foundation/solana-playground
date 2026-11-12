# Design

## Context

`PgAssistant` holds three things in memory (`store.ts`): `_skillChoices`, `_gatewayServersOff`, `_localServers`. The
skills and gateway lists are asked from the server by `initMcp`, on mount and on an account change, and replaced whole.
`localStorage` is near its origin budget, so storage is `PgFs`, as for chat threads.

## Decisions

**One file, `/.config/assistant-tools.json`, read once per page.** `{skills: {id: bool}, gatewayServersOff: [id],
mcpServers: [entry]}`. It stays out of `/.config/chats`, so sign-out's clear of that directory leaves it: these are
choices about this browser and hold no account data or credential.

**A new module, `model/tool-config.ts`, holds the rules; the store holds the state.** Parse, serialise and prune are
pure and tested in the module. Writes join `_lastWrite`, so `whenPersisted` covers them and two writes keep their order.

**`initMcp` awaits the read first.** Discovery must not call a server the user turned off, and a skill row must not
show its default for a moment.

**Credentials: every field that can hold one is stripped.** Slava's decision names `authToken`. `types.ts` documents
`queryParams` and `protection` as credentials and `headers` as the place an `Authorization` goes, and a `url` query can
hold one too. Storing those would break the rule in all but name. Our call, and non-secret values in those fields are
re-entered too.

**Restored entries say what they lost, by field name.** The `missing` list is stored per entry, so it survives more
reloads. Applying an entry with a change is the user's answer and clears it, with or without those fields, as Tool - Design
alignment set on 2026-11-05; an entry left as it was beside the one edited keeps its line. A restored entry stays as the user left it, on or off: a failed listing is already logged and shown
by the console.

**Pruning only signed in.** A signed-out list lacks `signedIn` sources, so pruning against it would lose a choice.

**The editor follows the store while it is not being edited.** The read can land after `Grounding` mounted, so a draft
equal to the last applied text moves with it.

## Risks

- Two tabs write last-wins. `tab-sync` could announce it later; a lost toggle costs one click.
- A file that does not parse reads as no edits and the next edit replaces it. Reported through `persistence:diagnostics`.
- A secret in a URL's path cannot be told from an address, so it is stored. The docs say to put one in a field instead.
