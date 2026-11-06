import { Fragment, useEffect, useRef, useState } from "react";

import type { McpServerEntry } from "@/features/mcp";
import {
  LOCAL_MCP_SERVERS,
  parseServers,
  serializeServers,
} from "@/features/mcp";
import { cn } from "@/shared/lib/utils";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/shared/ui/field";
import { HelpTip } from "@/shared/ui/help-tip";

import { useRenderOnChange } from "../../../../hooks";
import type { SkillEntry } from "../grounding";
import { isAlwaysOn, isCommunity } from "../grounding";
import { MODEL_PROVIDER_PROFILES } from "../model/model-providers";
import type { CredentialField } from "../model/tool-config";
import { PROVIDERS } from "../model/types";
import { PgAssistant } from "../store";
import ServerConsole from "./ServerConsole";

const ENTRY_FORMAT_DOC_URL =
  "https://github.com/solana-foundation/solana-playground/blob/master/client-v2/docs/agent-sources-and-tools.md";

/** Each kind of entry's section in the doc, by the anchor GitHub gives its heading */
const ENTRY_FORMAT_DOC = {
  mcpServer: `${ENTRY_FORMAT_DOC_URL}#mcp-server-entries`,
  skill: `${ENTRY_FORMAT_DOC_URL}#skill-entries`,
};

const MUTED = "text-[0.7rem] text-[var(--text-secondary)]";

const ACTION =
  "cursor-pointer rounded-panel border border-border bg-transparent px-2.5 py-[0.3125rem] text-[0.7rem] text-[var(--text-secondary)] hover:enabled:bg-surface-hover hover:enabled:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45";

const EMPTY_LIST = "[]";

// Starts short and grows with the draft; past the cap the box scrolls, and its resize handle stays
const EDITOR_MIN_ROWS = 3;
const EDITOR_MAX_ROWS = 16;
const editorRows = (draft: string) =>
  Math.min(
    Math.max(draft.split("\n").length, EDITOR_MIN_ROWS),
    EDITOR_MAX_ROWS
  );

/**
 * A source's name and note as one label, so a click anywhere on either toggles its checkbox.
 *
 * The checkbox names itself by the name alone and takes the note as its description: give it
 * `aria-labelledby={`${htmlFor}-name`}` and `aria-describedby={`${htmlFor}-note`}`.
 */
const SourceLabel = ({
  htmlFor,
  name,
  note,
}: {
  htmlFor: string;
  name: string;
  note: string;
}) => (
  <FieldLabel htmlFor={htmlFor} className="flex-col items-start gap-0.5">
    <span id={`${htmlFor}-name`}>{name}</span>
    {/* FieldDescription's look on a span: its <p> is not allowed inside a <label> */}
    <span
      id={`${htmlFor}-note`}
      className="text-sm leading-normal font-normal text-muted-foreground"
    >
      {note}
    </span>
  </FieldLabel>
);

/** A credential by its key in the entry format */
const CredentialName = ({ field }: { field: CredentialField }) =>
  field === "url query" ? (
    <>
      the query in <code>url</code>
    </>
  ) : (
    <code>{field}</code>
  );

const skillNote = (skill: SkillEntry) => {
  // The description sits in the row's tip, so each row stays one short line
  if (isCommunity(skill)) return skill.community.repo;
  return isAlwaysOn(skill)
    ? "bundled — always available"
    : "fetched from GitHub when loaded";
};

const SkillRow = ({
  skill,
  checked,
}: {
  skill: SkillEntry;
  checked: boolean;
}) => (
  <Field orientation="horizontal">
    <Checkbox
      id={`skill-${skill.id}`}
      aria-labelledby={`skill-${skill.id}-name`}
      aria-describedby={
        isCommunity(skill)
          ? `skill-${skill.id}-note skill-${skill.id}-about`
          : `skill-${skill.id}-note`
      }
      checked={isAlwaysOn(skill) || checked}
      // Checked and disabled shows it is on and cannot be switched off
      disabled={isAlwaysOn(skill)}
      onCheckedChange={(value) =>
        PgAssistant.setSkillEnabled(skill.id, value === true)
      }
    />
    {/* FieldContent switches the row to top alignment, so the box sits by the name, as in the server rows */}
    <FieldContent>
      <SourceLabel
        htmlFor={`skill-${skill.id}`}
        name={skill.name}
        note={skillNote(skill)}
      />
      {isCommunity(skill) && (
        // The tip's content exists only while open, so the checkbox reads this copy
        <span id={`skill-${skill.id}-about`} className="sr-only">
          {skill.description}
        </span>
      )}
    </FieldContent>
    {isCommunity(skill) && (
      <HelpTip label={`About ${skill.name}`} className="mt-0.5 shrink-0">
        {/* One block: the tooltip lays out its children as flex items */}
        <p className="leading-relaxed">{skill.description}</p>
      </HelpTip>
    )}
  </Field>
);

const Grounding = () => {
  useRenderOnChange(PgAssistant.onDidChange);

  const enabledSkills = PgAssistant.enabledSkillIds;
  const foundationSkills = PgAssistant.skills.filter(
    (skill) => !isCommunity(skill)
  );
  const communitySkills = PgAssistant.skills.filter(isCommunity);
  const communityOn = communitySkills.filter((skill) =>
    enabledSkills.includes(skill.id)
  ).length;
  const servers = PgAssistant.mcpServers;
  const providerId = PgAssistant.connection?.id;
  const providerName = PROVIDERS.find((p) => p.id === providerId)?.name;
  const takesTools = providerId
    ? MODEL_PROVIDER_PROFILES[providerId].supportsTools
    : true;

  // The editor edits local additions only; the gateway owns the rest
  const local = PgAssistant.localMcpServers;
  const [draft, setDraft] = useState(() => serializeServers(local));
  const [error, setError] = useState<string | null>(null);

  const applied = serializeServers(local);
  const dirty = draft !== applied;

  // The stored list can land after this mounted; a draft being edited keeps its own
  const lastApplied = useRef(applied);
  useEffect(() => {
    const previous = lastApplied.current;
    lastApplied.current = applied;
    setDraft((current) => (current === previous ? applied : current));
  }, [applied]);

  const [additionalOpen, setAdditionalOpen] = useState(false);
  // Applied entries, or a draft that is more than an empty array
  const hasAdditional =
    local.length > 0 || draft.replace(/\s/g, "") !== EMPTY_LIST;

  const toggle = (server: McpServerEntry, enabled: boolean) => {
    PgAssistant.setMcpServerEnabled(server.id, enabled);
    // A local entry's `enabled` is in the editor too; a draft being edited keeps its own
    if (!dirty && local.some((entry) => entry.id === server.id)) {
      setDraft(serializeServers(PgAssistant.localMcpServers));
    }
    if (enabled) void PgAssistant.discoverMcpTools();
  };

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
    <div className="flex min-h-0 grow flex-col gap-7 overflow-y-auto px-4 py-5">
      {!takesTools && (
        <FieldSet>
          <FieldLegend>Skills and MCP servers</FieldLegend>
          <FieldDescription>
            The connected model, {providerName ?? providerId}, takes no tools,
            so no skill or MCP server is offered to it.
          </FieldDescription>
        </FieldSet>
      )}

      {takesTools && (
        <FieldSet>
          <FieldLegend className="flex items-center gap-2">
            Skills
            <HelpTip label="About the skill entry format">
              {/* One block: the tooltip lays out its children as flex items */}
              <p className="leading-relaxed">
                A skill is a SKILL.md document and the reference files it names.
                Each entry needs an id, a name, a one-line description, and
                where its files come from. Entry format lists every field.
              </p>
            </HelpTip>
          </FieldLegend>
          <FieldDescription>
            Reference documents the assistant loads when it decides it needs
            them. Only the names and descriptions of checked skills sit in the
            prompt.{" "}
            <a href={ENTRY_FORMAT_DOC.skill} target="_blank" rel="noreferrer">
              Entry format ↗
            </a>
          </FieldDescription>

          {PgAssistant.skills.length === 0 && (
            <div
              role="status"
              className={cn(MUTED, "pb-[0.4375rem] leading-[1.6]")}
            >
              The server reported no skills, so the assistant has none to load.
            </div>
          )}

          <FieldGroup data-slot="checkbox-group">
            {foundationSkills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                checked={enabledSkills.includes(skill.id)}
              />
            ))}
          </FieldGroup>

          {communitySkills.length > 0 && (
            <Collapsible>
              <CollapsibleHeading className="text-sm font-medium">
                <CollapsibleChevron />
                Community skills{" "}
                <span className="font-normal text-muted-foreground">
                  · {communityOn} of {communitySkills.length} on
                </span>
              </CollapsibleHeading>
              <CollapsibleContent className="pt-3">
                <FieldDescription className="pb-3">
                  Written by third parties and listed on{" "}
                  <a
                    href="https://solana.com/skills"
                    target="_blank"
                    rel="noreferrer"
                  >
                    solana.com/skills ↗
                  </a>
                  . Each one is read from a fixed commit of its repository, and
                  reaches the assistant only once checked.
                </FieldDescription>
                <FieldGroup data-slot="checkbox-group">
                  {communitySkills.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      checked={enabledSkills.includes(skill.id)}
                    />
                  ))}
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          )}
        </FieldSet>
      )}

      {takesTools && (
        <FieldSet>
          <FieldLegend>MCP servers</FieldLegend>
          <FieldDescription>
            Tools from remote servers, available to whichever backend is
            connected. This page calls each one itself, directly or through the
            gateway at <code>/api/mcp</code> for a host that refuses the
            browser.
          </FieldDescription>

          <FieldGroup data-slot="checkbox-group">
            {servers.map((server) => (
              <Field key={server.id} orientation="horizontal">
                <Checkbox
                  id={`mcp-server-${server.id}`}
                  aria-labelledby={`mcp-server-${server.id}-name`}
                  aria-describedby={`mcp-server-${server.id}-note`}
                  checked={server.enabled}
                  onCheckedChange={(checked) =>
                    toggle(server, checked === true)
                  }
                />
                <FieldContent>
                  <SourceLabel
                    htmlFor={`mcp-server-${server.id}`}
                    name={server.name || server.id}
                    note={
                      PgAssistant.gatewayMcpServers.some(
                        (s) => s.id === server.id
                      )
                        ? "served by the gateway"
                        : "added below"
                    }
                  />
                  {server.enabled && (
                    <Collapsible className="pt-1 text-sm">
                      <CollapsibleHeading className="font-medium">
                        <CollapsibleChevron />
                        Call a tool
                      </CollapsibleHeading>
                      <CollapsibleContent className="pt-2">
                        <ServerConsole
                          server={server}
                          providerName={providerName}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </FieldContent>
              </Field>
            ))}
          </FieldGroup>

          {servers.length === 0 && (
            <div className={cn(MUTED, "pb-[0.4375rem] leading-[1.6]")}>
              No servers. The gateway reports which ones it serves, so an empty
              list means it is not running (use <code>yarn dev</code>) or has
              none configured.
            </div>
          )}

          <Collapsible
            open={additionalOpen || hasAdditional}
            onOpenChange={setAdditionalOpen}
            className="pt-2"
          >
            <div className="flex items-center gap-2 pb-2">
              {/* Disabled while it holds entries: an entry the user added is never hidden from them */}
              <CollapsibleHeading
                disabled={hasAdditional}
                className="text-sm font-medium disabled:cursor-default"
              >
                <CollapsibleChevron />
                Additional servers
              </CollapsibleHeading>
              <HelpTip label="About the server entry format">
                {/* One block: the tooltip lays out its children as flex items */}
                <p className="leading-relaxed">
                  A JSON array of servers. Each needs an id and a url; the other
                  fields are optional. Entry format lists every field with
                  examples.
                </p>
              </HelpTip>
            </div>
            <CollapsibleContent>
              <FieldDescription className="pb-2">
                Servers you add here, called from this browser. The
                deployment&apos;s servers are not edited here.{" "}
                <a
                  href={ENTRY_FORMAT_DOC.mcpServer}
                  target="_blank"
                  rel="noreferrer"
                >
                  Entry format ↗
                </a>
              </FieldDescription>

              {PgAssistant.shadowedMcpServers.map((server) => (
                <div
                  key={server.id}
                  role="status"
                  className={cn(MUTED, "pb-[0.4375rem] leading-[1.6]")}
                >
                  Not used: the gateway serves a server with the id{" "}
                  <code>{server.id}</code>, which replaces this entry. Rename
                  the entry to use both.
                </div>
              ))}

              {local.map((server) => {
                const fields = PgAssistant.missingMcpCredentials.get(server.id);
                return (
                  fields && (
                    <div
                      key={server.id}
                      role="status"
                      className={cn(MUTED, "pb-[0.4375rem] leading-[1.6]")}
                    >
                      Enter again for <code>{server.id}</code>:{" "}
                      {fields.map((field, index) => (
                        <Fragment key={field}>
                          {index > 0 && ", "}
                          <CredentialName field={field} />
                        </Fragment>
                      ))}
                      . Credentials aren&apos;t saved, so a reload clears them.
                    </div>
                  )
                );
              })}

              <textarea
                className="w-full resize-y rounded-panel border border-border bg-surface-base px-2.5 py-2 font-pg-code text-[0.75rem] leading-normal text-[var(--text-primary)] [tab-size:2] focus-visible:-outline-offset-1 focus-visible:outline-1 focus-visible:outline-primary"
                value={draft}
                onChange={(ev) => setDraft(ev.target.value)}
                spellCheck={false}
                rows={editorRows(draft)}
                aria-label="MCP server configuration"
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
            </CollapsibleContent>
          </Collapsible>
        </FieldSet>
      )}
    </div>
  );
};

export default Grounding;
