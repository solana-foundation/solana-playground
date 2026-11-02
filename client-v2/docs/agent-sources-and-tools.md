# Agent sources and tools

What the assistant can draw on beyond its model: the skills and MCP servers listed in its Sources tab.

## Skill entries

A skill is a `SKILL.md` document and the reference files it names. The model reads the catalogue of checked
skills, a name and a description each, in its prompt, and loads a skill's text with `load_skill` when it decides
it needs it. The skills are the `skill` entries of `SOURCES_CATALOGUE` in
[`sources.mjs`](../src/shared/config/sources.mjs), or of the `SOURCES` variable that replaces it
([deploy-client-vercel.md](deploy-client-vercel.md), "Sources catalogue"). `GET /api/skills` lists them, and the
Sources tab shows what it lists and nothing else, for every backend: the default one or the user's own key. A
skill the deployment leaves out is absent from the tab, the prompt, and `load_skill`. When the route fails, the
tab lists no skill.

```json
{
  "kind": "skill",
  "id": "orca",
  "name": "Orca",
  "description": "Orca Whirlpools SDK for concentrated-liquidity swaps, positions, pool creation, and fee collection.",
  "source": {
    "type": "remote",
    "baseUrl": "https://raw.githubusercontent.com/sendaifun/skills/72ef2aa814cca4662341bfcdc01cdc288e9bb502/skills/orca/",
    "entry": "SKILL.md"
  },
  "enabled": false,
  "community": { "repo": "sendaifun/skills" }
}
```

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `kind` | yes | `"skill"`. |
| `id` | yes | Letters, digits, `-` and `_`: the name the model passes to `load_skill`. Unique across the catalogue, servers included. |
| `name` | yes | What the Sources tab shows. |
| `description` | yes | One sentence the model reads when deciding whether to load the skill. It sits in the prompt for every checked skill, so it is written for this list, not copied from the skill's frontmatter. |
| `source` | yes | `{ "type": "bundled" }` for a document shipped in the app, or `{ "type": "remote", "baseUrl", "entry" }` for one fetched when loaded: `baseUrl` is an `https://` folder ending in `/`, and `entry` is the document's file name inside it, usually `SKILL.md`. |
| `enabled` | no | `false` lists the skill unchecked: the prompt does not name it and `load_skill` refuses it until the user checks it. Defaults to `true`. |
| `community` | no | `{ "repo": "owner/repo" }` on a skill a third party publishes. The Sources tab lists it under "Community skills" with the repository in its note. |
| `signedIn` | no | `true` offers the skill only to a caller signed in on this site. |

A bundled skill's text is in the app's bundle, keyed by its id (`BUNDLED_SKILLS` in
[`registry.ts`](../src/features/skills/model/registry.ts)). The catalogue can offer or withhold it, never change
it, and a bundled id the bundle does not know is left out. A bundled skill is always on, and has no reference
files.

### Pinned to a commit

Every remote skill other than `solana-dev` has a `baseUrl` on `raw.githubusercontent.com` whose path holds a full
40-character commit hash, never a branch:

```text
https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<folder>/
https://raw.githubusercontent.com/sendaifun/skills/72ef2aa814cca4662341bfcdc01cdc288e9bb502/skills/orca/
```

A skill's text enters the model's context. A branch would let the skill's owner change what every deployment's
model reads; a commit means the text changes only with a change to `SOURCES_CATALOGUE`, reviewed like any other.
[`sources.test.mjs`](../src/shared/config/sources.test.mjs) fails on a community entry whose `baseUrl` names a
branch.

`read_skill_reference` resolves a path against the skill's `baseUrl` and refuses one that leaves that folder, so
a `SKILL.md` cannot send the model to another skill's files or another site.

### Community skills

The community entries are the skills [solana.com/skills](https://solana.com/skills) lists, each at the commit the
page links, each with `enabled: false`, and none with `signedIn`: every caller gets them, and a third party's text
reaches the model only after the user checks its skill. The page's Foundation entries are files under
`solana-dev`'s `references/`, which `read_skill_reference` already reaches, so they have no entries of their own.
Clawpump, which the page also lists, has no entry: its repository answered 404.

Adding or updating a skill is a change to `SOURCES_CATALOGUE`, or, for one deployment, to its `SOURCES`.

## MCP server entries

The assistant's "Additional servers" editor, in the Sources tab, takes a JSON array of server entries. The
gateway's own list uses the same format, with `"kind": "mcp"` and an optional `signedIn` added: the `mcp` entries
of `SOURCES_CATALOGUE` in [`sources.mjs`](../src/shared/config/sources.mjs), or of the `SOURCES` variable that
replaces it ([deploy-client-vercel.md](deploy-client-vercel.md), "Sources catalogue"). One validator,
[`validateServers`](../src/features/mcp/model/entry.mjs), checks both, so an entry that the editor accepts is an
entry the gateway accepts.

```json
[
  {
    "id": "docs",
    "name": "Team docs",
    "url": "https://docs.example.com/mcp",
    "authToken": "…"
  }
]
```

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Letters, digits, `-` and `_`, without `__`. It prefixes the server's tool names (`docs__search`), so it is unique across the list, and it may not repeat an id the gateway serves. |
| `url` | yes | The server's Streamable HTTP endpoint. `https://` for a remote server. In the editor only, a path starting with `/` for this site's gateway. |
| `name` | no | What the Sources tab and the chat show. Defaults to the `id`. |
| `enabled` | no | `false` keeps the entry without offering its tools. Defaults to `true`. The checkbox beside the server sets it. |
| `authToken` | no | Sent as `Authorization: Bearer <authToken>`. |
| `headers` | no | An object of strings, sent on every request. |
| `queryParams` | no | An object of strings, added to the URL. An enabled entry may not leave a value blank. |
| `protection` | no | A bot-protection bypass, described under "Protection". |

The editor rejects the whole list, with a message naming the entry and the field, when any entry breaks these
rules. Nothing is applied until the list is valid.

### Calling a server from the browser

An entry in the editor is called from the browser. The server must send CORS headers that allow this site's
origin, and must list every custom header in `Access-Control-Allow-Headers`. A header it does not list fails the
preflight, and the request is not sent.

A credential the server reads from somewhere other than the `Authorization` header is safer in `queryParams`
than in `headers`, because a query parameter needs no preflight permission. A server that sends no CORS headers
at all cannot be called from the browser. It has to be added to the gateway's list by whoever runs the
deployment.

### Credentials in the gateway's list

In the gateway's list, an entry's `authToken`, `headers`, `queryParams`, and `protection` belong to the
deployment. The gateway sends them only for a caller signed in on this site. Any other caller reaches the same
server without them. A user with their own key for that server adds it to the editor with the key.

### Protection

`protection` names a bot-protection provider and the secret that gets past it:

```json
{
  "id": "preview",
  "url": "https://preview.example.com/mcp",
  "protection": { "provider": "vercel", "secret": "…" }
}
```

The provider decides how the secret travels. The browser sends it as a query parameter, which needs no
preflight permission. The gateway sends it as a header. The supported providers and their parameter names are
in `PROTECTION_PROVIDERS` ([`protection.mjs`](../src/features/mcp/model/protection.mjs)). Supporting another
provider is a new entry there.

An entry with no `protection` sends no bypass. In the gateway's list, a secret written as `"${NAME:-}"` turns
the bypass on only when the variable `NAME` is set.

### Examples

A public server that allows browser calls:

```json
[{ "id": "solana-docs", "url": "https://mcp.solana.com/mcp" }]
```

A server that wants an API key in the URL, switched off until needed:

```json
[
  {
    "id": "indexer",
    "name": "Indexer",
    "url": "https://indexer.example.com/mcp",
    "enabled": false,
    "queryParams": { "api-key": "…" }
  }
]
```
