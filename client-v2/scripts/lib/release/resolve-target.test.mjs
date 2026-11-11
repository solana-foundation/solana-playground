import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertLive,
  describeTraffic,
  selectTarget,
} from "./resolve-target.mjs";

const SCRIPT = fileURLToPath(new URL("./resolve-target.mjs", import.meta.url));

const versionFor = (servingStatus) => (split) => (id, day) => ({
  id,
  traffic_split: split,
  version: {
    servingStatus,
    createTime: `2026-11-0${day}T10:00:00Z`,
  },
});
const parked = versionFor("SERVING")(0);
const live = versionFor("SERVING")(1);
const half = versionFor("SERVING")(0.5);
const stopped = versionFor("STOPPED")(0);

const LIVE_B = [parked("a", 1), live("b", 2), parked("c", 3)];

test("selects a named serving version as the target", () => {
  assert.deepEqual(selectTarget("a", LIVE_B), {
    current: "b",
    target: "a",
    isChanged: true,
  });
});

test("reads a version written as its tag as its label", () => {
  const list = [parked("1-2-3", 1), live("1-2-4", 2)];
  assert.equal(selectTarget("1.2.3", list).target, "1-2-3");
});

test("changes nothing when the live version is named again", () => {
  assert.deepEqual(selectTarget("b", LIVE_B), {
    current: "b",
    target: "b",
    isChanged: false,
  });
});

test("promotes a named target out of split traffic, with no current", () => {
  const split = [half("a", 1), half("b", 2)];
  assert.deepEqual(selectTarget("a", split), {
    current: undefined,
    target: "a",
    isChanged: true,
  });
});

test("refuses an unknown version, naming it and the existing ones", () => {
  assert.throws(() => selectTarget("z", LIVE_B), /"z".*a, b, c/);
});

test("refuses a stopped version", () => {
  const list = [stopped("a", 1), live("b", 2)];
  assert.throws(() => selectTarget("a", list), /"a" is STOPPED/);
});

for (const bad of ["A-1", "a b", "a;rm", "$(x)", "-a"]) {
  test(`refuses the malformed version ${JSON.stringify(bad)}`, () => {
    assert.throws(() => selectTarget(bad, LIVE_B), /Malformed version/);
  });
}

const SERVING_SINCE = {
  servingStatus: "SERVING",
  createTime: "2026-11-01T10:00:00Z",
};

for (const [name, broken] of [
  ["its id", { traffic_split: 0, version: SERVING_SINCE }],
  ["its traffic split", { id: "a", version: SERVING_SINCE }],
  [
    "its status",
    {
      id: "a",
      traffic_split: 0,
      version: { createTime: "2026-11-01T10:00:00Z" },
    },
  ],
  [
    "its creation time",
    { id: "a", traffic_split: 0, version: { servingStatus: "SERVING" } },
  ],
  [
    "a readable creation time",
    {
      id: "a",
      traffic_split: 0,
      version: { servingStatus: "SERVING", createTime: "soon" },
    },
  ],
]) {
  test(`refuses a record without ${name}`, () => {
    const list = [broken, live("b", 2)];
    assert.throws(() => selectTarget("b", list), /Unreadable version list/);
  });
}

test("refuses a list that is not an array", () => {
  assert.throws(
    () => selectTarget("", { error: "x" }),
    /Unreadable version list/
  );
});

test("refuses a null record", () => {
  assert.throws(() => selectTarget("", [null]), /Unreadable version list/);
});

test("refuses a split written as a string", () => {
  const list = [{ id: "a", traffic_split: "1.0", version: SERVING_SINCE }];
  assert.throws(() => selectTarget("a", list), /Unreadable version list/);
});

test("refuses a malformed version before the list is read", () => {
  assert.throws(() => selectTarget("$(x)", [null]), /Malformed version/);
});

test("orders by fractional seconds in the creation time", () => {
  const list = [
    parked("a", 1),
    {
      id: "b",
      traffic_split: 0,
      version: {
        servingStatus: "SERVING",
        createTime: "2026-11-01T10:00:00.5Z",
      },
    },
    live("c", 2),
  ];
  assert.equal(selectTarget("", list).target, "b");
});

test("refuses an empty list", () => {
  assert.throws(() => selectTarget("", []), /No versions/);
});

test("rolls back to the newest serving version before the live one when none is named", () => {
  const list = [parked("a", 1), parked("b", 2), live("c", 3), parked("d", 4)];
  assert.deepEqual(selectTarget("", list), {
    current: "c",
    target: "b",
    isChanged: true,
  });
});

test("skips a stopped version on rollback", () => {
  const list = [parked("a", 1), stopped("b", 2), live("c", 3)];
  assert.equal(selectTarget("", list).target, "a");
});

test("skips a version created at the same instant on rollback", () => {
  const list = [live("a", 1), parked("b", 1)];
  assert.throws(() => selectTarget("", list), /Nothing to roll back to/);
});

test("refuses a rollback with nothing older", () => {
  assert.throws(
    () => selectTarget("", [live("a", 1), parked("b", 2)]),
    /Nothing to roll back to/
  );
});

test("asks for a named version on a rollback from split traffic", () => {
  const split = [half("a", 1), half("b", 2)];
  assert.throws(() => selectTarget("", split), /name a version/);
});

test("counts float rounding as all traffic", () => {
  const list = [parked("a", 1), versionFor("SERVING")(0.99995)("b", 2)];
  assert.equal(selectTarget("", list).current, "b");
  assert.doesNotThrow(() => assertLive("b", list));
});

test("does not count the smallest real split as all traffic", () => {
  const list = [
    versionFor("SERVING")(0.001)("a", 1),
    versionFor("SERVING")(0.999)("b", 2),
  ];
  assert.equal(selectTarget("a", list).current, undefined);
  assert.throws(() => selectTarget("", list), /name a version/);
  assert.throws(() => assertLive("b", list), /does not hold all traffic/);
});

test("refuses a live check on a target without all traffic", () => {
  assert.throws(() => assertLive("a", LIVE_B), /"a" does not hold all traffic/);
  assert.doesNotThrow(() => assertLive("b", LIVE_B));
});

test("refuses a live check on a target missing from the list", () => {
  assert.throws(() => assertLive("z", LIVE_B), /"z" does not hold all traffic/);
});

const runWith = (list) => (mode, env) =>
  spawnSync(process.execPath, [SCRIPT, mode], {
    encoding: "utf8",
    input: JSON.stringify(list),
    env,
  });
const run = runWith(LIVE_B);

test("prints output lines on select, and split for no current", () => {
  assert.equal(
    run("select", { REQUESTED_VERSION: "" }).stdout,
    "current=b\ntarget=a\nchanged=true\n"
  );
  const split = [half("a", 1), half("b", 2)];
  assert.equal(
    runWith(split)("select", { REQUESTED_VERSION: "a" }).stdout,
    "current=split\ntarget=a\nchanged=true\n"
  );
});

test("prints changed=false on select for the live version", () => {
  assert.equal(
    run("select", { REQUESTED_VERSION: "b" }).stdout,
    "current=b\ntarget=b\nchanged=false\n"
  );
});

test("exits 1 with an annotation on a refusal", () => {
  const { status, stdout, stderr } = run("select", { REQUESTED_VERSION: "z" });
  assert.equal(status, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^::error::/);
});

test("refuses unparsable input", () => {
  const { status, stderr } = spawnSync(process.execPath, [SCRIPT, "select"], {
    encoding: "utf8",
    input: "not json",
  });
  assert.equal(status, 1);
  assert.match(stderr, /^::error::Unreadable version list/);
});

test("exits from verify by whether the target holds all traffic", () => {
  assert.equal(run("verify", { TARGET_VERSION: "b" }).status, 0);
  assert.equal(run("verify", { TARGET_VERSION: "a" }).status, 1);
  assert.equal(run("verify", { TARGET_VERSION: "" }).status, 1);
});

test("names the refusal when verify fails", () => {
  assert.match(
    run("verify", { TARGET_VERSION: "a" }).stderr,
    /^::error::Version "a" does not hold all traffic/
  );
});

test("refuses a list verify cannot read", () => {
  for (const [input, message] of [
    ["not json", /^::error::Unreadable version list/],
    ["{}", /^::error::Unreadable version list/],
    ["[]", /^::error::No versions/],
  ]) {
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      [SCRIPT, "verify"],
      { encoding: "utf8", input, env: { TARGET_VERSION: "a" } }
    );
    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, message);
  }
});

test("refuses an unknown or missing mode", () => {
  for (const argv of [[SCRIPT, "verfy"], [SCRIPT]]) {
    const { status, stdout, stderr } = spawnSync(process.execPath, argv, {
      encoding: "utf8",
      input: JSON.stringify(LIVE_B),
      env: {},
    });
    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^::error::Unknown mode/);
  }
});

test("describes only the versions receiving traffic", () => {
  assert.equal(describeTraffic(LIVE_B), "- `b`: 1");
  assert.equal(
    describeTraffic([half("a", 1), half("b", 2), parked("c", 3)]),
    "- `a`: 0.5\n- `b`: 0.5"
  );
});

test("prints the traffic in traffic mode", () => {
  const { status, stdout } = run("traffic", {});
  assert.equal(status, 0);
  assert.equal(stdout, "- `b`: 1\n");
});

test("refuses a traffic report on an unreadable list", () => {
  assert.throws(() => describeTraffic({}), /Unreadable version list/);
});

test("checks in verify when reached through a symlink", () => {
  const link = join(mkdtempSync(join(tmpdir(), "resolve-target-")), "link.mjs");
  symlinkSync(SCRIPT, link);
  const { status } = spawnSync(process.execPath, [link, "verify"], {
    encoding: "utf8",
    input: JSON.stringify(LIVE_B),
    env: { TARGET_VERSION: "a" },
  });
  assert.equal(status, 1);
});
