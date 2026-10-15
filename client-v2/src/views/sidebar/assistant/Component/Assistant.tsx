import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import Chat from "./Chat";
import Grounding from "./Grounding";
import { PgAssistant } from "../store";
import { PgBuildOutput } from "../bridge/build-output";
import { PgExplorer } from "../../../../utils";

type Tab = "chat" | "sources";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "sources", label: "Sources" },
];

const Assistant = () => {
  const [tab, setTab] = useState<Tab>("chat");

  // Mirrors the two inputs `Chat.tsx`'s own CONTEXT row reads off
  // (`PgExplorer.currentFilePath`, `PgBuildOutput.latest?.failed`) so the
  // header chip can never claim something the chat context does not also
  // see -- kept live here rather than imported, since the header renders
  // above `Chat` and outlives a backend not being connected yet.
  const [currentFilePath, setCurrentFilePath] = useState(
    PgExplorer.currentFilePath
  );
  const [buildFailed, setBuildFailed] = useState(
    !!PgBuildOutput.latest?.failed
  );

  // Ask the gateway what it serves and what those servers offer. Has to happen
  // here rather than only in the Sources tab: `createTools` reads the result,
  // so a model connected before this ran would be offered no MCP tool at all,
  // with nothing on screen to say why.
  useEffect(() => {
    PgAssistant.initMcp();
  }, []);

  // A prompt raised from another tab (a Sources tool call, say) lands in the
  // composer, which is no use while that other tab is still on screen
  useEffect(() => {
    return PgAssistant.onDidRequestPrompt(() => setTab("chat")).dispose;
  }, []);

  useEffect(() => {
    const a = PgExplorer.onDidOpenFile(() =>
      setCurrentFilePath(PgExplorer.currentFilePath)
    );
    const b = PgBuildOutput.onDidChange((out) => setBuildFailed(!!out?.failed));
    return () => {
      a.dispose();
      b.dispose();
    };
  }, []);

  const fileName = currentFilePath
    ? PgExplorer.getItemNameFromPath(currentFilePath)
    : null;
  // The cluster lives in the app header; only the build state is worth
  // repeating here.
  const statusLabel = buildFailed ? "build error" : null;

  return (
    <Wrapper>
      <Header>
        <HeaderEyebrow>Assistant</HeaderEyebrow>
        <HeaderMeta>
          {fileName && <HeaderChip>{fileName}</HeaderChip>}
          {statusLabel && <HeaderChip>{statusLabel}</HeaderChip>}
        </HeaderMeta>
      </Header>

      <Tabs role="tablist" aria-label="Assistant sections">
        {TABS.map(({ id, label }) => (
          <TabButton
            key={id}
            role="tab"
            aria-selected={tab === id}
            $active={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </TabButton>
        ))}
      </Tabs>

      {tab === "chat" && <Chat />}
      {tab === "sources" && <Grounding />}
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  /* Fill the sidebar whether it hands us a flex slot or a definite height */
  flex: 1;
  height: 100%;
  max-height: 100%;
  min-height: 0;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  /* A host may reserve room on the left for its own control (Flow's
     collapse handle sets --flow-handle-inset); elsewhere it is 0. */
  padding: 0.625rem 0.75rem 0.5rem calc(0.75rem + var(--flow-handle-inset, 0px));
  flex-shrink: 0;
`;

const HeaderEyebrow = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.xsmall};
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const HeaderMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  overflow: hidden;
`;

const HeaderChip = styled.span`
  ${({ theme }) => css`
    overflow: hidden;
    max-width: 8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.0625rem 0.4375rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.xsmall};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Tabs = styled.div`
  ${({ theme }) => css`
    display: flex;
    gap: 0.25rem;
    padding: 0 0.75rem;
    flex-shrink: 0;
    /* Labels can still overflow the narrowest sidebar width */
    overflow-x: auto;
    border-bottom: 1px solid ${theme.colors.default.border};
  `}
`;

const TabButton = styled.button<{ $active: boolean }>`
  ${({ theme, $active }) => css`
    padding: 0.4375rem 0.5625rem 0.375rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid
      ${$active ? theme.colors.default.primary : "transparent"};
    color: ${$active
      ? theme.colors.default.textPrimary
      : theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.xsmall};
    white-space: nowrap;
    cursor: pointer;
    transition: color ${theme.default.transition.duration.medium}
        ${theme.default.transition.type},
      border-color ${theme.default.transition.duration.medium}
        ${theme.default.transition.type};

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }

    &:focus-visible {
      outline: 1px solid ${theme.colors.default.primary};
      outline-offset: -1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

export default Assistant;
