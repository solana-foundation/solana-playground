import { PgWallet } from "../../utils";
import { importedText } from "./imported-text";

/**
 * Adds the account of a key the key page's import panel stored, and says what
 * that did (`importedText`). A key this import stored newly and no account
 * took is dropped again; one the key page held before stays.
 *
 * @param publicKey the stored key's public key
 * @param isNew whether this import stored it, the key page not holding it before
 * @returns what the import says
 * @throws what `PgWallet.add` throws, such as while the wallet is unavailable
 */
export const addImportedKey = (publicKey: string, isNew: boolean) => {
  try {
    const added = PgWallet.add({ publicKey });
    const { name } = PgWallet.accounts[PgWallet.currentIndex];
    return importedText({ publicKey, added }, name);
  } catch (error) {
    if (isNew) void PgWallet.forgetKey(publicKey);
    throw error;
  }
};
