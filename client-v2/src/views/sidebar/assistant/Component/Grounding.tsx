import { useState } from "react";
import styled, { css } from "styled-components";

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
    <Wrapper>
      <Section>
        <Heading>SKILLS</Heading>
        <Lead>
          Reference documents the assistant loads when it decides it needs them.
          Only the names and descriptions below sit in the prompt.
        </Lead>

        {SKILLS.map((skill) => (
          <Row key={skill.id}>
            <Label>
              <Checkbox
                checked={enabledSkills.includes(skill.id)}
                onCheckedChange={(checked) =>
                  PgAssistant.setSkillEnabled(skill.id, checked === true)
                }
              />
              {skill.name}
            </Label>
            <RowNote>
              {skill.source.type === "bundled"
                ? "bundled — always available"
                : "fetched from GitHub when loaded"}
            </RowNote>
          </Row>
        ))}
      </Section>

      <Section>
        <Heading>MCP SERVERS</Heading>
        <Lead>
          Tools from remote servers, available to whichever backend is
          connected. This page calls each one itself, directly or through the
          gateway at <code>/api/mcp</code> for a host that refuses the browser.
        </Lead>

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
          <Active>
            No servers. The gateway reports which ones it serves, so an empty
            list means it is not running (use <code>yarn dev</code>) or has none
            configured.
          </Active>
        )}

        <Heading>ADDITIONAL SERVERS</Heading>
        <Active>
          The gateway above owns its own list — these are extra entries, and
          they are the only ones this editor changes.
        </Active>

        {PgAssistant.shadowedMcpServers.map((server) => (
          <Active key={server.id} role="status">
            Not used: the gateway serves a server with the id{" "}
            <code>{server.id}</code>, which replaces this entry. Rename the
            entry to use both.
          </Active>
        ))}

        <Json
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          spellCheck={false}
          rows={16}
          aria-label="MCP server configuration"
        />

        {error && <ErrorText role="alert">{error}</ErrorText>}

        <Actions>
          <Action onClick={apply} disabled={!dirty}>
            {dirty ? "Apply" : "Applied"}
          </Action>
          <Action onClick={reset}>Reset to defaults</Action>
        </Actions>

        <Note>
          <code>authToken</code> is sent as a bearer token.{" "}
          <code>queryParams</code> rides in the URL: the only way to pass a
          credential a server wants outside the Authorization header, such as a
          bot-protection bypass, and the only way past a CORS policy that does
          not allow that header name. <code>headers</code> is sent on every
          request. A header the server&apos;s Access-Control-Allow-Headers omits
          will fail the preflight rather than be ignored.
        </Note>
      </Section>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1rem;
`;

const Section = styled.div`
  &:not(:first-child) {
    padding-top: 1.75rem;
  }
`;

const Heading = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    letter-spacing: 0.1em;
    padding-bottom: 0.4375rem;
  `}
`;

const Lead = styled.div`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.6;
    padding-bottom: 0.875rem;
  `}
`;

const Row = styled.div`
  padding-bottom: 0.75rem;
`;

const RowNote = styled.div`
  ${({ theme }) => css`
    padding-left: 1.25rem;
    padding-top: 0.1875rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const Active = styled.div`
  ${({ theme }) => css`
    padding-bottom: 0.4375rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
  `}
`;

const Json = styled.textarea`
  ${({ theme }) => css`
    width: 100%;
    resize: vertical;
    padding: 0.5rem 0.625rem;
    background: ${theme.colors.default.bgPrimary};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    color: ${theme.colors.default.textPrimary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    line-height: 1.5;
    tab-size: 2;

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: -1px;
    }
  `}
`;

const ErrorText = styled.div`
  ${({ theme }) => css`
    padding-top: 0.4375rem;
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.5;
  `}
`;

const Actions = styled.div`
  display: flex;
  gap: 0.375rem;
  padding-top: 0.625rem;
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

const Note = styled.div`
  ${({ theme }) => css`
    padding-top: 0.875rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    line-height: 1.6;

    & code {
      font-family: ${theme.font.code.family};
    }
  `}
`;

export default Grounding;
