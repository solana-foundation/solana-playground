# Design

## Context

- `remembered-backend.ts` (HOO-1748) keeps a key-based connection whole in the
  tab's `sessionStorage` and only the provider id in `localStorage`
  (`REMEMBERED_BACKEND_KEY`). A new tab or a restart has no key.
- `useTurn.start` (`widgets/assistant/model/use-turn.ts`) calls
  `connectDefault()` whenever nothing is connected, whatever produced the
  thread. `onDidRequestPrompt` in the same hook does the same for prompts sent
  from outside the panel.
- `PgAssistant.connect` calls `clear()` when the new connection is not
  `isCurrent`. `useTurn` already rebuilds the provider on a new connection
  object and seeds it with `toReplayMessages(PgAssistant.items)`, so the clear
  is not what makes a switch safe; it only drops what is on screen.
- Every assistant item carries `origin: BackendParams` (provider, model, base
  URL, effort; never the key), written at the reply and synced with the
  thread. Nothing reads it yet.
- `ConnectPreset` is `{ provider, model? }`; `openConnect(via, preset)` exists.
- `AiTurnError` (`shared/lib/ai/run-turn.ts`) carries the HTTP `status`.

## Goals / Non-Goals

**Goals:**

- One decision, used by both send paths, for which backend a send with
  nothing connected goes to.
- No key written anywhere it is not today.

**Non-Goals:**

- Reconnecting a key-based backend without the user typing the key.
- A shared transcript with tool calls across backends (HOO-1752).
- A visual for which model wrote which reply.

## Decisions

1. **The thread's backend is the last reply's `origin`.** A pure function in
   `views/sidebar/assistant/model` (`threadBackend(items)`) returns the
   `origin` of the last assistant item that has one, else `undefined`. The
   send path asks it first, then the remembered choice. Alternative: store a
   backend on the thread itself; rejected, since `origin` is already written
   and synced per reply, and a per-thread field would need a storage format
   change and its own merge rule.

2. **One resolver for "nothing connected".** `resolveSendBackend()` in
   `use-turn.ts` answers one of `{ kind: "default" }`,
   `{ kind: "ask", preset, via: "thread" | "send" }`. `start` and
   `onDidRequestPrompt` both use it; only `"default"` may call
   `connectDefault()`. The discriminated union replaces the two hand-written
   conditions that disagree today.

3. **`ConnectPreset` gains `baseUrl` and `effort`**, so a `BackendParams` is
   a preset as it stands and passes to `openConnect` with no mapping. Connect a model fills the base URL and effort fields from it
   where the provider has them, and leaves the key empty.

4. **The remembered choice becomes `BackendParams` JSON** under the same
   `localStorage` key. `rememberBackend` writes `paramsOf(connection)`, so the
   key cannot reach it by construction. The reader accepts the old bare id (a
   string that is not JSON) as `{ provider: id }`; this is the one format
   step, and it needs no write-back. `isDefaultBackendRemembered` reads the
   provider from either form.

5. **`connect()` stops clearing.** The provider rebuild in `useTurn` on a new
   connection object, seeded from what is rendered, already carries the
   conversation over. Sign-out keeps calling `clear()` directly; that path
   is unchanged. The JSDoc of `connect` and `clear`, and the composer's model
   pick comment, are corrected in the same commit.

6. **A rejected key is an error item with a recovery.** The error item gains
   an optional `recover?: BackendParams` (the connection's params, never the
   key). `useTurn` sets it when the turn throws an `AiTurnError` with status
   401 (a 403 can be a valid key without access, so it keeps its message), with the text "<Provider name> did not accept this key. Check it and enter it again, or pick another model." (Spec 08, state AI-05, without the status code). The
   item renders an **Enter key** button (`#assistant-enter-key`, the design
   system's `Button`) that calls `openConnect("key-rejected", recover)`.
   Alternative: a notice outside the thread; rejected, as the error belongs
   to the turn that failed and a thread restored later should still explain
   it. The button shows only while nothing but notices follows the error.

## Risks / Trade-offs

- [A reply's `origin` names a provider this build no longer has] → the
  resolver treats it as absent and falls back to the remembered choice.
- [A thread restored from before `origin` existed] → no `origin`, so the
  remembered choice decides, which is today's behaviour for the default.
- [Seeding a different backend with text-only history loses tool calls] →
  accepted, as a reload already does; HOO-1752 addresses it.
- [Two tabs write the remembered choice] → last write wins, as today.

## Migration Plan

The remembered choice's old bare-id form is read in place; nothing is
rewritten until the user next connects. Rollback reads the JSON as an unknown
id and shows the picker, which is safe.
