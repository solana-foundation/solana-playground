/**
 * Every JSON-RPC request made in the sandbox goes through the page.
 *
 * `global-fetch.ts` routes `globalThis.fetch` here, for web3.js too. The page
 * carries the request out with its own `window.fetch`, which Playnet replaces
 * with in-browser answers, so Playnet works from the sandbox, and the
 * sandbox's `null` origin never meets CORS. Before the request leaves, real signatures replace the
 * placeholders of `tx.sign(pg.wallet.keypair)` (`placeholders.ts`).
 *
 * Anything that is not JSON-RPC goes out through the sandbox's own `fetch`,
 * from its opaque origin, so the page's origin and cookies lend it nothing.
 */
import type { RpcReply } from "../protocol";
import type { RpcRequest } from "./channel";
import { nativeFetch, setGlobalFetch } from "./global-fetch";
import { spliceRpcBody } from "./placeholders";

type SendRpc = (request: RpcRequest) => Promise<RpcReply>;

let attach: (send: SendRpc) => void = () => undefined;
const sendRpc = new Promise<SendRpc>((resolve) => {
  attach = resolve;
});

/**
 * Starts carrying RPC requests to the page, once the channel is open. A
 * request made earlier waits for it.
 *
 * @param send hands one request to the page
 */
export const bridgeRpcThrough = (send: SendRpc) => attach(send);

/** Statuses whose response must have no body */
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** The JSON-RPC request in a body, or `undefined` for anything else */
const rpcBodyOf = (body: string) => {
  const text = body.trimStart();
  if (!text.startsWith("{") && !text.startsWith("[")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON, so not JSON-RPC: it goes out as any other request
    return undefined;
  }
  const requests = Array.isArray(parsed) ? parsed : [parsed];
  const isRpc = requests.every(
    (request) =>
      typeof request === "object" && request !== null && "jsonrpc" in request
  );
  return isRpc ? (parsed as object | object[]) : undefined;
};

const bridgedFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : undefined;
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
  const body =
    typeof init?.body === "string"
      ? init.body
      : request && !init?.body
      ? await request.clone().text()
      : undefined;
  const rpc = body === undefined ? undefined : rpcBodyOf(body);
  if (rpc === undefined) return nativeFetch(input, init);

  const spliced = Array.isArray(rpc)
    ? await Promise.all(rpc.map(spliceRpcBody))
    : await spliceRpcBody(rpc);
  const send = await sendRpc;
  const reply = await send({
    url,
    method: init?.method ?? request?.method ?? "POST",
    headers: Object.fromEntries(
      new Headers(init?.headers ?? request?.headers).entries()
    ),
    body: JSON.stringify(spliced),
  });
  // What `fetch` does on a network failure
  if ("error" in reply) throw new TypeError(reply.error);
  // eslint-disable-next-line unicorn/no-null -- a body-less `Response` takes `null`
  return new Response(NO_BODY_STATUSES.has(reply.status) ? null : reply.body, {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
};

setGlobalFetch(bridgedFetch);
