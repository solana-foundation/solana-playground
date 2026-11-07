# Sysvar Accounts

[Sysvar accounts](https://github.com/anza-xyz/agave/blob/v3.1.8/program-runtime/src/sysvar_cache.rs#L31)
are special accounts at predefined addresses that provide read-only access to
cluster state data. They update dynamically each slot.

| Sysvar | Address | Purpose |
| --- | --- | --- |
| [Clock](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2064) | `SysvarC1ock11111111111111111111111111111111` | Current slot, epoch, and Unix timestamp |
| [EpochSchedule](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2264) | `SysvarEpochSchedu1e111111111111111111111111` | Epoch scheduling constants set in genesis |
| [EpochRewards](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank/partitioned_epoch_rewards/sysvar.rs#L24) | `SysvarEpochRewards1111111111111111111111111` | Epoch rewards distribution status and progress |
| [Rent](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2255) | `SysvarRent111111111111111111111111111111111` | Rental rate and exemption threshold |
| [SlotHashes](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2196) | `SysvarS1otHashes111111111111111111111111111` | Most recent hashes of the slot's parent banks |
| [StakeHistory](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2273) | `SysvarStakeHistory1111111111111111111111111` | Stake activations and deactivations per epoch |
| [LastRestartSlot](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2123) | `SysvarLastRestartS1ot1111111111111111111111` | Last cluster restart slot |
| [Instructions](https://github.com/anza-xyz/agave/blob/v3.1.8/svm/src/account_loader.rs#L736) | `Sysvar1nstructions1111111111111111111111111` | Serialized instructions of the current transaction |
| [SlotHistory](https://github.com/anza-xyz/agave/blob/v3.1.8/runtime/src/bank.rs#L2182) | `SysvarS1otHistory11111111111111111111111111` | Record of which slots were produced over the last epoch |

The following example fetches and deserializes the Sysvar Clock account.

**Kit**

```ts
import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { generatedPayer } from "@solana/kit-plugin-signer";
import { fetchSysvarClock, SYSVAR_CLOCK_ADDRESS } from "@solana/sysvars";

const client = await createClient()
  .use(generatedPayer())
  .use(
    solanaRpc({
      rpcUrl: "https://api.mainnet.solana.com"
    })
  );

const accountInfo = await client.rpc
  .getAccountInfo(SYSVAR_CLOCK_ADDRESS, { encoding: "base64" })
  .send();
console.log(accountInfo);

// Automatically fetch and deserialize the account data
const clock = await fetchSysvarClock(client.rpc);
console.log(clock);
```

**Rust**

```rust
use anyhow::Result;
use bincode::deserialize;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_sdk::sysvar::{self, clock::Clock};

#[tokio::main]
async fn main() -> Result<()> {
    let connection = RpcClient::new_with_commitment(
        "https://api.mainnet.solana.com".to_string(),
        CommitmentConfig::confirmed(),
    );

    let account = connection.get_account(&sysvar::clock::ID).await?;
    // Deserialize the account data
    let clock: Clock = deserialize(&account.data)?;

    println!("{:#?}", account);
    println!("{:#?}", clock);

    Ok(())
}
```
