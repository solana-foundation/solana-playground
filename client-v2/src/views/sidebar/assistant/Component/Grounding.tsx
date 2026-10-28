import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import ServerConsole from "./ServerConsole";
import { useRenderOnChange } from "../../../../hooks";
import { PgAssistant } from "../store";
import { SKILLS } from "../grounding";
import {
  LOCAL_MCP_SERVERS,
  parseServers,
  serializeServers,
} from "@/features/mcp";
import { PROVIDERS } from "../model/types";

const MUTED = "text-[0.7rem] text-[var(--text-secondary)]";

const ACTION =
  "cursor-pointer rounded-panel border border-border bg-transparent px-2.5 py-[0.3125rem] text-[0.7rem] text-[var(--text-secondary)] hover:enabled:bg-surface-hover hover:enabled:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45";

const Grounding = () => {
  useRenderOnChange(PgAssistant.onDidChange);

  const enabledSkills = PgAssistant.enabledSkillIds;
  const servers = PgAssistant.mcpServers;
  const providerId = PgAssistant.connection?.id;
  const providerName = PROVIDERS.find((p) => p.id === providerId)?.name;

  // The editor edits local additions only; the gateway owns the rest
  const local = PgAssistant.localMcpServers;
  const [draft, setDraft] = useState(() => serializeServers(local));
  const [error, setError] = useState<string | null>(null);

  const applied = serializeServers(local);
  const dirty = draft !== applied;

  const apply = () => {
    try {
      const parsed = parseServers(
        draft,
        PgAssistant.gatewayMcpServers.map((server) => server.id)
      );
      PgAssistant.setMcpServers(parsed);
      // Show the normalised result, so defaults the parser filled in are visible
      setDraft(serializeServers(parsed));
      setError(null);
      // The config changed, so re-read even servers already cached
      PgAssistant.discoverMcpTools(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = () => {
    setDraft(serializeServers(LOCAL_MCP_SERVERS));
    setError(null);
  };

  return (
    <div className="flex min-h-0 grow flex-col overflow-y-auto px-4 py-5">
      <div className="not-first:pt-7">
        <div className={cn(MUTED, "pb-[0.4375rem] tracking-[0.1em]")}>
          SKILLS
        </div>
        <div className={cn(MUTED, "pb-[0.875rem] leading-[1.6]")}>
          Reference documents the assistant loads when it decides it needs them.
          Only the names and descriptions below sit in the prompt.
        </div>

        {SKILLS.map((skill) => (
          <div key={skill.id} className="pb-3">
            <Label>
              <Checkbox
                checked={enabledSkills.includes(skill.id)}
                onCheckedChange={(checked) =>
                  PgAssistant.setSkillEnabled(skill.id, checked === true)
                }
              />
              {skill.name}
            </Label>
            <div className={cn(MUTED, "pt-[0.1875rem] pl-5")}>
              {skill.source.type === "bundled"
                ? "bundled — always available"
                : "fetched from GitHub when loaded"}
            </div>
          </div>
        ))}
      </div>

      <div className="not-first:pt-7">
        <div className={cn(MUTED, "pb-[0.4375rem] tracking-[0.1em]")}>
          MCP SERVERS
        </div>
        <div className={cn(MUTED, "pb-[0.875rem] leading-[1.6]")}>
          Tools from remote servers, available to whichever backend is
          connected. This page calls each one itself, directly or through the
          gateway at <code>/api/mcp</code> for a host that refuses the browser.
        </div>

        {servers
          .filter((server) => server.enabled)
          .map((server) => (
            <ServerConsole
              key={server.id}
              server={server}
              providerName={providerName}
            />
          ))}

        {!servers.some((server) => server.enabled) && (
          <div className={cn(MUTED, "pb-[0.4375rem]")}>
            No servers. The gateway reports which ones it serves, so an empty
            list means it is not running (use <code>yarn dev</code>) or has none
            configured.
          </div>
        )}

        <div className={cn(MUTED, "pb-[0.4375rem] tracking-[0.1em]")}>
          ADDITIONAL SERVERS
        </div>
        <div className={cn(MUTED, "pb-[0.4375rem]")}>
          The gateway above owns its own list — these are extra entries, and
          they are the only ones this editor changes.
        </div>

        {PgAssistant.shadowedMcpServers.map((server) => (
          <div
            key={server.id}
            role="status"
            className={cn(MUTED, "pb-[0.4375rem]")}
          >
            Not used: the gateway serves a server with the id{" "}
            <code>{server.id}</code>, which replaces this entry. Rename the
            entry to use both.
          </div>
        ))}

        <textarea
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          spellCheck={false}
          rows={16}
          aria-label="MCP server configuration"
          className="w-full resize-y rounded-panel border border-border bg-surface-base px-2.5 py-2 font-pg-code text-[0.75rem] leading-normal text-[var(--text-primary)] [tab-size:2] focus-visible:-outline-offset-1 focus-visible:outline-1 focus-visible:outline-primary"
        />

        {error && (
          <div
            role="alert"
            className="pt-[0.4375rem] text-[0.7rem] leading-normal text-error"
          >
            {error}
          </div>
        )}

        <div className="flex gap-1.5 pt-2.5">
          <button className={ACTION} onClick={apply} disabled={!dirty}>
            {dirty ? "Apply" : "Applied"}
          </button>
          <button className={ACTION} onClick={reset}>
            Reset to defaults
          </button>
        </div>

        <div
          className={cn(
            MUTED,
            "pt-[0.875rem] leading-[1.6] [&_code]:font-pg-code"
          )}
        >
          <code>authToken</code> is sent as a bearer token.{" "}
          <code>queryParams</code> rides in the URL: the only way to pass a
          credential a server wants outside the Authorization header, such as a
          bot-protection bypass, and the only way past a CORS policy that does
          not allow that header name. <code>headers</code> is sent on every
          request. A header the server&apos;s Access-Control-Allow-Headers omits
          will fail the preflight rather than be ignored.
        </div>
      </div>
    </div>
  );
};

export default Grounding;
