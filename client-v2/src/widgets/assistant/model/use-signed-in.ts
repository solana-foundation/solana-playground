import { useEffect, useReducer, useState } from "react";

import { PgSession } from "@/features/auth";

/**
 * Whether someone is signed in, or `undefined` until the page's session read has
 * answered: a signed-in user must not see "Sign in" flash on load. It waits
 * for the page's read and never starts one (`afterFirstRead`, not
 * `whenRead`).
 */
export const useSignedIn = (): boolean | undefined => {
  const [read, setRead] = useState(false);
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let live = true;
    void PgSession.afterFirstRead().then(() => {
      if (live) setRead(true);
    });
    const session = PgSession.onDidChange(render);
    return () => {
      live = false;
      session.dispose();
    };
  }, []);
  return read ? !!PgSession.get() : undefined;
};
