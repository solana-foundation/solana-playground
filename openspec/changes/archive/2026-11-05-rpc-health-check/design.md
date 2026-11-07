# Design

## Context

`PgCustomRpcs.save`/`replace` (`entities/custom-rpc`) check the URL rule and duplicates and write in one synchronous call. `NetworkSection` called them from `BaseCustomRpcs`' form, whose `onSave` answered synchronously. The settings page draws every entry of `PgSettings.all` grouped by id prefix, which is how `connection.endpoint` shows up as "Endpoint" in Connection. `SETTINGS` also feeds the generated defaults, so the setting cannot be deleted.

## Goals / Non-Goals

**Goals:** check before save without a second write path; keep the form a dumb view that renders states the section hands it.

**Non-Goals:** checking a network that is already picked; retrying; caching results.

## Decisions

- **The request is JSON-RPC `getHealth`, POST, aborted by an `AbortController` on a 5 s timer** (`fetchRpcHealthWithin`; a timer of our own rather than `AbortSignal.timeout`, so tests drive it with fake timers). Every Solana RPC serves it and it costs nothing. Any `fetch` that resolves counts as an answer, whatever its status: a 401 from a provider or "node unhealthy" is still an RPC that answered, and the person's own key problem shows on first use. A rejection (DNS, TLS, CORS, abort) is no answer; the browser hides which. Alternative: require `result === "ok"`, rejected because an RPC that is behind still works for a playground and the spec asks only about an answer.
- **Pre-check without writing.** `PgCustomRpcs.check(input, replacing)` answers the same format/duplicate refusals `put` would, so no request goes out for a value that would be refused anyway. `put` keeps its own checks: the list can change during the 5 s wait (another tab).
- **`onSave` becomes async, and its answer a union.** `CustomRpcSaveAnswer` is `saved`, `refused` (a line) or `unreachable` (a line and `useAnyway`), and the form's state is that answer or `editing`/`checking`, so only an unchecked URL can carry the button. While a form checks, Save shows a spinner, both fields are read-only, Cancel is disabled, and the list's Edit, Remove and Add are disabled too: the save still lands when the URL answers, and its close must not close a form opened meanwhile. A save that throws unlocks the form with "Could not save in this browser." and is reported through the logger. "Use anyway" saves what was checked, so editing either field takes it back.
- **Offline is `navigator.onLine === false`.** Cheap, and it covers the airplane case Spec 07 names. Offline also offers "Use anyway" (Design alignment, 4 Nov): the check could not run, the URL may be fine. Copy follows the app's "not responding" wording (Design alignment, 4 Nov) over Spec 07's "No answer from this URL.". A false "online" just falls through to the request and its no-answer path.
- **Hide, don't delete, the Endpoint row.** The page filters `connection.endpoint` out of `PgSettings.all` by id (a set of ids the Network section owns), so the stored setting, its defaults and the terminal keep working.
- **The health request lives in the entity** (`entities/custom-rpc/model/health.ts`); the widget's `saveCheckedWith(fetchHealth)` takes it as its first argument, so the model's tests pass a health function and only `health.ts` and the `NetworkSection` test stub `fetch`.

## Risks / Trade-offs

- [A CORS-blocked RPC that works from the server reads as no answer] → "Use anyway" exists for exactly that.
- [Settings is closed (Escape) while a URL is checked] → the save still lands and is picked when the URL answers: the person pressed Save, and the list shows it next time. Nothing inside the form can close it mid-check.
- [A URL with credentials (`https://user:pass@host`) makes `fetch` throw before any request] → it reads as not responding, and "Use anyway" saves it; such URLs are rare for RPCs.
- [A gap: no source draws "Use anyway"] → link-style ghost button after the error text, recorded in the PR's Design gaps and sent to the designers' batch.
