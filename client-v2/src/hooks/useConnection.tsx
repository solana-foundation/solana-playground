import { useSelectedConnection } from "@/entities/cluster";

import { PgConnection } from "../utils";

/** Get access to the globally synced `Connection` object. */
export const useConnection = () =>
  // Falls back to the derived value until the store has mirrored it
  useSelectedConnection().connection ?? PgConnection.current;
