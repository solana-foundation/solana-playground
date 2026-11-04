import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertLive, selectTarget } from "./resolve-target.mjs";

const SCRIPT = fileURLToPath(new URL("./resolve-target.mjs", import.meta.url));

const version = (id, day, split = 0, servingStatus = "SERVING") => ({
  id,
  traffic_split: split,
  version: {
    servingStatus,
    createTime: `2026-11-0${day}T10:00:00Z`,
  },
});

const LIVE_B = [version("a", 1), version("b", 2, 1), version("c", 3)];

test("a named serving version becomes the target", () => {
  assert.deepEqual(selectTarget(LIVE_B, "a"), {
    current: "b",
    target: "a",
    changed: true,
  });
});

test("a version written as its tag is read as its label", () => {
  const list = [version("1-2-3", 1), version("1-2-4", 2, 1)];
  assert.equal(selectTarget(list, "1.2.3").target, "1-2-3");
});

test("the live version named again changes nothing", () => {
  assert.deepEqual(selectTarget(LIVE_B, "b"), {
    current: "b",
    target: "b",
    changed: false,
  });
});

test("a named target is promoted out of split traffic, with no current", () => {
  const split = [version("a", 1, 0.5), version("b", 2, 0.5)];
  assert.deepEqual(selectTarget(split, "a"), {
    current: null,
    target: "a",
    changed: true,
  });
});

test("an unknown version is refused, naming it and the existing ones", () => {
  assert.throws(() => selectTarget(LIVE_B, "z"), /"z".*a, b, c/);
});

test("a stopped version is refused", () => {
  const list = [version("a", 1, 0, "STOPPED"), version("b", 2, 1)];
  assert.throws(() => selectTarget(list, "a"), /"a" is STOPPED/);
});

for (const bad of ["A-1", "a b", "a;rm", "$(x)", "-a"]) {
  test(`malformed version ${JSON.stringify(bad)} is refused`, () => {
    assert.throws(() => selectTarget(LIVE_B, bad), /Malformed version/);
  });
}

for (const [name, broken] of [
  ["its id", { id: undefined }],
  ["its traffic split", { traffic_split: undefined }],
  ["its status", { version: { createTime: "2026-11-01T10:00:00Z" } }],
  ["its creation time", { version: { servingStatus: "SERVING" } }],
  [
    "a readable creation time",
    { version: { servingStatus: "SERVING", createTime: "soon" } },
  ],
]) {
  test(`a record without ${name} is refused`, () => {
    const list = [{ ...version("a", 1), ...broken }, version("b", 2, 1)];
    assert.throws(() => selectTarget(list, "b"), /Unreadable version list/);
  });
}

test("a list that is not an array is refused", () => {
  assert.throws(
    () => selectTarget({ error: "x" }, ""),
    /Unreadable version list/
  );
});

test("a null record is refused", () => {
  assert.throws(() => selectTarget([null], ""), /Unreadable version list/);
});

test("a split written as a string is refused", () => {
  const list = [{ ...version("a", 1), traffic_split: "1.0" }];
  assert.throws(() => selectTarget(list, "a"), /Unreadable version list/);
});

test("a malformed version is refused before the list is read", () => {
  assert.throws(() => selectTarget([null], "$(x)"), /Malformed version/);
});

test("fractional seconds in the creation time still order", () => {
  const list = [
    version("a", 1),
    {
      ...version("b", 1),
      version: {
        servingStatus: "SERVING",
        createTime: "2026-11-01T10:00:00.5Z",
      },
    },
    version("c", 2, 1),
  ];
  assert.equal(selectTarget(list, "").target, "b");
});

test("an empty list is refused", () => {
  assert.throws(() => selectTarget([], ""), /No versions/);
});

test("no version rolls back to the newest serving one before the live one", () => {
  const list = [
    version("a", 1),
    version("b", 2),
    version("c", 3, 1),
    version("d", 4),
  ];
  assert.deepEqual(selectTarget(list, ""), {
    current: "c",
    target: "b",
    changed: true,
  });
});

test("rollback skips a stopped version", () => {
  const list = [
    version("a", 1),
    version("b", 2, 0, "STOPPED"),
    version("c", 3, 1),
  ];
  assert.equal(selectTarget(list, "").target, "a");
});

test("rollback does not take a version created at the same instant", () => {
  const list = [version("a", 1, 1), version("b", 1)];
  assert.throws(() => selectTarget(list, ""), /Nothing to roll back to/);
});

test("rollback with nothing older is refused", () => {
  assert.throws(
    () => selectTarget([version("a", 1, 1), version("b", 2)], ""),
    /Nothing to roll back to/
  );
});

test("rollback from split traffic asks for a named version", () => {
  const split = [version("a", 1, 0.5), version("b", 2, 0.5)];
  assert.throws(() => selectTarget(split, ""), /name a version/);
});

test("float rounding still counts as all traffic", () => {
  const list = [version("a", 1), version("b", 2, 0.99995)];
  assert.equal(selectTarget(list, "").current, "b");
  assert.doesNotThrow(() => assertLive(list, "b"));
});

test("the smallest real split is not all traffic", () => {
  const list = [version("a", 1, 0.001), version("b", 2, 0.999)];
  assert.equal(selectTarget(list, "a").current, null);
  assert.throws(() => selectTarget(list, ""), /name a version/);
  assert.throws(() => assertLive(list, "b"), /does not hold all traffic/);
});

test("assertLive refuses a target without all traffic", () => {
  assert.throws(() => assertLive(LIVE_B, "a"), /"a" does not hold all traffic/);
  assert.doesNotThrow(() => assertLive(LIVE_B, "b"));
});

test("assertLive refuses a target missing from the list", () => {
  assert.throws(() => assertLive(LIVE_B, "z"), /"z" does not hold all traffic/);
});

const run = (mode, env, list = LIVE_B) =>
  spawnSync(process.execPath, [SCRIPT, mode], {
    encoding: "utf8",
    input: JSON.stringify(list),
    env: { ...process.env, ...env },
  });

test("select prints output lines, and split for no current", () => {
  assert.equal(
    run("select", { REQUESTED_VERSION: "" }).stdout,
    "current=b\ntarget=a\nchanged=true\n"
  );
  const split = [version("a", 1, 0.5), version("b", 2, 0.5)];
  assert.equal(
    run("select", { REQUESTED_VERSION: "a" }, split).stdout,
    "current=split\ntarget=a\nchanged=true\n"
  );
});

test("select says changed=false for the live version", () => {
  assert.equal(
    run("select", { REQUESTED_VERSION: "b" }).stdout,
    "current=b\ntarget=b\nchanged=false\n"
  );
});

test("a refusal exits 1 with an annotation", () => {
  const { status, stdout, stderr } = run("select", { REQUESTED_VERSION: "z" });
  assert.equal(status, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^::error::/);
});

test("unparsable input is refused", () => {
  const { status, stderr } = spawnSync(process.execPath, [SCRIPT, "select"], {
    encoding: "utf8",
    input: "not json",
  });
  assert.equal(status, 1);
  assert.match(stderr, /^::error::Unreadable version list/);
});

test("verify exits by whether the target holds all traffic", () => {
  assert.equal(run("verify", { TARGET_VERSION: "b" }).status, 0);
  assert.equal(run("verify", { TARGET_VERSION: "a" }).status, 1);
  assert.equal(run("verify", { TARGET_VERSION: "" }).status, 1);
});

test("verify still checks when reached through a symlink", () => {
  const link = join(mkdtempSync(join(tmpdir(), "resolve-target-")), "link.mjs");
  symlinkSync(SCRIPT, link);
  const { status } = spawnSync(process.execPath, [link, "verify"], {
    encoding: "utf8",
    input: JSON.stringify(LIVE_B),
    env: { ...process.env, TARGET_VERSION: "a" },
  });
  assert.equal(status, 1);
});
