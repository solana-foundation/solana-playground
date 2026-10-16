import type { IncomingMessage } from "node:http";

import { readJson } from "./read-json.mjs";

/**
 * A request whose body arrives as the raw stream, the way the dev
 * middleware and a plain Node server deliver it.
 */
const streamed = (raw: string) =>
  ({
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(raw);
    },
  } as unknown as IncomingMessage);

/**
 * A request the platform already parsed, the way Vercel delivers a JSON
 * body -- and with the stream drained, so falling through to it yields
 * nothing.
 */
const preparsed = (body: unknown) =>
  ({
    body,
    // eslint-disable-next-line require-yield
    async *[Symbol.asyncIterator]() {
      return;
    },
  } as unknown as IncomingMessage);

describe("readJson from the stream", () => {
  it("parses an object", async () => {
    await expect(readJson(streamed('{"messages":[]}'))).resolves.toEqual({
      messages: [],
    });
  });

  it("reads an empty body as an empty object", async () => {
    await expect(readJson(streamed(""))).resolves.toEqual({});
  });

  const notObjects: Array<[label: string, raw: string]> = [
    ["null", "null"],
    ["a number", "42"],
    ["a string", '"hello"'],
    ["an array", "[]"],
    ["a boolean", "false"],
  ];

  for (const [label, raw] of notObjects) {
    it(`refuses a body that is ${label}`, async () => {
      await expect(readJson(streamed(raw))).rejects.toThrow(
        "Expected a JSON object"
      );
    });
  }

  it("lets malformed JSON throw as itself", async () => {
    await expect(readJson(streamed("{not json"))).rejects.toBeInstanceOf(
      SyntaxError
    );
  });
});

describe("readJson from a pre-parsed body", () => {
  it("returns an object as it stands", async () => {
    const body = { messages: [{ role: "user" }] };
    await expect(readJson(preparsed(body))).resolves.toBe(body);
  });

  it("parses a string body", async () => {
    await expect(readJson(preparsed('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it("lets a pre-parsed empty string throw as malformed JSON", async () => {
    await expect(readJson(preparsed(""))).rejects.toBeInstanceOf(SyntaxError);
  });

  // Each of these is falsy or non-object, so a truthiness check would
  // have fallen through to the drained stream and answered `{}` -- which
  // is what happened on the platform the M3 report came from
  const notObjects: Array<[label: string, body: unknown]> = [
    ["null", null],
    ["a number", 0],
    ["false", false],
    ["an array", []],
  ];

  for (const [label, body] of notObjects) {
    it(`refuses a pre-parsed body that is ${label}`, async () => {
      await expect(readJson(preparsed(body))).rejects.toThrow(
        "Expected a JSON object"
      );
    });
  }
});
