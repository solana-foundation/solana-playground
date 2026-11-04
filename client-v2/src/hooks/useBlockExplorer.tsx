import { PgBlockExplorer } from "../utils";
import { useRenderOnChange } from "./useRenderOnChange";

/** Get the current block explorer */
export const useBlockExplorer = () => {
  return useRenderOnChange(PgBlockExplorer.onDidChangeCurrent);
};
