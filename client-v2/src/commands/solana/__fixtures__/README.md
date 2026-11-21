# solana CLI fixtures

What the Rust `solana` CLI (`wasm/solana-cli`, package `@solana-playground/solana-cli` 1.11.0) printed, and the
JSON-RPC traffic behind it, recorded for the TypeScript rewrite of `commands/solana` (OpenSpec change
`trim-terminal-solana-cli`, task 1.1, HOO-2901). Unit tests of the rewrite compare their output with `output` byte for
byte.

- Source commit: `daa220948` (`foundation/master`), the `wasm/solana-cli/pkg` built from it.
- Cluster: Devnet (`https://api.devnet.solana.com`).
- Recorded: 2026-11-21, with `TZ=UTC`.

## Format

One JSON file per case:

```json
{
  "command": "solana -u d program show --buffers",
  "settings": { "endpoint": "...", "commitment": "confirmed" },
  "rpc": [{ "url": "...", "request": {}, "response": {} }],
  "output": "text the CLI printed",
  "outputParts": ["one entry per PgTerminal.logWasm call"]
}
```

- `command` is what `runSolana` received (`input.raw`), first word included.
- `settings` is what `PgSettings.connection` returned: the endpoint and commitment the app would have configured. In
  the `-u` cases the endpoint is deliberately Testnet, to show that `-u` wins; every `rpc[].url` there is Devnet.
- `rpc` lists every `fetch` the CLI made, in order, with the parsed JSON body of the request and of the response. A
  batch is one entry whose `request` and `response` are arrays.
- `outputParts` is one string per `logWasm` call, exactly as the wasm passed it: the raw text before
  `PgTerminal.printlnWasm` (and so before `fitBuffersTableWith`) touches it. `output` is the parts joined with `\n`.
  No ANSI escape appears in any recorded output.

## How they were recorded

Not in the browser: the wasm was loaded in Node 22 with its glue file copied and its three imports (`PgSettings`,
`PgWallet`, `PgTerminal`) replaced by shims (endpoint `https://api.devnet.solana.com`, commitment `confirmed`, a
throwaway keypair as the Playground wallet, `logWasm` collecting text) and `globalThis.fetch` wrapped to record pairs.
The harness lives only in the author's `.claude/scratch/` (gitignored). The `confirm` cases use existing public Devnet
transactions on the Memo program. They are history on a public cluster, so a re-recording later may find them pruned.

## Cases

| File | Command |
| --- | --- |
| `confirm-verbose-success-legacy` | `confirm -v 33tHNAXy1dxxjgeomcHLXgf1rsp8Ssi4cs7d6a4sHcvf2uE4Xwakt9Ki3oenVMTViA6SRf7Hh8rVJ1GmMs2kDZHu` (legacy, with logs) |
| `confirm-verbose-success-v0` | `confirm -v 4XdzsEyNT2UMR8dBgvsPKjzkWCb1mXrHqJVJv3kt2PyPfBNkiJXfh51Ljoz2RGbms7fcX7a8es5ef5SAXC62JJY1` (version 0) |
| `confirm-verbose-failed` | `confirm -v 2AZqR5FDsFrYdmRM87fABg7LP4WVH5KWquVYi1nY5nocAWNr8q2K1tmLJ1iGRGbVMuEgjA9mzfvjKnhj8Fom9mmd` (failed, with logs) |
| `confirm-success` | `confirm` on the legacy signature: prints `Finalized` |
| `confirm-failed` | `confirm` on the failed signature: prints `Transaction failed: ...` |
| `confirm-unknown` | `confirm` on a well-formed signature nobody sent: prints `Not found` |
| `program-show-buffers-none` | `program show --buffers`, no buffer |
| `program-close-buffers-none` | `program close --buffers`, no buffer |
| `*-u-d`, `*-u-url` | the legacy `confirm -v`, `program show --buffers` and `program close --buffers` with `-u d` and `-u https://api.devnet.solana.com` |

An invalid signature prints `Parse error: Bad parameter: Invalid signature` with no RPC call (not recorded as a file).

## One-buffer cases

Recorded with a throwaway Devnet keypair as the Playground wallet (`399rcrEWr3hVAhVy3moRPm5UKy8RmZpAFTZDDu3kksfT`,
public key only) and a 47888-byte program written with the native `solana program write-buffer` as the buffer. Each
`close` case started from a fresh buffer, and each buffer is closed (or, for `show`, was closed after). The `show`
cases all list buffer `Cx3crVAn66xvzQ3jnxgKeunW1RovPUZMUg93HbNCcpVC`; the `close` cases closed
`FYiqAhbb7vi4m77FZJrbjLbt5DoVJEmdjJbNgXkkUNKj`, `8xU7dn2Y4vmRYSD6pmt7PzuZ5RMXhZoMX7UMHtUxdxvy` and
`CERq6buDxQFzhagTjf496LNXbHmeP8JPhd3dpNtH6FkP`.

The table is the header line, then one row per buffer, cells padded with spaces and joined with ` | `, with a leading
and a trailing newline and no ANSI escape. `close --buffers` prints the table of the buffers it closed, after the
close transaction was finalized. Its RPC sequence is `getProgramAccounts`, `getLatestBlockhash`, `sendTransaction`,
then `getSignatureStatuses` until the status is `finalized` (two calls in the recording; the first answered `null`).

| File | Command |
| --- | --- |
| `program-show-buffers-one`, `-u-d`, `-u-url` | `program show --buffers` with one buffer |
| `program-close-buffers-one`, `-u-d`, `-u-url` | `program close --buffers` with one buffer |

The `close` fixtures hold a signed transaction and a blockhash, so a unit test replays the responses rather than
rebuilding the transaction bytes.
