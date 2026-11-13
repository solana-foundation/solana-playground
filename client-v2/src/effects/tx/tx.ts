import { isTxLinkedBySender } from "@/shared/lib/tx-links";

import { PgCodec, PgSettings, PgTx, PgView, PgWeb3 } from "../../utils";
import { ExplorerLink } from "./ExplorerLink";

// After a transaction is sent, toast "Transaction sent" with its signature
// linked to the block explorer picked in Settings.
export const tx = () => {
  return PgTx.onDidSend((sentTx) => {
    // Check setting
    if (!PgSettings.notification.showTx) return;

    // Don't repeat a link its sender shows (a tutorial card)
    if (isTxLinkedBySender()) return;

    // If a tx includes an BPF Upgradeable Loader program ix, only allow the
    // final deploy/upgrade ixs to not spam
    const hasNonFinalBpfLoaderIx = sentTx.instructions.some(
      (ix) =>
        ix.programId.equals(PgWeb3.BpfLoaderUpgradeableProgram.programId) &&
        !(
          PgWeb3.BpfLoaderUpgradeableProgram.isDeployWithMaxProgramLenInstruction(
            ix.data
          ) || PgWeb3.BpfLoaderUpgradeableProgram.isUpgradeInstruction(ix.data)
        )
    );
    if (hasNonFinalBpfLoaderIx) return;

    // Sanity check for signature
    if (!sentTx.signature) return;

    const txHash = PgCodec.encodeBinary(sentTx.signature, "base58");
    PgView.setToast(ExplorerLink, {
      componentProps: { txHash },
      options: { name: "tx-explorer-link", id: txHash },
    });
  });
};
