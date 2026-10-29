import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { usageReader } from "./stream-usage.mjs";

const feed = (...chunks) => {
  const reader = usageReader();
  for (const chunk of chunks) reader.push(Buffer.from(chunk));
  return reader.usage();
};

describe("usageReader", () => {
  const USAGE = { prompt_tokens: 120, completion_tokens: 30 };
  const last = `data: ${JSON.stringify({ choices: [], usage: USAGE })}\n\n`;

  it("takes the usage of the stream's last event", () => {
    assert.deepEqual(
      feed('data: {"choices":[],"usage":null}\n\n', last, "data: [DONE]\n\n"),
      USAGE
    );
  });

  it("reads an event cut across chunks", () => {
    assert.deepEqual(feed(last.slice(0, 17), last.slice(17)), USAGE);
  });

  it("reports none for a stream without usage", () => {
    assert.equal(feed('data: {"choices":[{"delta":{}}]}\n\n'), null);
  });

  it("reports none for an event cut off before it ended", () => {
    assert.equal(feed(last.slice(0, -2)), null);
  });

  it("skips a malformed event and keeps reading", () => {
    assert.deepEqual(feed('data: {"usage": nope}\n\n', last), USAGE);
  });
});
