import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Fakes for driving an `api/*.mjs` handler from a test.
 *
 * The handlers are plain ESM on raw Node request/response APIs (see
 * `api/health.mjs`), so a test only has to carry the few members they
 * actually touch. Shared because every `api` spec needs the same ones,
 * and three hand-rolled copies had already started to drift.
 */

export interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  chunks: Buffer[];
  ended: boolean;
  destroyed: boolean;
  writableEnded: boolean;
  setHeader: (k: string, v: string) => void;
  write: (c: Uint8Array | string) => boolean;
  end: (c?: Uint8Array | string) => void;
  on: (ev: string, cb: () => void) => FakeRes;
  once: (ev: string, cb: () => void) => FakeRes;
  off: (ev: string, cb: () => void) => FakeRes;
  /** Fire a listener the handler registered, e.g. the client going away */
  emit: (ev: string) => void;
  /** Everything written, as text */
  body: () => string;
}

/**
 * @param over overrides, e.g. `{ write: () => false }` to make the write
 * buffer read as full
 */
export const makeRes = (over: Partial<FakeRes> = {}): FakeRes => {
  const listeners = new Map<string, Array<() => void>>();
  const res: FakeRes = {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
    destroyed: false,
    writableEnded: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    write(c) {
      this.chunks.push(Buffer.from(c as Uint8Array));
      return true;
    },
    end(c) {
      if (c) this.chunks.push(Buffer.from(c as Uint8Array));
      this.ended = true;
      this.writableEnded = true;
      return undefined as unknown as void;
    },
    on(ev, cb) {
      listeners.set(ev, [...(listeners.get(ev) ?? []), cb]);
      return this;
    },
    once(ev, cb) {
      return this.on(ev, cb);
    },
    off(ev, cb) {
      listeners.set(
        ev,
        (listeners.get(ev) ?? []).filter((l) => l !== cb)
      );
      return this;
    },
    emit(ev) {
      for (const cb of [...(listeners.get(ev) ?? [])]) cb();
    },
    body() {
      return Buffer.concat(this.chunks).toString("utf8");
    },
    ...over,
  };
  return res;
};

interface RequestOptions {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  /**
   * Deliver the body the way the platform does: pre-parsed on `req.body`
   * with the stream already drained, rather than as raw chunks.
   */
  preparsed?: boolean;
}

/** A request carrying `raw` as its body */
export const makeReq = (raw: string, opts: RequestOptions = {}) =>
  ({
    method: opts.method ?? "POST",
    url: opts.url ?? "/api",
    headers: {
      host: "app.test",
      "content-type": "application/json",
      ...(opts.headers ?? {}),
    },
    ...(opts.preparsed ? { body: JSON.parse(raw) } : {}),
    async *[Symbol.asyncIterator]() {
      if (!opts.preparsed) yield Buffer.from(raw);
    },
    on: () => {},
  } as unknown as IncomingMessage);

/**
 * Drive a handler with a JSON body and hand back what it answered.
 *
 * The return type is `unknown` on purpose: these handlers `return
 * sendJson(...)` as an early exit, so what they resolve to varies and
 * means nothing -- the answer is on `res`.
 */
export const postJson = async (
  handler: (req: IncomingMessage, res: ServerResponse) => unknown,
  raw: string,
  opts: RequestOptions = {}
) => {
  const res = makeRes();
  await handler(makeReq(raw, opts), res as unknown as ServerResponse);
  return res;
};

/** The JSON a handler answered with */
export const jsonBody = <T = { error?: string }>(res: FakeRes): T =>
  JSON.parse(res.body()) as T;
