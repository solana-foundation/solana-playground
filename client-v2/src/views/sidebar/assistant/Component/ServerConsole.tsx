import { useState } from "react";
import styled, { css } from "styled-components";

import { PgAssistant } from "../store";
import { PgConnection } from "../../../../utils";
import { callTool, listTools, McpUnreachableError } from "../grounding";
import type { McpServerEntry, McpTool } from "../grounding";

interface ServerConsoleProps {
  server: McpServerEntry;
  /** The connected backend's name, when one is connected */
  providerName?: string;
  /** Whether that backend can execute a `server`-executor entry for us */
  hasServerExecutor: boolean;
}

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

/**
 * One MCP server: what can reach it, and — when the browser can — a console
 * for calling its tools with no backend connected at all.
 */
const ServerConsole = ({
  server,
  providerName,
  hasServerExecutor,
}: ServerConsoleProps) => {
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

  const explain = (e: unknown) => {
    if (e instanceof McpUnreachableError) return e.message;
    return e instanceof Error ? e.message : String(e);
  };

  const discover = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      PgAssistant.setMcpTools(server.id, await listTools(server));
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
    <Card>
      <Head>
        <Name>{server.name || server.id}</Name>
        <Badge>{server.executor}</Badge>
      </Head>

      {server.executor === "server" ? (
        <Note>
          {hasServerExecutor
            ? `This server has no CORS headers, so a page cannot call it. ` +
              `${providerName} executes it for us.`
            : `This server has no CORS headers, so a page cannot call it, and ` +
              `${
                providerName ?? "the backend you connect"
              } provides no executor for it. Its tools are unavailable until ` +
              `one does.`}
        </Note>
      ) : (
        <>
          <Note>
            Callable straight from here — no backend, no key, no tokens.
          </Note>

          <Actions>
            <Action onClick={discover} disabled={busy}>
              {busy ? "Working…" : tools.length ? "Refresh tools" : "Connect"}
            </Action>
          </Actions>

          {tools.length > 0 && (
            <>
              <Label htmlFor={`mcp-tool-${server.id}`}>TOOL</Label>
              <Picker
                id={`mcp-tool-${server.id}`}
                value={selected ?? ""}
                onChange={(ev) => pick(ev.target.value)}
              >
                <option value="">Pick a tool…</option>
                {tools.map((tool) => (
                  <option key={tool.name} value={tool.name}>
                    {tool.name}
                  </option>
                ))}
              </Picker>

              {selected && (
                <>
                  <Description $clamped={!descriptionOpen && descriptionIsLong}>
                    {description}
                  </Description>
                  {descriptionIsLong && (
                    <Disclosure
                      type="button"
                      aria-expanded={descriptionOpen}
                      onClick={() => setDescriptionOpen((open) => !open)}
                    >
                      {descriptionOpen ? "Show less" : "Show more"}
                    </Disclosure>
                  )}

                  <Label htmlFor={`mcp-args-${server.id}`}>ARGUMENTS</Label>
                  <Json
                    id={`mcp-args-${server.id}`}
                    value={args}
                    onChange={(ev) => setArgs(ev.target.value)}
                    spellCheck={false}
                    rows={5}
                  />

                  <Actions>
                    <Action onClick={call} disabled={busy}>
                      {busy ? "Calling…" : "Call"}
                    </Action>
                    {PgAssistant.isConnected && (
                      <Action onClick={askAssistant} disabled={busy}>
                        Ask {providerName ?? "the assistant"}
                      </Action>
                    )}
                  </Actions>
                </>
              )}
            </>
          )}
        </>
      )}

      {error && <ErrorText role="alert">{error}</ErrorText>}
      {result !== null && <Result>{result}</Result>}
    </Card>
  );
};

const Card = styled.div`
  ${({ theme }) => css`
    margin-bottom: 0.75rem;
    padding: 0.625rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
  `}
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const Name = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    font-size: ${theme.font.code.size.small};
  `}
`;

const Badge = styled.span`
  ${({ theme }) => css`
    flex-shrink: 0;
    padding: 0.0625rem 0.375rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const Note = styled.div`
  ${({ theme }) => css`
    padding: 0.375rem 0 0;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.55;
  `}
`;

const Label = styled.label`
  ${({ theme }) => css`
    display: block;
    padding: 0.5rem 0 0.25rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.06em;
  `}
`;

const Picker = styled.select`
  ${({ theme }) => css`
    width: 100%;
    padding: 0.3125rem;
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
  `}
`;

const Description = styled.div<{ $clamped: boolean }>`
  ${({ theme, $clamped }) => css`
    padding-top: 0.375rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.5;
    white-space: pre-wrap;

    ${$clamped &&
    css`
      /* Clamped rather than sliced, so the full text stays selectable */
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
    `}
  `}
`;

const Disclosure = styled.button`
  ${({ theme }) => css`
    margin-top: 0.25rem;
    padding: 0;
    background: transparent;
    border: none;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.xsmall};
    text-decoration: underline;
    cursor: pointer;

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

const Json = styled.textarea`
  ${({ theme }) => css`
    width: 100%;
    resize: vertical;
    padding: 0.375rem 0.5rem;
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textPrimary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    line-height: 1.5;
  `}
`;

const Actions = styled.div`
  display: flex;
  gap: 0.375rem;
  padding-top: 0.5rem;
`;

const Action = styled.button`
  ${({ theme }) => css`
    padding: 0.3125rem 0.625rem;
    background: transparent;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.xsmall};
    cursor: pointer;

    &:hover:not(:disabled) {
      background: ${theme.colors.state.hover.bg};
      color: ${theme.colors.default.textPrimary};
    }

    &:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `}
`;

const ErrorText = styled.div`
  ${({ theme }) => css`
    padding-top: 0.5rem;
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.5;
  `}
`;

const Result = styled.pre`
  ${({ theme }) => css`
    margin: 0.5rem 0 0;
    max-height: 14rem;
    overflow: auto;
    padding: 0.5rem;
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textPrimary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  `}
`;

export default ServerConsole;
