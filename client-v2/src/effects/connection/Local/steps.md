**1. Install Solana toolchain (<OS_NAME>):**

<OS_INSTALLATION>

[Other installation methods](https://docs.solana.com/cli/install-solana-cli-tools)

**2. Start a local test validator:**

```sh
solana-test-validator --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g
```

Playground's build server makes programs the newest validators refuse by default; this flag lets them deploy.

If you started a validator before, add `--reset` once, so the flag takes effect on a fresh ledger.
