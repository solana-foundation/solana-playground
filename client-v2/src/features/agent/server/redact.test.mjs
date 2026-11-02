import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactSecrets } from "./redact.mjs";

const KEY = "vck_9fA2bQ7xLm4pZr8TuW1yN6cK";

describe("redactSecrets", () => {
  it("removes the whole key", () => {
    assert.equal(
      redactSecrets(`Invalid key ${KEY}.`, [KEY]),
      "Invalid key [redacted]."
    );
  });

  it("removes a run of eight or more characters of the key", () => {
    // What an upstream that masks the middle of a key would echo
    const masked = `${KEY.slice(0, 10)}****${KEY.slice(-9)}`;
    const out = redactSecrets(`Incorrect API key provided: ${masked}`, [KEY]);
    assert.ok(!out.includes(KEY.slice(0, 8)), out);
    assert.ok(!out.includes(KEY.slice(-8)), out);
  });

  it("keeps a run shorter than eight characters", () => {
    const text = `prefix ${KEY.slice(0, 7)} suffix`;
    assert.equal(redactSecrets(text, [KEY]), text);
  });

  it("matches a key's characters literally, not as a pattern", () => {
    const key = "ab+c/d.e*f?g(h)ij";
    assert.equal(redactSecrets(`x ${key} y`, [key]), "x [redacted] y");
    assert.equal(redactSecrets("x abbbc/d y", [key]), "x abbbc/d y");
  });

  it("removes a key shorter than eight characters whole", () => {
    assert.equal(
      redactSecrets("key=k1 and k1", ["k1"]),
      "key=[redacted] and [redacted]"
    );
  });

  it("removes every key given, and skips unset ones", () => {
    const other = "zzzz-other-key-0000";
    assert.equal(
      redactSecrets(`${KEY} ${other}`, [KEY, undefined, other, ""]),
      "[redacted] [redacted]"
    );
  });

  it("leaves text without a key unchanged", () => {
    assert.equal(redactSecrets("slow down", [KEY]), "slow down");
  });
});
