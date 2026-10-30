import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select";
import { PgAssistant } from "../store";
import { PgConnection } from "../../../../utils";
import { callTool } from "@/features/mcp";
import type { McpServerEntry, McpTool } from "@/features/mcp";

interface ServerConsoleProps {
  server: McpServerEntry;
  /** The connected backend's name, when one is connected */
  providerName?: string;
}

const MUTED = "text-[0.7rem] text-[var(--text-secondary)]";

const FIELD_LABEL = cn(MUTED, "block pt-2 pb-1 tracking-[0.06em]");

const ACTION =
  "cursor-pointer rounded-panel border border-border bg-transparent px-2.5 py-[0.3125rem] text-[0.7rem] text-[var(--text-secondary)] hover:enabled:bg-surface-hover hover:enabled:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45";

/** Descriptions past this many characters start collapsed */
const LONG_DESCRIPTION = 220;

/** Argument names that mean the Solana cluster, whatever the server calls it */
const CLUSTER_KEYS = ["cluster", "network"];

/**
 * A starting value for one argument.
 *
 * A cluster argument starts on the one the app is pointed at, but only when the
 * tool's own enum admits it — `localnet` is nobody's hosted cluster.
 */
const startingValue = (key: string, schema: unknown, cluster: string) => {
  const allowed = (schema as { enum?: unknown[] } | undefined)?.enum;

  return CLUSTER_KEYS.includes(key.toLowerCase()) &&
    Array.isArray(allowed) &&
    allowed.includes(cluster)
    ? cluster
    : "";
};

/** A starting point for the argument box, from the tool's own schema */
const skeletonFor = (tool: McpTool, cluster: string) => {
  const properties = tool.inputSchema?.properties;
  if (!properties || typeof properties !== "object") return "{}";

  const entries = Object.entries(properties as Record<string, unknown>);
  if (!entries.length) return "{}";

  return JSON.stringify(
    Object.fromEntries(
      entries.map(([key, schema]) => [key, startingValue(key, schema, cluster)])
    ),
    null,
    2
  );
};

/** One MCP server, with a console for calling its tools with no backend connected at all */
const ServerConsole = ({ server, providerName }: ServerConsoleProps) => {
  const tools = PgAssistant.mcpTools[server.id] ?? [];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  const description =
    tools.find((t) => t.name === selected)?.description ?? "No description.";
  // Long enough to bury the argument box: some servers write a page here
  const descriptionIsLong = description.length > LONG_DESCRIPTION;

  const explain = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const discover = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await PgAssistant.discoverToolsOf(server);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (name: string) => {
    setSelected(name);
    setResult(null);
    // Each tool gets its own first impression, however long the last one was
    setDescriptionOpen(false);
    const tool = tools.find((t) => t.name === name);
    // Null on a custom endpoint, which no server's enum can match anyway
    setArgs(tool ? skeletonFor(tool, PgConnection.cluster ?? "") : "{}");
  };

  /**
   * Hand the same call to the connected backend instead of running it here.
   *
   * Left in the composer rather than sent: the arguments are a skeleton the
   * user probably wants to fill in, and the model sees the prefixed tool name
   * `createMcpTools` gives it, not the server's own.
   */
  const askAssistant = () => {
    if (!selected) return;

    PgAssistant.requestPrompt(
      `Call the \`${server.id}__${selected}\` tool with these arguments:\n\n` +
        "```json\n" +
        args.trim() +
        "\n```\n\n" +
        "Then tell me what it returned.",
      { send: false }
    );
  };

  const call = async () => {
    if (!selected) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(args) as Record<string, unknown>;
    } catch (e) {
      setError(`Arguments are not valid JSON: ${explain(e)}`);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await callTool(server, selected, parsed);
      setResult(outcome.text);
      if (outcome.isError) setError("The tool reported an error.");
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-panel border border-border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[0.75rem] text-[var(--text-primary)]">
          {server.name || server.id}
        </div>
      </div>

      <div className={cn(MUTED, "pt-1.5 leading-[1.55]")}>
        Callable straight from here — no backend, no key, no tokens.
      </div>

      <div className="flex gap-1.5 pt-2">
        <button className={ACTION} onClick={discover} disabled={busy}>
          {busy ? "Working…" : tools.length ? "Refresh tools" : "Connect"}
        </button>
      </div>

      {tools.length > 0 && (
        <>
          <label htmlFor={`mcp-tool-${server.id}`} className={FIELD_LABEL}>
            TOOL
          </label>
          <NativeSelect
            size="sm"
            className="w-full [&_select]:font-mono [&_select]:text-xs"
            id={`mcp-tool-${server.id}`}
            value={selected ?? ""}
            onChange={(ev) => pick(ev.target.value)}
          >
            <NativeSelectOption value="">Pick a tool…</NativeSelectOption>
            {tools.map((tool) => (
              <NativeSelectOption key={tool.name} value={tool.name}>
                {tool.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {selected && (
            <>
              <div
                className={cn(
                  MUTED,
                  "pt-1.5 leading-normal whitespace-pre-wrap",
                  // Clamped rather than sliced, so the full text stays selectable
                  !descriptionOpen && descriptionIsLong && "line-clamp-3"
                )}
              >
                {description}
              </div>
              {descriptionIsLong && (
                <button
                  type="button"
                  aria-expanded={descriptionOpen}
                  onClick={() => setDescriptionOpen((open) => !open)}
                  className="mt-1 cursor-pointer p-0 text-xs text-muted-foreground underline hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {descriptionOpen ? "Show less" : "Show more"}
                </button>
              )}

              <label htmlFor={`mcp-args-${server.id}`} className={FIELD_LABEL}>
                ARGUMENTS
              </label>
              <textarea
                id={`mcp-args-${server.id}`}
                value={args}
                onChange={(ev) => setArgs(ev.target.value)}
                spellCheck={false}
                rows={5}
                className="w-full resize-y rounded-panel border border-border bg-surface-base px-2 py-1.5 font-pg-code text-[0.75rem] leading-normal text-[var(--text-primary)]"
              />

              <div className="flex gap-1.5 pt-2">
                <button className={ACTION} onClick={call} disabled={busy}>
                  {busy ? "Calling…" : "Call"}
                </button>
                {PgAssistant.isConnected && (
                  <button
                    className={ACTION}
                    onClick={askAssistant}
                    disabled={busy}
                  >
                    Ask {providerName ?? "the assistant"}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {error && (
        <div
          role="alert"
          className="pt-2 text-[0.7rem] leading-normal text-error"
        >
          {error}
        </div>
      )}
      {result !== null && (
        <pre className="mt-2 max-h-56 overflow-auto rounded-panel border border-border bg-surface-base p-2 font-pg-code text-[0.7rem] leading-normal [word-break:break-word] whitespace-pre-wrap text-[var(--text-primary)]">
          {result}
        </pre>
      )}
    </div>
  );
};

export default ServerConsole;
