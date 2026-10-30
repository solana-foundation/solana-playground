import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Readable } from "node:stream";

import { BodyTooLarge, readBoundedBody, worstCaseCost } from "./bounds.mjs";

/** A streamed request carrying `text` in chunks of `size`, with headers */
const request = (text, { headers = {}, size = 7 } = {}) => {
  const bytes = Buffer.from(text);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, i + size));
  }
  return Object.assign(Readable.from(chunks), { headers });
};

const withLength = (text) => ({
  headers: { "content-length": String(Buffer.byteLength(text)) },
});

describe("readBoundedBody", () => {
  const LIMIT = 64;
  const under = `{"messages":"${"a".repeat(LIMIT - 15)}"}`;
  const over = `{"messages":"${"a".repeat(LIMIT - 14)}"}`;

  it("reads a body exactly at the limit", async () => {
    assert.equal(Buffer.byteLength(under), LIMIT);
    assert.deepEqual(
      await readBoundedBody(request(under, withLength(under)), LIMIT),
      {
        body: under,
        bytes: LIMIT,
      }
    );
  });

  it("refuses a body just over the limit from its content-length, unread", async () => {
    assert.equal(Buffer.byteLength(over), LIMIT + 1);
    const req = request(over, withLength(over));

    await assert.rejects(readBoundedBody(req, LIMIT), BodyTooLarge);
    assert.equal(req.readableEnded, false);
  });

  it("refuses a chunked body with no content-length while reading", async () => {
    await assert.rejects(readBoundedBody(request(over), LIMIT), BodyTooLarge);
  });

  it("reads a chunked body at the limit", async () => {
    assert.equal((await readBoundedBody(request(under), LIMIT)).bytes, LIMIT);
  });

  it("refuses a content-length that lies low, by counting", async () => {
    const req = request(over, { headers: { "content-length": "10" } });
    await assert.rejects(readBoundedBody(req, LIMIT), BodyTooLarge);
  });

  it("measures a body the platform pre-parsed", async () => {
    const parsed = { messages: "a".repeat(LIMIT) };
    await assert.rejects(
      readBoundedBody({ headers: {}, body: parsed }, LIMIT),
      BodyTooLarge
    );
    const small = { messages: [] };
    assert.deepEqual(
      await readBoundedBody({ headers: {}, body: small }, LIMIT),
      {
        body: small,
        bytes: Buffer.byteLength(JSON.stringify(small)),
      }
    );
  });

  it("reads an empty stream as an empty object", async () => {
    assert.deepEqual(await readBoundedBody(request(""), LIMIT), {
      body: "{}",
      bytes: 0,
    });
  });
});

describe("worstCaseCost", () => {
  it("prices the design's worst-case turn at about $0.023", () => {
    // 512 KB is 131072 input tokens at $0.15/M, plus 8192 output at $0.50/M
    assert.equal(
      worstCaseCost({
        bytes: 524288,
        maxOutputTokens: 8192,
        prices: { input: 0.15, output: 0.5 },
      }),
      23757
    );
  });
});
