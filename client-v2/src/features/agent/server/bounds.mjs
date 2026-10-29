/**
 * The bounds on one `/api/agent` request that make its worst-case cost known
 * before the upstream is called: a body no larger than `AGENT_MAX_BODY_BYTES`,
 * and `AGENT_MAX_OUTPUT_TOKENS` sent as `max_completion_tokens`.
 */

/** Bytes per input token, for sizing a reservation; the charge uses reported usage */
const BYTES_PER_TOKEN = 4;

/** A body over the limit; the route answers 413 */
export class BodyTooLarge extends Error {
  /** @param {number} limit */
  constructor(limit) {
    super(`Request body is larger than ${limit} bytes.`);
    this.name = "BodyTooLarge";
    this.limit = limit;
  }
}

/**
 * Read a request body of at most `limit` bytes, refusing a larger one before
 * buffering it: from `content-length` when the caller sent one, and by
 * counting while reading when it did not (a chunked body).
 *
 * A body the platform pre-parsed has already been buffered by it, under its
 * own cap. It is measured as it would be sent, so the limit means the same on
 * both paths.
 *
 * @param {import("node:http").IncomingMessage & { body?: unknown }} req
 * @param {number} limit bytes
 * @returns {Promise<{ body: unknown; bytes: number }>} `body`: the platform's
 *   pre-parsed body, or the raw text (`"{}"` when empty), for `readJson`
 * @throws {BodyTooLarge}
 */
export const readBoundedBody = async (req, limit) => {
  const declared = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    throw new BodyTooLarge(limit);
  }

  if (req.body !== undefined) {
    const bytes = Buffer.byteLength(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body) ?? ""
    );
    if (bytes > limit) throw new BodyTooLarge(limit);
    return { body: req.body, bytes };
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    // Stop reading: the rest is never buffered
    if (bytes > limit) throw new BodyTooLarge(limit);
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks).toString("utf8") || "{}", bytes };
};

/**
 * The most a turn can cost, in micro-USD: the body's bytes as input tokens,
 * plus `max_completion_tokens` of output. Prices are USD per million tokens, so tokens
 * times price is micro-USD already.
 *
 * @param {{
 *   bytes: number;
 *   maxOutputTokens: number;
 *   prices: { input: number; output: number };
 * }} turn
 */
export const worstCaseCost = ({ bytes, maxOutputTokens, prices }) =>
  Math.ceil(
    Math.ceil(bytes / BYTES_PER_TOKEN) * prices.input +
      maxOutputTokens * prices.output
  );
