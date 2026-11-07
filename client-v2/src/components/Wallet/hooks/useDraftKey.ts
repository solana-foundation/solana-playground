import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";

import { PgWallet } from "../../../utils";

const log = createLogger("wallet:draft-key");

/**
 * A key for the account a dialog offers, made in the key page when the dialog
 * opens (`PgWallet.makeKey`, stored at once so its file can be saved before
 * the account exists). When the dialog closes, the key is dropped unless an
 * account took it (`PgWallet.forgetKey`).
 *
 * @returns the key's public key once made, whether making it failed, and the
 * making itself, for a submit that comes before it is done
 */
export const useDraftKey = () => {
  const [publicKey, setPublicKey] = useState<string>();
  const [isFailed, setIsFailed] = useState(false);
  const making = useRef<Promise<string> | undefined>(undefined);

  useEffect(() => {
    let isLive = true;
    // A throw while the wallet is unavailable is a failure like any other
    const made = Promise.resolve().then(() => PgWallet.makeKey());
    making.current = made;
    made.then(
      (key) => {
        if (isLive) setPublicKey(key);
      },
      (error: unknown) => {
        log.error(error, { report: true });
        if (isLive) setIsFailed(true);
      }
    );
    return () => {
      isLive = false;
      // Swallowed: the failure was logged above, and `forgetKey` reports its own
      made.then(
        (key) => PgWallet.forgetKey(key),
        () => {}
      );
    };
  }, []);

  const made = useCallback(() => {
    if (!making.current) throw new Error("The new account's key is not made");
    return making.current;
  }, []);

  return { publicKey, isFailed, made };
};
