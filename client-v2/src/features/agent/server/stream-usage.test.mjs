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
    assert.equal(feed('data: {"choices":[{"delta":{}}]}\n\n'), undefined);
  });

  it("reports none for an event cut off before it ended", () => {
    assert.equal(feed(last.slice(0, -2)), undefined);
  });

  it("skips a malformed event and keeps reading", (t) => {
    t.mock.method(console, "warn", () => {});
    assert.deepEqual(feed('data: {"usage": nope}\n\n', last), USAGE);
  });

  it("logs the first malformed event of a turn, and only the first", (t) => {
    const warn = t.mock.method(console, "warn", () => {});

    feed('data: {"usage": nope}\n\n', 'data: {"usage": nor this}\n\n', last);

    assert.equal(warn.mock.callCount(), 1);
    assert.deepEqual(warn.mock.calls[0].arguments[1], {
      error: "SyntaxError",
      bytes: '{"usage": nope}'.length,
    });
  });

  it("keeps the event's text out of the log", (t) => {
    const warn = t.mock.method(console, "warn", () => {});

    feed('data: {"usage": null, "content": "private answer\n\n', last);

    assert.doesNotMatch(
      JSON.stringify(warn.mock.calls[0].arguments),
      /private answer/
    );
  });
});
