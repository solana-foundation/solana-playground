import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rpcError } from "./json-rpc.mjs";

describe("rpcError", () => {
  // `JSON.stringify` drops an undefined id, and the answer then breaks JSON-RPC
  it("sends a null id when the request had none", () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(rpcError(undefined, -32603, "x"))),
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "x" },
      }
    );
  });
});
