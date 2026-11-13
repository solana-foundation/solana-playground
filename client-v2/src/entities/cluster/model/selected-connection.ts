import type { Connection } from "@solana/web3.js";
import { useSyncExternalStore } from "react";

import type { Cluster } from "./clusters";

/** The selected connection and what is known of it; every field is `undefined` until first derived */
export interface SelectedConnectionState {
  connection: Connection | undefined;
  /** `null` when the endpoint's cluster could not be read */
  cluster: Cluster | null | undefined;
  isConnected: boolean | undefined;
  /** Whether the slot stopped moving; `null` when it could not be read */
  isClusterDown: boolean | null | undefined;
}

const FIELDS: ReadonlyArray<keyof SelectedConnectionState> = [
  "connection",
  "cluster",
  "isConnected",
  "isClusterDown",
];

let state: SelectedConnectionState = {
  connection: undefined,
  cluster: undefined,
  isConnected: undefined,
  isClusterDown: undefined,
};

const listeners = new Set<() => void>();

/** The store of the selected connection, its cluster and its health */
export const PgSelectedConnection = {
  get: (): SelectedConnectionState => state,

  /** Replaces the state and tells the listeners, unless no field changed */
  set: (next: SelectedConnectionState) => {
    if (FIELDS.every((field) => next[field] === state[field])) return;
    state = next;
    for (const listener of listeners) listener();
  },

  /** @returns the function that unsubscribes `listener` */
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The selected connection, its cluster and its health, re-rendering on a change */
export const useSelectedConnection = (): SelectedConnectionState =>
  useSyncExternalStore(
    PgSelectedConnection.subscribe,
    PgSelectedConnection.get
  );

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("entities/cluster/model/selected-connection", () => {
    it("tells its listeners only when a field changes", () => {
      const listener = vi.fn();
      const unsubscribe = PgSelectedConnection.subscribe(listener);
      const next: SelectedConnectionState = {
        connection: undefined,
        cluster: "devnet",
        isConnected: true,
        isClusterDown: false,
      };

      PgSelectedConnection.set(next);
      PgSelectedConnection.set({
        connection: next.connection,
        cluster: next.cluster,
        isConnected: next.isConnected,
        isClusterDown: next.isClusterDown,
      });
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(PgSelectedConnection.get()).toBe(next);
    });
  });
}
