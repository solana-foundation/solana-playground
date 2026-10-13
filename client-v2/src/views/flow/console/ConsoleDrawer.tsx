import type { FC } from "react";
import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import Terminal from "../../main/secondary/terminal/Component/Terminal";
import { PgBuildOutput } from "../../sidebar/assistant/bridge/build-output";
import { PgFlow } from "../state/stage";
import { BOTTOM_BAR_HEIGHT } from "../tokens";
import { describeConsoleStatus } from "./status";
import type { ConsoleStatus } from "./status";

interface ConsoleDrawerProps {
  open: boolean;
  onToggle: () => void;
}

/**
 * The console at the bottom of the centre column. The layout shell folds its
 * panel to the handle's height (`BOTTOM_BAR_PX`, which both read) rather
 * than unmounting it, so the xterm buffer (scrollback, running process)
 * survives while it is closed.
 */
const ConsoleDrawer: FC<ConsoleDrawerProps> = ({ open, onToggle }) => {
  const [status, setStatus] = useState<ConsoleStatus>(() =>
    describeConsoleStatus(PgFlow.state)
  );

  useEffect(() => {
    const b = PgFlow.onDidChange((flow) =>
      setStatus(describeConsoleStatus(flow))
    );
    // `PgBuildOutput` fills in slightly after the `build-finish` event that
    // sets `flow.build`, and it carries the diagnostic code a failed
    // status line needs -- recompute once it lands so a failed build never
    // gets stuck on the bare "build failed" fallback.
    const c = PgBuildOutput.onDidChange(() =>
      setStatus(describeConsoleStatus(PgFlow.state))
    );
    return () => {
      b.dispose();
      c.dispose();
    };
  }, []);

  return (
    <Wrapper>
      <Handle
        type="button"
        aria-expanded={open}
        aria-controls="flow-console-drawer-body"
        aria-label="Console"
        onClick={onToggle}
      >
        {/* \u25be/\u25b8 keep the source ASCII-only: the small
            down-pointing / right-pointing triangles the board uses. */}
        <Glyph aria-hidden>{open ? "\u25be" : "\u25b8"}</Glyph>
        <TextGroup>
          <Label>CONSOLE</Label>
          {status.text && (
            <Status $tone={status.tone}>{` ${status.text}`}</Status>
          )}
        </TextGroup>
        <Hint>&#8984;J</Hint>
      </Handle>
      <Body id="flow-console-drawer-body">
        <Terminal />
      </Body>
    </Wrapper>
  );
};

export default ConsoleDrawer;

// The stage's `Center` is open at the bottom, so this carries the border on
// the sides and bottom and the two read as one surface.
const Wrapper = styled.div`
  ${({ theme }) => css`
    border: 1px solid ${theme.colors.default.border};
    border-top: none;
    border-radius: 0 0 ${theme.default.borderRadius}
      ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
    display: flex;
    flex-direction: column;
    height: 100%;
  `}
`;

const Handle = styled.button`
  ${({ theme }) => css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.5rem;
    height: ${BOTTOM_BAR_HEIGHT};
    padding: 0 0.75rem;
    border: none;
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    cursor: pointer;
    text-align: left;
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
    }
  `}
`;

const Glyph = styled.span`
  display: inline-block;
  font-size: 0.8em;
`;

const TextGroup = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Label = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    font-weight: 600;
    letter-spacing: 0.06em;
  `}
`;

const Status = styled.span<{ $tone: ConsoleStatus["tone"] }>`
  ${({ theme, $tone }) => css`
    color: ${$tone === "error"
      ? theme.colors.state.error.color
      : theme.colors.default.textSecondary};
  `}
`;

const Hint = styled.span`
  margin-left: auto;
  opacity: 0.6;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  /* Terminal's own root has no explicit height; stretch it to fill the
     drawer body so xterm's ResizeObserver sees a real, non-zero size. */
  & > div {
    flex: 1;
    min-height: 0;
  }
`;
