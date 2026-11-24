import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactSecretsWith } from "./redact.mjs";

const KEY = "vck_9fA2bQ7xLm4pZr8TuW1yN6cK";

describe("redactSecretsWith", () => {
  it("removes the whole key", () => {
    assert.equal(
      redactSecretsWith([KEY])(`Invalid key ${KEY}.`),
      "Invalid key [redacted]."
    );
  });

  it("removes a run of eight or more characters of the key", () => {
    // What an upstream that masks the middle of a key would echo
    const masked = `${KEY.slice(0, 10)}****${KEY.slice(-9)}`;
    const out = redactSecretsWith([KEY])(
      `Incorrect API key provided: ${masked}`
    );
    assert.ok(!out.includes(KEY.slice(0, 8)), out);
    assert.ok(!out.includes(KEY.slice(-8)), out);
  });

  it("keeps a run shorter than eight characters", () => {
    const text = `prefix ${KEY.slice(0, 7)} suffix`;
    assert.equal(redactSecretsWith([KEY])(text), text);
  });

  it("matches a key's characters literally, not as a pattern", () => {
    const key = "ab+c/d.e*f?g(h)ij";
    assert.equal(redactSecretsWith([key])(`x ${key} y`), "x [redacted] y");
    assert.equal(redactSecretsWith([key])("x abbbc/d y"), "x abbbc/d y");
  });

  it("removes a key shorter than eight characters whole", () => {
    assert.equal(
      redactSecretsWith(["k1"])("key=k1 and k1"),
      "key=[redacted] and [redacted]"
    );
  });

  it("removes every key given, and skips unset ones", () => {
    const other = "zzzz-other-key-0000";
    assert.equal(
      redactSecretsWith([KEY, undefined, other, ""])(`${KEY} ${other}`),
      "[redacted] [redacted]"
    );
  });

  it("removes the longer of two overlapping secrets whole, whatever their order", () => {
    // The shorter one is a run inside the longer; taken first, it would split
    // the longer and leave its first characters too short to match
    const long = "ab+cdefghijklmnop";
    const short = "cdefghijklmnop";
    assert.equal(
      redactSecretsWith([short, long])(`key=${long}`),
      "key=[redacted]"
    );
  });

  it("removes a key whole when another key shares a long run with it", () => {
    // The `%20` and `+` encodings of one value: the first is longer, and its
    // run `Charlie9%2Fsec` sits inside the second
    const percent = "qry%20Charlie9%2Fsec";
    const plus = "qry+Charlie9%2Fsec";
    assert.equal(
      redactSecretsWith([percent, plus])(`key=${plus}`),
      "key=[redacted]"
    );
  });

  it("takes time linear in the text, even against a long key", () => {
    // Trying every run of a 1 KiB key against 2 MiB took 15 s and blocked
    // the server; one run of the key in the text was enough to cause it
    const long = `t${"k9".repeat(512)}`;
    const text = `${"k9".repeat(4)}${"z".repeat(2 * 1024 * 1024)}${long}`;
    const started = performance.now();
    const out = redactSecretsWith([long])(text);
    assert.ok(performance.now() - started < 1000, "took over a second");
    assert.equal(out, `[redacted]${"z".repeat(2 * 1024 * 1024)}[redacted]`);
  });

  it("leaves text without a key unchanged", () => {
    assert.equal(redactSecretsWith([KEY])("slow down"), "slow down");
  });
});
