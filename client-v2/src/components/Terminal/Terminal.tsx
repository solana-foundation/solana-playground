import { FC, useEffect, useMemo, useRef } from "react";
import styled, { css, useTheme } from "styled-components";
import "xterm/css/xterm.css";

import { GITHUB_URL, PROJECT_NAME } from "../../constants";
import { useExposeStatic, useKeybind } from "../../hooks";
import {
  CommandManager,
  PgCommon,
  PgTerm,
  PgTerminal,
  PgTheme,
} from "../../utils";
import { resolveColor } from "../../shared/lib/css-color";
import { xtermTheme } from "./terminal-theme";

interface TerminalProps {
  cmdManager: CommandManager;
}

const Terminal: FC<React.PropsWithChildren<TerminalProps>> = ({
  cmdManager,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);

  const theme = useTheme();

  // Create xterm
  const term = useMemo(() => {
    const xterm = theme.components.terminal.xterm;

    return new PgTerm(cmdManager, {
      defaultText: [
        `Welcome to ${PgTerminal.bold(PROJECT_NAME)}.`,
        `Popular crates for Solana development are available to use.`,
        `See the list of available crates and request new crates from ${PgTerminal.underline(
          GITHUB_URL
        )}`,
        `Type ${PgTerminal.bold("help")} to see all commands.\n`,
      ].join("\n\n"),
      xterm: {
        convertEol: true,
        rendererType: "dom",
        fontFamily: theme.font.code.family,
        fontSize: 14,
        cursorBlink: xterm.cursor.blink,
        cursorStyle: xterm.cursor.kind,
        tabStopWidth: 4,
        theme: xtermTheme(xterm, resolveColor),
      },
    });
    // The theme is applied in place below; rebuilding would drop the output
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmdManager]);

  useEffect(() => {
    term.setAppearance({
      theme: xtermTheme(theme.components.terminal.xterm, resolveColor),
      fontFamily: theme.font.code.family,
    });
  }, [term, theme]);

  useExposeStatic(PgTerminal.events.STATIC, term);

  // Open terminal
  useEffect(() => {
    if (terminalRef.current) {
      if (terminalRef.current.hasChildNodes()) {
        terminalRef.current.removeChild(terminalRef.current.childNodes[0]);
      }

      term.open(terminalRef.current);
    }
  }, [term]);

  // Handle resize
  useEffect(() => {
    const terminalEl = terminalRef.current!;
    const observer = new ResizeObserver(
      PgCommon.throttle(() => term.fit(), 200)
    );
    observer.observe(terminalEl);
    return () => observer.unobserve(terminalEl);
  }, [term]);

  useKeybind(
    "Ctrl+L",
    () => {
      if (PgTerminal.isFocused()) term.clear();
    },
    [term]
  );

  return <Wrapper ref={terminalRef} />;
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.terminal.default)};

    & .xterm {
      padding: 0.25rem 1rem;
    }

    & .xterm-viewport {
      background: inherit !important;
      width: 100% !important;
    }
  `}
`;

export default Terminal;
