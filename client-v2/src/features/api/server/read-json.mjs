// Reading a request body the same way for every `api/*.mjs` route.
//
// Kept beside the other server-side `.mjs` helpers so it is unit-tested
// despite `api/` sitting outside the TypeScript build (see
// `api/health.mjs`, `src/features/build-proxy/server/route.mjs`).

/**
 * Everything the stream holds, or `{}` for an empty body.
 *
 * @param {import("node:http").IncomingMessage} req
 */
const readStream = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8") || "{}";
};

/**
 * Read the request body, whether the platform pre-parsed it or not.
 *
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>} the body, always an object
 * @throws when the body is not JSON, or is JSON that is not an object --
 * so a caller's existing parse guard answers the 400 rather than a field
 * read throwing past it. `JSON.parse` happily returns `null`, a number,
 * a string or an array, and reading a field off `null` is what surfaced
 * as a 500 (M3, from the #13 review).
 */
export async function readJson(req) {
  // `=== undefined`, not falsiness: Vercel pre-parses a JSON body and
  // drains the stream, so a falsy pre-parsed body (`null`, `0`, `""`)
  // would otherwise fall through to a stream with nothing left in it and
  // be read as `{}` -- the platform where the M3 report came from.
  let parsed;
  if (req.body === undefined) parsed = JSON.parse(await readStream(req));
  else if (typeof req.body === "string") parsed = JSON.parse(req.body);
  else parsed = req.body;

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }

  return parsed;
}
