// A machine-wide queue for local e2e runs. Each run starts a CRA dev server
// (~700 MB) and several headless Chromiums; with a few worktrees running at
// once the machine swaps (HOO-2106). A run takes one of a few slot directories
// before it starts its dev server and gives it back when it ends, so only
// `max` runs load the machine at a time and the rest wait their turn.
//
// A run that names no port of its own gets its slot's, `queuePort(slot)`. Two
// runs that each picked the "first free" port by hand picked the same one
// seconds apart, and the later dev server failed to start.
// `playwright.config.mts` is the only caller, and its API is synchronous
// because the config loads synchronously.
//
// A run that dies without releasing leaves its slot behind; the next run
// reclaims it once the owner's pid is gone. If an unrelated process has since
// been given that pid, the slot stays held until that process exits: when a
// run waits on a holder that is not an e2e run, delete its slot directory by
// hand (`~/.cache/solana-playground-e2e/slot-N`).

import fs from "node:fs";
import path from "node:path";

// One run (dev server plus two Chromiums, ~3-4 GB) is what a 24 GB laptop
// already near its memory at idle can spare; two swapped it.
export const DEFAULT_MAX_RUNS = 1;

/** Slot N's port is `QUEUE_BASE_PORT + N`: 139xx belongs to the queue. */
export const QUEUE_BASE_PORT = 13900;

/** @param {number} slot */
export const queuePort = (slot) => QUEUE_BASE_PORT + slot;

/**
 * A slot directory exists a moment before its `owner.json` does. A directory
 * without one is taken for abandoned only once it is older than this, so a run
 * that is writing its owner right now is not robbed of its slot. A reclaim
 * lock older than this belongs to a run that died mid-reclaim.
 */
export const OWNERLESS_SLOT_STALE_MS = 10_000;

const OWNER_FILE = "owner.json";

/**
 * `port` is left out when `portForSlot` picks it.
 *
 * @typedef {{ pid: number, worktree: string, port?: number }} Owner
 * @typedef {{ pid: number, worktree: string, port: number, slot: number,
 *   since: string }} Holder
 * @typedef {{ slot: number, port: number, release: () => void }} Slot
 * @typedef {(slot: number) => number} PortForSlot
 * @typedef {{ kind: "acquired", slot: Slot }
 *   | { kind: "busy", holders: Holder[] }
 *   | { kind: "retry" }} TryResult
 * @typedef {{ kind: "vanished" }
 *   | { kind: "abandoned" }
 *   | { kind: "held", owner: (Owner & { since: string }) | null }} SlotState
 */

const slotPath = (dir, n) => path.join(dir, `slot-${n}`);

// EPERM means the process exists but is not ours to signal: alive. ESRCH is
// the only answer that proves it gone; any other error is not a reason to
// take a slot from someone.
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

/** @returns {(Owner & { since: string }) | null} */
const readOwner = (slotDir) => {
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(slotDir, OWNER_FILE), "utf8")
    );
    return Number.isInteger(owner.pid) ? owner : null;
  } catch {
    // Missing while its run is still writing it, or unreadable: the caller
    // decides by the directory's age, so "no owner" is an answer here.
    return null;
  }
};

const isOlderThan = (dirPath, ms) => {
  try {
    return Date.now() - fs.statSync(dirPath).mtimeMs > ms;
  } catch {
    // Gone since we looked: nothing is left to steal, and the next pass
    // finds the slot free.
    return false;
  }
};

const removeDir = (dirPath) => {
  fs.rmSync(dirPath, { recursive: true, force: true });
};

const makeSlot = (dir, n, owner, portForSlot) => {
  const slotDir = slotPath(dir, n);
  const port = portForSlot ? portForSlot(n) : owner.port;
  if (!Number.isInteger(port)) {
    removeDir(slotDir);
    throw new TypeError("A slot needs owner.port or portForSlot.");
  }
  try {
    fs.writeFileSync(
      path.join(slotDir, OWNER_FILE),
      JSON.stringify({ ...owner, port, since: new Date().toISOString() })
    );
  } catch (error) {
    // A slot without an owner would look taken until it went stale; give it
    // back before reporting why.
    removeDir(slotDir);
    throw error;
  }
  let released = false;
  return {
    slot: n,
    port,
    release() {
      if (released) return;
      released = true;
      // Only our own slot: after a crash and a reclaim the directory may be
      // another run's by now.
      const current = readOwner(slotDir);
      if (current === null || current.pid !== owner.pid) return;
      removeDir(slotDir);
    },
  };
};

// mkdir is atomic: of several runs racing for a slot, one succeeds.
const claimFreeSlot = (dir, n, owner, portForSlot) => {
  try {
    fs.mkdirSync(slotPath(dir, n));
  } catch (error) {
    if (error.code === "EEXIST") return null;
    throw error;
  }
  return makeSlot(dir, n, owner, portForSlot);
};

/** @returns {SlotState} */
const inspectSlot = (slotDir, staleMs) => {
  const held = readOwner(slotDir);
  if (held !== null) {
    return isAlive(held.pid)
      ? { kind: "held", owner: held }
      : { kind: "abandoned" };
  }
  if (!fs.existsSync(slotDir)) return { kind: "vanished" };
  return isOlderThan(slotDir, staleMs)
    ? { kind: "abandoned" }
    : { kind: "held", owner: null };
};

/**
 * Removes an abandoned slot and takes it. Two runs that saw the same dead
 * owner must not both remove and re-make the directory, or the second would
 * delete the first's fresh slot: reclaims of one slot take turns through a
 * lock directory, and the slot is inspected again once the lock is ours.
 *
 * @returns {Slot | null} null when the slot was not ours to take after all
 */
const reclaimSlot = (dir, n, owner, staleMs, portForSlot) => {
  const slotDir = slotPath(dir, n);
  const lockDir = `${slotDir}.reclaim`;
  try {
    fs.mkdirSync(lockDir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (isOlderThan(lockDir, staleMs)) removeDir(lockDir);
    return null;
  }
  try {
    if (inspectSlot(slotDir, staleMs).kind !== "abandoned") return null;
    removeDir(slotDir);
    return claimFreeSlot(dir, n, owner, portForSlot);
  } finally {
    removeDir(lockDir);
  }
};

/**
 * One pass over the slots: takes the first free one, or reports who holds
 * them. `retry` means a slot changed under us (its holder vanished, or
 * another run was reclaiming it); ask again at once.
 *
 * @param {{ dir: string, max: number, owner: Owner, staleMs?: number,
 *   portForSlot?: PortForSlot }} options
 * @returns {TryResult}
 */
export const tryAcquireSlot = ({
  dir,
  max,
  owner,
  staleMs = OWNERLESS_SLOT_STALE_MS,
  portForSlot,
}) => {
  fs.mkdirSync(dir, { recursive: true });
  const holders = [];
  let changing = false;
  for (let n = 1; n <= max; n++) {
    const fresh = claimFreeSlot(dir, n, owner, portForSlot);
    if (fresh !== null) return { kind: "acquired", slot: fresh };
    const state = inspectSlot(slotPath(dir, n), staleMs);
    if (state.kind === "vanished") {
      changing = true;
    } else if (state.kind === "abandoned") {
      const reclaimed = reclaimSlot(dir, n, owner, staleMs, portForSlot);
      if (reclaimed !== null) return { kind: "acquired", slot: reclaimed };
      changing = true;
    } else {
      holders.push({
        slot: n,
        pid: state.owner?.pid ?? 0,
        worktree: state.owner?.worktree ?? "unknown",
        port: state.owner?.port ?? 0,
        since: state.owner?.since ?? "unknown",
      });
    }
  }
  return changing ? { kind: "retry" } : { kind: "busy", holders };
};

const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const RETRY_PAUSE_MS = 20;

/**
 * Takes a slot, blocking until one is free. `onWait` gets the holders once
 * per change of who they are, not on every poll.
 *
 * @param {{ dir: string, max: number, owner: Owner, pollMs?: number,
 *   staleMs?: number, portForSlot?: PortForSlot,
 *   onWait?: (holders: Holder[]) => void }} options
 * @returns {Slot}
 */
export const acquireSlot = ({
  dir,
  max,
  owner,
  pollMs = 2000,
  staleMs,
  portForSlot,
  onWait,
}) => {
  let announced = "";
  for (;;) {
    const result = tryAcquireSlot({ dir, max, owner, staleMs, portForSlot });
    if (result.kind === "acquired") return result.slot;
    if (result.kind === "retry") {
      sleep(RETRY_PAUSE_MS);
      continue;
    }
    const key = result.holders.map((h) => `${h.slot}:${h.pid}`).join(",");
    if (key !== announced) {
      announced = key;
      onWait?.(result.holders);
    }
    sleep(pollMs);
  }
};

/**
 * One line per holder.
 *
 * @param {Holder[]} holders
 * @param {number} max
 */
export const describeHolders = (holders, max) =>
  holders
    .map(
      (h) =>
        `e2e queue: all ${max} run slots are busy; waiting for ${h.worktree} (pid ${h.pid}, port ${h.port}, since ${h.since}) ...`
    )
    .join("\n");
