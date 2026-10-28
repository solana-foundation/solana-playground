import { FC, useEffect, useMemo, useRef } from "react";
import styled, { css, useTheme } from "styled-components";
import "xterm/css/xterm.css";

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
      // Spec 13's welcome: what the terminal is for, and `help`
      defaultText: [
        "Output from Build, Deploy and your commands shows here.",
        `Type ${PgTerminal.bold("help")} to see commands.\n`,
      ].join("\n"),
      xterm: {
        convertEol: true,
        rendererType: "dom",
        fontFamily: theme.font.code.family,
        fontSize: 13,
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

  // Open terminal. `PgTerm.open` prints the welcome and a prompt, which no
  // cleanup can take back, so a term is opened once: StrictMode's second run
  // of this effect in dev keeps the same `term` and must leave it alone.
  const openedRef = useRef<PgTerm | null>(null);
  useEffect(() => {
    if (!terminalRef.current || openedRef.current === term) return;

    if (terminalRef.current.hasChildNodes()) {
      terminalRef.current.removeChild(terminalRef.current.childNodes[0]);
    }

    term.open(terminalRef.current);
    openedRef.current = term;
  }, [term]);

  // Handle resize
  useEffect(() => {
    const terminalEl = terminalRef.current!;
    // Off the page (the work kept under Home, a phone page not shown) the
    // node measures 0 and xterm throws on the columns that gives; it is
    // fitted again when it comes back and its size changes
    const observer = new ResizeObserver(
      PgCommon.throttle(() => {
        if (terminalEl.isConnected) term.fit();
      }, 200)
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

    /* Same ground as xterm's background, so the padding around the rows
       matches the screen */
    background: var(--surface-well);

    & .xterm {
      padding: 0.75rem;
    }

    & .xterm-viewport {
      background: inherit !important;
      width: 100% !important;
    }
  `}
`;

export default Terminal;
