import type { Cluster, Clusters } from "@/entities/cluster";
import {
  CLUSTERS,
  fetchClusterByGenesisHash,
  getConnectionFor,
  getKnownCluster,
  getReadBufferConnectionFor,
  PgSelectedConnection,
} from "@/entities/cluster";
import { recheckWhileBad } from "@/shared/lib/backoff-recheck";
import { createLogger } from "@/shared/lib/logger";

import { askAgain, hasAnsweredAgain, onAskAgain } from "./ask-again";
import { PgCommon } from "./common";
import {
  createDerivable,
  declareDecorator,
  derivable,
  initable,
} from "./decorators";
import { OverridableConnection, PgPlaynet } from "./playnet";
import { PgSettings } from "./settings";
import type { Disposable } from "./types";
import { PgWeb3 } from "./web3";

export type { Cluster } from "@/entities/cluster";

const derive = () => ({
  /** Globally sycned connection instance */
  current: createDerivable({
    // It's important that this method returns immediately because connection
    // instance is used throughout the app. For this reason, the connection for
    // Playnet will be returned without awaiting the initialization. After the
    // initialization, `PgPlaynet.onDidInit` will be triggered and this method
    // will run again to return the overridden connection instance.
    derive: () => {
      // Check whether the endpoint is Playnet
      if (PgPlaynet.isUrlPlaynet()) {
        // Return the connection instance if it has been overridden
        if (PgPlaynet.connection?.overridden) return PgPlaynet.connection;

        // Initialize Playnet
        PgPlaynet.init();
      } else {
        // Destroy Playnet
        PgPlaynet.destroy();
      }

      return getConnectionFor(PgSettings.connection.commitment)(
        PgSettings.connection.endpoint
      );
    },
    onChange: [
      PgSettings.onDidChangeConnectionEndpoint,
      PgSettings.onDidChangeConnectionCommitment,
      PgPlaynet.onDidInit,
    ],
    infallible: true,
  }),

  /** Whether there is a successful connection */
  isConnected: createDerivable({
    derive: _PgConnection.getIsConnected,
    onChange: [
      onAskAgain,
      (cb) => {
        // Asked again when the connection is replaced, which is when Playnet's
        // becomes ready. Kept apart from `disposables`, whose entries after the
        // first are replaced on every cluster change.
        const currentChange = PgConnection.onDidChangeCurrent(() => cb());

        const disposables: Disposable[] = [];
        disposables.push(
          PgConnection.onDidChangeCluster((cluster) => {
            // Dispose and remove old disposables
            for (const i of Object.keys(disposables)) {
              if (+i) disposables.pop()!.dispose();
            }

            // Refresh intervals
            const successInterval = cluster === "localnet" ? 5000 : 60000;
            const errorInterval = cluster === "localnet" ? 5000 : 10000;

            // Only run the `cb` when the value actually changes. This is
            // because the decorators such as `derivable` and `updatable`
            // trigger a change event each time the value is set independent
            // of whether the value has changed unlike React which only
            // re-renders when the memory location of the value changes. The
            // polls compare against the derived value itself, not a copy of
            // their own, so a value a user's "Try again" (`onAskAgain`)
            // derived in between is the one they compare with.
            //
            // TODO: Allow specifying whether the value should be compared with the
            // previous value and trigger the change event **only if** there is a
            // difference in comparison.

            // Initial run
            cb();

            const successId = setInterval(async () => {
              if (!PgConnection.isConnected) return;
              if (!(await PgConnection.getIsConnected())) cb();
            }, successInterval);
            disposables.push({ dispose: () => clearInterval(successId) });

            const errorId = setInterval(async () => {
              if (PgConnection.isConnected) return;
              if (await PgConnection.getIsConnected()) cb();
            }, errorInterval);
            disposables.push({ dispose: () => clearInterval(errorId) });
          })
        );

        return {
          dispose: () => {
            currentChange.dispose();
            disposables.forEach(({ dispose }) => dispose());
          },
        };
      },
    ],
    infallible: true,
  }),

  /** Current cluster name based on the current endpoint */
  cluster: createDerivable({
    derive: () => _PgConnection.readCluster(),
    // A "Try again" re-reads a cluster whose read failed, as the airdrop's
    // retry does
    onChange: [PgSettings.onDidChangeConnectionEndpoint, onAskAgain],
  }),

  /** Whether the cluster is down. `null` indicates potential connection error. */
  isClusterDown: createDerivable({
    derive: _PgConnection.getIsClusterDown,
    onChange: ["cluster", (cb) => recheckWhileStalled(cb), onAskAgain],
    infallible: true,
  }),
});

/**
 * A stalled slot is read again until it moves, so the cluster's dot turns
 * green when the cluster recovers, not only on a cluster change. Never while
 * the tab is hidden: an idle tab must not keep asking a public endpoint.
 */
const recheckWhileStalled = (cb: () => void): Disposable =>
  recheckWhileBad({
    recheck: cb,
    // `null` (the slot could not be read) is not a stall: that is a
    // connection error, which `isConnected` polls on its own
    onDidChange: (listener) =>
      PgConnection.onDidChangeIsClusterDown((stalled) =>
        listener(stalled === true)
      ),
    minMs: 5000,
    maxMs: 60000,
  });

const log = createLogger("connection:cluster");

/**
 * The cluster of `connection`: known from its endpoint, or, for the selected
 * custom endpoint, the one `readCluster` resolved from its genesis hash, once
 * it is no longer the previous endpoint's.
 */
const getClusterOf = (connection: PgWeb3.Connection): Cluster | undefined =>
  getKnownCluster(connection.rpcEndpoint) ??
  (connection.rpcEndpoint === PgSettings.connection.endpoint &&
  !PgConnection.clusterIsStale
    ? PgConnection.cluster ?? undefined
    : undefined);

/** The send cap of `connection`'s cluster; `undefined` for a cluster with none or a cluster not known */
const sendTxPerSecondWith =
  (clusters: Clusters) => (connection: PgWeb3.Connection) => {
    const cluster = getClusterOf(connection);
    return cluster && clusters[cluster].sendTxPerSecond;
  };

const getSendTxPerSecond = sendTxPerSecondWith(CLUSTERS);

/** The derivables stay the source; the slice's store mirrors them for its hook */
const mirrorToStore = () =>
  PgConnection.onDidChange(() =>
    PgSelectedConnection.set({
      connection: PgConnection.current,
      cluster: PgConnection.cluster,
      isConnected: PgConnection.isConnected,
      isClusterDown: PgConnection.isClusterDown,
    })
  );

@derivable(derive)
@initable({ onDidInit: mirrorToStore })
class _PgConnection {
  /**
   * The connection program buffer accounts are read through: the read-buffer
   * RPC the env configures for `connection`'s cluster, else `connection`
   * itself. Sends and every other read stay on `connection`.
   */
  static getReadBufferConnection(connection: PgWeb3.Connection) {
    return getReadBufferConnectionFor(getClusterOf(connection))(connection);
  }

  /**
   * The `sendTransaction` calls per second the env allows on `connection`'s
   * cluster, or `undefined` when the env sets no cap there.
   */
  static getSendTxPerSecond(connection: PgWeb3.Connection) {
    return getSendTxPerSecond(connection);
  }

  /**
   * Get whether the connection is ready to be used.
   *
   * If the endpoint is `Endpoint.PLAYNET` this will return `false` until the
   * connection gets overridden. This helps avoid sending unnecessary RPC requests
   * at start before the `connection` and `fetch` is overridden.
   *
   * This will always return `true` if the endpoint is not `Endpoint.PLAYNET`.
   *
   * @param conn overridable web3.js `Connection`
   * @returns whether the connection is ready to be used
   */
  static isReady(conn: OverridableConnection) {
    if (PgPlaynet.isUrlPlaynet(conn.rpcEndpoint)) {
      return conn.overridden;
    }

    return true;
  }

  /**
   * Get whether there is a successful connection to the current endpoint.
   *
   * Playnet's connection answers only once Playnet has started in the page
   * (`isReady`); asking before that would read as not connected.
   *
   * @returns whether there is a successful connection, or `null` while the
   * connection is not ready to be asked
   */
  static async getIsConnected(): Promise<boolean | null> {
    if (!_PgConnection.isReady(PgConnection.current)) return null;

    try {
      await PgConnection.current.getSlot();
      return true;
    } catch {
      return false;
    }
  }

  /** The endpoint `cluster` was last read from */
  private static _clusterEndpoint: string | undefined;

  /**
   * Whether `cluster` still names the previous endpoint's network: a custom
   * RPC takes a genesis-hash round trip to read. Anything spending a faucet on
   * that name waits, as a Localnet name would ask a public RPC for 100 SOL.
   */
  static get clusterIsStale() {
    return _PgConnection._clusterEndpoint !== PgSettings.connection.endpoint;
  }

  /** The endpoint whose last cluster read failed, until a read of it succeeds */
  private static _clusterFailedEndpoint: string | undefined;

  /**
   * Whether the selected endpoint's cluster read failed: a custom RPC that is
   * down, or one whose genesis hash names no known cluster. `clusterIsStale`
   * stays true for it, so this is what tells a wait that will never end from
   * one that will.
   */
  static get hasClusterReadFailed() {
    return (
      _PgConnection._clusterFailedEndpoint === PgSettings.connection.endpoint
    );
  }

  /**
   * Read the selected endpoint's cluster, remembering which endpoint it was.
   *
   * @returns the cluster name
   */
  static async readCluster(): Promise<Cluster> {
    const endpoint = PgSettings.connection.endpoint;
    // A read of an endpoint no longer selected may finish last, and what it
    // returns is what `cluster` keeps: it answers for the selected one instead
    const hasEndpointChanged = () =>
      endpoint !== PgSettings.connection.endpoint;
    let cluster: Cluster;
    try {
      cluster = await _PgConnection.getCluster(endpoint);
    } catch (e) {
      if (!hasEndpointChanged()) {
        // The derivable that calls this swallows the throw; without this line
        // a custom RPC that is down leaves no trace while `clusterIsStale`
        // stays true for it
        log.warn("could not read the selected endpoint's cluster", {
          context: { error: String(e) },
        });
        _PgConnection._clusterFailedEndpoint = endpoint;
        throw e;
      }
      log.info(
        "a previous endpoint's cluster read failed, reading the current",
        {
          context: { error: String(e) },
        }
      );
      return _PgConnection.readCluster();
    }
    if (hasEndpointChanged()) return _PgConnection.readCluster();
    _PgConnection._clusterEndpoint = endpoint;
    _PgConnection._clusterFailedEndpoint = undefined;
    return cluster;
  }

  /**
   * Get the cluster name from the given `endpoint`.
   *
   * @param endpoint RPC endpoint
   * @returns the cluster name
   */
  static async getCluster(
    endpoint: string = PgConnection.current.rpcEndpoint
  ): Promise<Cluster> {
    return getKnownCluster(endpoint) ?? fetchClusterByGenesisHash(endpoint);
  }

  /**
   * Get whether the current cluster is down by comparing the latest slot
   * numbers between a certain time period.
   *
   * @returns whether the current cluster is down
   */
  static async getIsClusterDown() {
    let prevSlot: number;
    try {
      prevSlot = await PgConnection.current.getSlot();
    } catch {
      return null;
    }

    // Sleep to give time for the RPC to advance slots
    await PgCommon.sleep(1000);

    let nextSlot: number;
    try {
      nextSlot = await PgConnection.current.getSlot();
    } catch {
      return null;
    }

    return prevSlot === nextSlot;
  }

  /**
   * Asks the cluster again now, for a user's "Try again" (Spec 08 NET-02):
   * whether it answers and whether its slot moves are derived afresh
   * (`askAgain`), and their change events fire as on any poll. The derivables
   * do not hand back their results, so the same two readings are taken here
   * too and awaited, which keeps the button busy for as long as the slower
   * one, the stall check, takes.
   *
   * @returns whether the cluster answered and its slot is not stalled
   * (`hasAnsweredAgain`)
   */
  static async recheck(): Promise<boolean> {
    askAgain();
    const [connected, stalled] = await Promise.all([
      _PgConnection.getIsConnected(),
      _PgConnection.getIsClusterDown(),
    ]);
    return hasAnsweredAgain(connected, stalled);
  }

  /**
   * Get the airdrop amount based on the current cluster.
   *
   * @returns airdrop amount in SOL
   */
  static getAirdropAmount() {
    return _PgConnection.getAirdropAmountOn(PgConnection.cluster);
  }

  /** {@link getAirdropAmount} on `cluster`, read by the caller */
  static getAirdropAmountOn(cluster: Cluster | null) {
    switch (cluster) {
      case "playnet":
        return 1000;
      case "localnet":
        return 100;
      case "devnet":
        return 5;
      case "testnet":
        return 1;
      default:
        return null;
    }
  }
}

export const PgConnection = declareDecorator(_PgConnection, {
  derivable: derive,
});
