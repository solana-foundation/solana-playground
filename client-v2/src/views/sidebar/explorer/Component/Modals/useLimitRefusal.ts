import { useCallback, useState } from "react";

import { SubmitCancelled } from "@/widgets/overlays";

import { ExplorerLimitError } from "../../../../../utils";

/**
 * A dialog submit that keeps the dialog open on a limit refusal and hands
 * back its message, which the dialog shows in a `FieldError` with
 * `data-testid="explorer-limit-error"`. Turned into `SubmitCancelled` so
 * `ModalFrame` neither repeats the message nor reports it: the user was told
 * what to change, and nothing went wrong.
 */
export const useLimitRefusal = () => {
  const [limitError, setLimitError] = useState("");

  const guard = useCallback(
    <T>(run: () => Promise<T>) =>
      async () => {
        setLimitError("");
        try {
          return await run();
        } catch (e) {
          if (e instanceof ExplorerLimitError) {
            setLimitError(e.message);
            throw new SubmitCancelled();
          }
          throw e;
        }
      },
    []
  );

  return { limitError, guard };
};
