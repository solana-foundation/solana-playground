# "Open in Playground" link

A docs page opens one TypeScript file in Solana Playground with a link of
this form:

```text
https://beta.solpg.io/open#v=1&name=<file>&title=<title>&from=<page>&sol=<amount>&code=<code>
```

Everything after `#` is the URL fragment, so the code never reaches a server.

| Key | Required | Value |
| --- | --- | --- |
| `v` | yes | `1`, the format version |
| `name` | yes | The file's name: letters, digits, `.`, `_` or `-`, ending in `.ts` or `.js` (`quickstart.ts`) |
| `code` | yes | The file's UTF-8 text, raw-DEFLATE compressed (RFC 1951), base64url without padding. Not empty, and at most 100 KiB before compression |
| `title` | no | Shown above the code, as "From {host}: {title}". Defaults to `name` without its extension |
| `from` | no | The docs page, an `https:` URL on `solana.com` or one of its subdomains. Playground links back to it ("View the docs page", "Back to the docs"). Any other URL is ignored |
| `sol` | no | Devnet SOL the script needs, a number above 0 such as `0.02`. When the Playground wallet holds less, Run asks the user to fund it first. Any other value breaks the link |

Encode every value with `encodeURIComponent` (or `URLSearchParams`).

## Building the link

```js
import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";

const code = readFileSync("quickstart.ts");
const params = new URLSearchParams({
  v: "1",
  name: "quickstart.ts",
  title: "Quickstart",
  from: "https://solana.com/docs/quickstart",
  sol: "0.02",
  code: deflateRawSync(code).toString("base64url"),
});
const href = `https://beta.solpg.io/open#${params}`;
```

## What the script can use

- Packages: `@solana/kit`, `@solana/kit-plugin-rpc`,
  `@solana/kit-plugin-signer`, `@solana-program/system`,
  `@solana-program/token-2022`, plus Playground's earlier list (`@solana/web3.js`,
  `@solana/spl-token`, `@coral-xyz/anchor` and others). If a script imports
  anything else, Playground shows which package it can't load, and nothing runs.
- `signerFromFile(<any path>)` is the user's Playground wallet. With another
  wallet selected, the run fails and asks the user to switch to it.
- Top-level `await`, BigInt literals, ES2020.
- One file. Relative imports (`./other`) are not supported.

## What the user sees

The file opens as an unsaved client project, with only the Write stage and a
Run button. One Run runs the file. The output appears in the terminal, and a
note above the code says how the run ended. A link that does not decode shows
"This link is broken", with a way back to the docs.
