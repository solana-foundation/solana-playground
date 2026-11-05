# Design

## Context

- Sign-in is Better Auth over GitHub (`features/auth/model/auth.mjs`), in a
  popup (`PgSession.signIn`). It requests Better Auth's defaults,
  `read:user user:email`, and stores the GitHub access token on the `account`
  row. Previews sign in through Better Auth's OAuth proxy, which carries the
  access token back to the preview, but only for `/sign-in/social`.
- The navigation's project menu (`widgets/app-nav`) already runs Export as
  zip and Delete as dialogs, and reads any workspace's files off the store
  (`readWorkspaceFiles`), leaving `.workspace/` out.
- HOO-1761 builds the import in parallel in the same slice; the split is
  agreed with that session (format here, URL parsing and import there).

## Goals / Non-Goals

**Goals:**

- One format both directions use, pure and unit-tested, with the deny rule
  declared once.
- The token stays on the server.
- No change to what sign-in asks of users who never share.

**Non-Goals:**

- Updating a gist already shared (HOO-1762).
- A Playground URL that opens the gist (HOO-1761 and later).
- A design pass on the dialog: there is no design for it yet. It is built
  from the installed dialog parts (`ModalFrame`, `AsyncButton`, `CopyButton`,
  `Callout`) and a design ticket is asked for.

## Decisions

### Incremental scope, through sign-in, not `link-social`

The `gist` scope is asked for only when the route reports it missing, by
running the same sign-in popup with `scopes: ["gist"]` (Better Auth appends it
to the defaults). Alternatives:

- **Add `gist` to every sign-in.** Every user would see "create gists" on the
  consent screen to use an IDE, and every existing session would still lack it
  — so the missing-scope path is needed regardless.
- **`/link-social` with scopes.** Better Auth's documented way to widen scopes,
  and it records the new scope on the account row. But the OAuth proxy only
  handles `/sign-in/social`, so on a preview `link-social` sends GitHub a
  callback it does not know and fails. Sign-in works on both.

Consequence: re-signing-in refreshes the stored token but Better Auth does not
update the row's `scope` column (it only does that on a link). So the route
never trusts `account.scope`; it asks GitHub, by trying, and reads
`X-OAuth-Scopes` on a refusal.

### Server route, not a token in the browser

`api/gists.mjs` reads the token with `auth.api.getAccessToken({ body: {
providerId: "github", userId } })` and calls GitHub itself. Same origin check
(`isAllowedOrigin`) and session read (`readSession`) as the sync routes. The
route gets `{ description, files }` already flattened by the browser; it
checks the body's shape and size and forwards it. Flattening in the browser
keeps the format in one TypeScript module both directions import; `api/`
cannot import `src/` TypeScript.

### Readable flat names plus a manifest

Encoding paths reversibly in names (escaping `/`) needs no manifest but gives
unreadable names and still loses empty files. Names are `path.replaceAll("/",
"__")`, de-duplicated with `-n`, and the manifest is the source of truth, so a
clash never loses a file. A gist without a manifest is read by kind (the
repo-import convention) so hand-made gists open too.

### Slice layout

`features/gist`: `config.mjs` (the limits, manifest name and route reasons
both halves share), `lib/format.ts` (pure: `toGistFiles`, `fromGistFiles`,
`isExportablePath`, `GistFormatError`), `model/export.ts` (`exportProject`:
flatten, check limits, POST, map answers to a result union),
`model/create-gist.mjs` behind `server.mjs` (the GitHub call, used by the
route), `model/telemetry.ts`, and `ui/BaseShareGist.tsx` + `ui/ShareGist.tsx`
(the dialog's body, no frame).

The feature may import neither `auth` nor `widgets/overlays`, and a widget may
not import the overlays either, so the dialog is assembled in the app layer:
`app/ShareGistDialog` puts `ShareGist` in a `ModalFrame` and hands it
`PgSession`'s state (kept current, since the dialog can open before the first
session read answers) and `signIn`. `ProjectList` takes the opener as a prop
from `views/flow/Flow.tsx`, with a reader of the project's files
(`readProjectFiles`, beside the existing `readWorkspaceFiles`).

### Result as a union

`exportProject` returns `{status: "created", url, files} | {status:
"needs-sign-in"} | {status: "needs-gist-scope"} | {status: "failed", reason}`;
the dialog's state is a union of `ready | sign-in | grant | created | failed`
(the button's own spinner covers the wait), never flags.

## Risks / Trade-offs

- [GitHub's answer to a missing scope is a `404` on `POST /gists`, which also
  means other things] → the route treats `404`/`403` as missing scope only
  when `X-OAuth-Scopes` is present and lacks `gist`; otherwise `502`.
- [A re-sign-in for the scope swaps the session] → same user, so the session
  effect sees no account change; covered by a test on `PgSession`.
- [Vercel's 4.5 MB body limit] → the browser refuses over 4 MB before
  sending; the route answers `413` on its own check too.
- [Each share makes a new gist] → accepted until HOO-1762.

## Migration Plan

None: no schema change. The GitHub OAuth app needs no change; scopes are
requested per authorization.
