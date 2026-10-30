import { shortAddress } from "@/shared/lib/short-address";
import type { PgWeb3 } from "../../utils";

/**
 * What an import says: an added keypair in Spec 12's words. `PgWallet.add`
 * switches to an account that already holds the keypair instead of adding
 * it, which would otherwise look like nothing happened; that line is ours,
 * since Spec 12 has none.
 *
 * @param imported what `PgWallet.import` resolved with
 * @param name the current wallet's name after the import
 */
export const importedText = (
  imported: { keypair: PgWeb3.Keypair; added: boolean },
  name: string
): string =>
  imported.added
    ? `Imported ${shortAddress(
        imported.keypair.publicKey.toBase58()
      )} as ${name}.`
    : `${name} already holds that keypair, so it is now the current wallet.`;
