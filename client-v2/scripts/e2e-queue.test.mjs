import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { acquireSlot, describeHolders, tryAcquireSlot } from "./e2e-queue.mjs";

const MODULE_URL = pathToFileURL(
  path.join(import.meta.dirname, "e2e-queue.mjs")
).href;

const tempDir = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-queue-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const owner = (port) => ({ pid: process.pid, worktree: "/wt/mine", port });

const writeOwner = (dir, slot, pid) => {
  const slotDir = path.join(dir, `slot-${slot}`);
  fs.mkdirSync(slotDir, { recursive: true });
  fs.writeFileSync(
    path.join(slotDir, "owner.json"),
    JSON.stringify({
      pid,
      worktree: "/wt/other",
      port: 13010,
      since: "2026-10-15T00:00:00.000Z",
    })
  );
  return slotDir;
};

/** A pid that existed a moment ago and is gone now. */
const deadPid = () => {
  const result = spawnSync(process.execPath, [
    "-e",
    "process.stdout.write(String(process.pid))",
  ]);
  return Number(result.stdout.toString());
};

/**
 * A child that takes a slot, says so, holds it for `holdMs`, then releases.
 * Acquiring blocks the parent's event loop, so a release timer in the parent
 * could never fire; the holder has to be another process.
 */
const holdInChild = async (dir, holdMs) => {
  const code = `
    import { acquireSlot } from ${JSON.stringify(MODULE_URL)};
    const slot = acquireSlot({ dir: ${JSON.stringify(dir)}, max: 2, owner: { pid: process.pid, worktree: "/wt/child", port: 13020 } });
    process.stdout.write("held\\n");
    setTimeout(() => { slot.release(); process.exit(0); }, ${holdMs});
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", () =>
      reject(new Error("holder exited before taking a slot"))
    );
  });
  return child;
};

test("acquires slot 1, then slot 2", (t) => {
  const dir = tempDir(t);
  const first = acquireSlot({ dir, max: 2, owner: owner(1) });
  const second = acquireSlot({ dir, max: 2, owner: owner(2) });
  assert.equal(first.slot, 1);
  assert.equal(second.slot, 2);
  const written = JSON.parse(
    fs.readFileSync(path.join(dir, "slot-1", "owner.json"), "utf8")
  );
  assert.equal(written.pid, process.pid);
  assert.equal(written.worktree, "/wt/mine");
  assert.equal(written.port, 1);
  assert.ok(!Number.isNaN(Date.parse(written.since)));
});

test("a third run waits while live runs hold both slots, then takes the freed one", async (t) => {
  const dir = tempDir(t);
  // The parent's own pid is alive, so slot 2 never reads as stale.
  writeOwner(dir, 2, process.pid);
  const child = await holdInChild(dir, 700);
  const waits = [];
  const slot = acquireSlot({
    dir,
    max: 2,
    owner: owner(3),
    pollMs: 50,
    onWait: (holders) => waits.push(holders),
  });
  assert.equal(slot.slot, 1);
  assert.equal(waits.length, 1, "onWait fires once per change of holders");
  assert.deepEqual(
    waits[0].map((h) => h.pid).sort(),
    [child.pid, process.pid].sort()
  );
  await new Promise((resolve) => child.once("exit", resolve));
});

test("reclaims a slot whose owner is gone", (t) => {
  const dir = tempDir(t);
  writeOwner(dir, 1, deadPid());
  const slot = acquireSlot({ dir, max: 1, owner: owner(1) });
  assert.equal(slot.slot, 1);
});

test("a slot without owner.json is not stolen while young, and is once old", (t) => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, "slot-1"), { recursive: true });
  assert.equal(tryAcquireSlot({ dir, max: 1, owner: owner(1) }).kind, "busy");
  const old = new Date(Date.now() - 20_000);
  fs.utimesSync(path.join(dir, "slot-1"), old, old);
  const result = tryAcquireSlot({ dir, max: 1, owner: owner(1) });
  assert.equal(result.kind, "acquired");
  assert.equal(result.slot.slot, 1);
});

test("release removes our slot once and never throws", (t) => {
  const dir = tempDir(t);
  const slot = acquireSlot({ dir, max: 1, owner: owner(1) });
  slot.release();
  assert.ok(!fs.existsSync(path.join(dir, "slot-1")));
  assert.doesNotThrow(() => slot.release());
});

test("release leaves a slot that another run has taken", (t) => {
  const dir = tempDir(t);
  const slot = acquireSlot({ dir, max: 1, owner: owner(1) });
  writeOwner(dir, 1, process.pid + 1);
  slot.release();
  assert.ok(fs.existsSync(path.join(dir, "slot-1", "owner.json")));
});

test("a slot whose owner.json cannot be written is not left behind", (t) => {
  const dir = tempDir(t);
  // A BigInt port makes JSON.stringify throw while the slot is being written.
  const broken = { pid: process.pid, worktree: "/wt/mine", port: 1n };
  assert.throws(() => acquireSlot({ dir, max: 1, owner: broken }), TypeError);
  assert.ok(!fs.existsSync(path.join(dir, "slot-1")));
  assert.equal(acquireSlot({ dir, max: 1, owner: owner(1) }).slot, 1);
});

/** A child that makes one pass once `goFile` exists, prints the result, and stays alive until stdin closes. */
const raceInChild = (dir, goFile) => {
  const code = `
    import fs from "node:fs";
    import { tryAcquireSlot } from ${JSON.stringify(MODULE_URL)};
    while (!fs.existsSync(${JSON.stringify(goFile)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
    const result = tryAcquireSlot({ dir: ${JSON.stringify(dir)}, max: 1, owner: { pid: process.pid, worktree: "/wt/racer", port: 1 } });
    process.stdout.write(result.kind + "\\n");
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const kind = new Promise((resolve) =>
    child.stdout.once("data", (chunk) => resolve(chunk.toString().trim()))
  );
  return { child, kind };
};

test("two runs racing to reclaim one dead slot: exactly one gets it", async (t) => {
  for (let round = 0; round < 5; round++) {
    const dir = tempDir(t);
    writeOwner(dir, 1, deadPid());
    const goFile = path.join(dir, "go");
    const racers = [raceInChild(dir, goFile), raceInChild(dir, goFile)];
    // Let both children finish loading before the starting gun.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(goFile, "");
    const kinds = await Promise.all(racers.map((r) => r.kind));
    racers.forEach((r) => r.child.stdin.end());
    assert.equal(kinds.filter((k) => k === "acquired").length, 1, kinds.join());
    await Promise.all(
      racers.map((r) => new Promise((resolve) => r.child.once("exit", resolve)))
    );
  }
});

test("describeHolders names worktree, pid and port, one line per holder", () => {
  const text = describeHolders(
    [
      {
        slot: 1,
        pid: 111,
        worktree: "/wt/a",
        port: 13010,
        since: "2026-10-15T01:00:00.000Z",
      },
      {
        slot: 2,
        pid: 222,
        worktree: "/wt/b",
        port: 13020,
        since: "2026-10-15T02:00:00.000Z",
      },
    ],
    2
  );
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(
    lines[0],
    /all 2 run slots are busy; waiting for \/wt\/a \(pid 111, port 13010, since 2026-10-15T01:00:00.000Z\)/
  );
  assert.match(lines[1], /\/wt\/b \(pid 222, port 13020/);
});
