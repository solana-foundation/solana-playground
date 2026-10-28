import { FC, useEffect, useMemo, useRef } from "react";
import "xterm/css/xterm.css";

import { GITHUB_URL, PROJECT_NAME } from "../../constants";
import { useExposeStatic, useKeybind } from "../../hooks";
import { CommandManager, PgCommon, PgTerm, PgTerminal } from "../../utils";
import { resolveColor } from "../../shared/lib/css-color";
import { xtermTheme } from "./terminal-theme";
import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";

interface TerminalProps {
  cmdManager: CommandManager;
}

const Terminal: FC<React.PropsWithChildren<TerminalProps>> = ({
  cmdManager,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);

  const theme = usePgTheme();

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

  // Same ground as xterm's background, so the padding around the rows
  // matches the screen
  return (
    <div
      ref={terminalRef}
      className="bg-surface-well [&_.xterm]:p-3 [&_.xterm-viewport]:w-full! [&_.xterm-viewport]:bg-inherit!"
    />
  );
};

export default Terminal;
