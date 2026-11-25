import { useEffect, useReducer } from "react";

import { useSignedIn } from "@/features/auth";

import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { AiOffReason } from "./ai-off";
import { aiOff } from "./ai-off";
import { useDefaultBackend } from "./default-backend";

/**
 * Why no model can answer this user, or `undefined` while one can or that is
 * not known yet: the composer's off row, read from outside the panel (Home's
 * ask box says it before a send)
 */
export const useAiOffReason = (): AiOffReason | undefined => {
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgAssistant.onDidChange(render).dispose, []);
  const backend = useDefaultBackend();
  const signedIn = useSignedIn();
  return aiOff({ connected: PgAssistant.connection?.id, backend, signedIn });
};
