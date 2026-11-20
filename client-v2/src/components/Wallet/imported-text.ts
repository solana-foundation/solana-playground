import { shortAddress } from "@/shared/lib/short-address";

/**
 * What an import says: an added keypair in Spec 12's words. `PgWallet.add`
 * switches to an account that already holds the keypair instead of adding
 * it, which would otherwise look like nothing happened; that line is ours,
 * since Spec 12 has none.
 *
 * @param imported the imported key's public key (base58), and whether it was
 * added (`false`: the wallet already held it and switched to it)
 * @param name the current wallet's name after the import
 */
export const importedText = (
  imported: { publicKey: string; added: boolean },
  name: string
): string =>
  imported.added
    ? `Imported ${shortAddress(imported.publicKey)} as ${name}.`
    : `${name} already holds that keypair, so it is now the current wallet.`;
