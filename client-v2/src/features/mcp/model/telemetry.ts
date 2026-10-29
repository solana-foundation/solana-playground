import { createTracker } from "@/shared/lib/telemetry";

/** `gateway` for an entry reached through `/api/mcp`, `user` for any other */
export type McpServerKind = "gateway" | "user";

type McpEvents = {
  /** A server's tools were listed; `tools` is how many it offers */
  mcp_tools_listed: { server: McpServerKind; tools: number };
  /**
   * Listing a server's tools failed: `unreachable` when the browser could not
   * reach the host, `timeout` when a request outlived the connection's
   * timeout, `session-expired` when the session expired again after one
   * reopen, `other` otherwise.
   */
  mcp_tools_list_failed: {
    server: McpServerKind;
    reason: "unreachable" | "timeout" | "session-expired" | "other";
  };
  /**
   * A tool call settled: `ok`, `tool-error` when the server answered with an
   * error result, `aborted` when the caller's signal stopped it, `timeout`
   * when it outlived the connection's timeout, `failed` when it rejected for
   * any other reason; `retried` when it ran again on a new session.
   */
  mcp_tool_called: {
    server: McpServerKind;
    outcome: "ok" | "tool-error" | "aborted" | "timeout" | "failed";
    retried: boolean;
  };
  /** An expired session was replaced, once however many calls failed on it */
  mcp_session_reopened: { server: McpServerKind };
};

export type McpEventParams<E extends keyof McpEvents> = McpEvents[E];

export const mcpTelemetry = createTracker<McpEvents>();
