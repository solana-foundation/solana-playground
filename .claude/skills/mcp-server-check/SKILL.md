---
name: mcp-server-check
description: Check by hand that an MCP server added through the assistant's "Additional servers" editor answers from the browser, including one behind bot protection. Launches client-v2, fills a sample entry, waits for the user to put in the real URL and secret, then has the model call ping and inspect_entity on the System Program and reports what travelled. Use for /mcp-server-check, or when asked to try an MCP server, an Explorer preview, or a bypass secret in the Playground.
---

# MCP server check

A walk-through of one server entry in the Sources tab, end to end: the entry is accepted, the browser reaches
the server, and the model gets real answers from its tools. The user owns the URL and the secret; the agent
never reads, types, or prints them.

## Inputs

- **Server id** (optional): defaults to `explorer-preview`. It must not repeat an id the gateway serves
  (`GET /api/mcp` lists them), or the editor refuses the entry.
- **Protected** (optional): whether the server sits behind bot protection. Defaults to yes, the Vercel case.

## 1. Launch the app

From `client-v2/`, start the dev server in the background, with the Node the repository pins (`.nvmrc`):

```sh
BROWSER=none yarn dev
```

Wait until it prints "Compiled", then check that the routes answer:

```sh
curl -s http://127.0.0.1:3000/api/mcp
curl -s http://127.0.0.1:3000/api/skills
```

A dev server already running from this checkout on port 3000 is reused. One started before a change to
`api/*.mjs` is restarted first: the dev server loads those routes once, at start.

## 2. Open the Sources tab

With the Chrome DevTools MCP, open `http://127.0.0.1:3000` and wait for the assistant panel. Open its "More"
menu and choose "Sources and tools". The menu opens on `pointerdown`, not on a click:

```js
document.querySelector('button[aria-label="More"]')
  .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
[...document.querySelectorAll('[role="menuitem"]')]
  .find((item) => /Sources and tools/.test(item.textContent))
  .click();
```

A click through the DevTools tool on the menu item can reach the editor behind it and type into the open
file. Check the file is unchanged afterwards.

## 3. Fill the sample entry

Open "Additional servers" and put the sample into the editor (`textarea[aria-label="MCP server
configuration"]`). React reads the value only through an `input` event, so set it with the native setter:

```js
const editor = document.querySelector('textarea[aria-label="MCP server configuration"]');
const sample = JSON.stringify([{
  id: "explorer-preview",
  name: "Explorer (preview)",
  url: "https://PASTE-SERVER-HOST/mcp",
  protection: { provider: "vercel", secret: "PASTE-BYPASS-SECRET" },
}], null, 2);
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, sample);
editor.dispatchEvent(new Event("input", { bubbles: true }));
```

Leave out `protection` for a server without bot protection. Do not press Apply: the placeholder host is not a
server.

## 4. Wait for the user

Stop and ask the user to replace `PASTE-SERVER-HOST` and `PASTE-BYPASS-SECRET` in the editor and press
Apply. Continue only once they say it is done. Never ask them to paste the secret into the chat.

After Apply, check that the entry's row appears under "MCP servers", checked, with no error under the editor.
An error names the field it rejects; report it and stop.

## 5. Call the tools through the model

Make sure a model is connected ("Connect the assistant" in the setup list is done). If not, ask the user to
connect one and wait. Then, in the chat composer (`textarea[aria-label="Message the assistant"]`), focus it
and type with the DevTools `type_text` tool, which React picks up:

1. `Call the explorer-preview__ping tool and tell me what it returned.`
2. `Inspect 11111111111111111111111111111111.`

Use the server id from step 3 in the tool name.

Expect:

| Turn | Tool line in the chat | Answer |
| --- | --- | --- |
| ping | "ping on Explorer (preview)" | `pong` |
| inspect | "inspect_entity on Explorer (preview)" | The System Program: kind `native-program`, executable, no errors |

The tool line names the entry's `name`, which tells the call went to this entry and not to the gateway's
Explorer.

## 6. Check what travelled

List the page's network requests (`fetch` and `preflight`). The tool calls go from the browser straight to
the server's host, not through `/api/mcp`. For a protected entry, each URL carries the provider's query
parameter (`x-vercel-protection-bypass` for `vercel`, from `PROTECTION_PROVIDERS` in
`src/features/mcp/model/protection.mjs`). Check that the parameter is present; never print its value. A
preflight that fails means the host does not allow this origin: report the host and the origin.

## 7. Report

| Check | Result |
| --- | --- |
| Entry accepted | yes, or the editor's error |
| Request path | browser to `<host>`, bypass parameter present or not |
| ping | the tool line and the answer |
| inspect_entity, System Program | the tool line and the answer |
| Backend | the model and whether it is the default backend or the user's own key |

Leave the dev server running and the entry applied; the user decides when to remove them. The entry lives in
memory and is gone after a reload.
