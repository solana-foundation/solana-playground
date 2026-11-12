import { PgWallet } from "../../utils";
import { importedText } from "./imported-text";

/**
 * Adds the account of a key the key page held before this import, and says
 * what that did (`importedText`). The key stays stored if no account takes it.
 *
 * @param publicKey the stored key's public key
 * @returns what the import says
 * @throws what `PgWallet.add` throws, such as while the wallet is unavailable
 */
export const addExistingImportedKey = (publicKey: string) => {
  const added = PgWallet.add({ publicKey });
  const { name } = PgWallet.accounts[PgWallet.currentIndex];
  return importedText({ publicKey, added }, name);
};

/**
 * Adds the account of a key this import stored newly on the key page, and
 * says what that did. If no account takes it, the key is dropped again, so a
 * failed import leaves no key behind.
 *
 * @param publicKey the stored key's public key
 * @returns what the import says
 * @throws what `PgWallet.add` throws, after the key is dropped
 */
export const addNewImportedKey = (publicKey: string) => {
  try {
    return addExistingImportedKey(publicKey);
  } catch (error) {
    void PgWallet.forgetKey(publicKey);
    throw error;
  }
};
