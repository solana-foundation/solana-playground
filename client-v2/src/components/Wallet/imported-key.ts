import { PgWallet } from "../../utils";
import { importedText } from "./imported-text";

/**
 * Adds the account of a key the key page's import panel stored, and says what
 * that did (`importedText`). A key no account took is dropped again.
 *
 * @param publicKey the stored key's public key
 * @returns what the import says
 * @throws what `PgWallet.add` throws, such as while the wallet is unavailable
 */
export const addImportedKey = (publicKey: string) => {
  try {
    const added = PgWallet.add({ publicKey });
    const { name } = PgWallet.accounts[PgWallet.currentIndex];
    return importedText({ publicKey, added }, name);
  } catch (error) {
    void PgWallet.forgetKey(publicKey);
    throw error;
  }
};
