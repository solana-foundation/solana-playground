import "xterm/css/xterm.css";

import { FC, useEffect, useMemo, useRef } from "react";

import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";

import { useExposeStatic, useKeybind } from "../../hooks";
import { resolveColor } from "../../shared/lib/css-color";
import { CommandManager, PgCommon, PgTerm, PgTerminal } from "../../utils";
import type { FlowState } from "../../views/flow/state/stage";
import { PgFlow } from "../../views/flow/state/stage";
import { xtermTheme } from "./terminal-theme";

/**
 * Spec 13's welcome: what the terminal is for, and `help`. A project with no
 * program has no Build or Deploy, so its welcome names the client instead.
 */
const welcomeFor = (flow: Pick<FlowState, "hasProgram">) =>
  [
    flow.hasProgram
      ? "Output from Build, Deploy and your commands shows here."
      : "Output from your client and your commands shows here.",
    `Type ${PgTerminal.bold("help")} to see commands.\n`,
  ].join("\n");

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
      defaultText: welcomeFor(PgFlow.state),
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

  // The explorer says whether the project has a program after the terminal
  // opens, and a project switch can change it: the welcome follows
  useEffect(() => {
    let shown = welcomeFor(PgFlow.state);
    const sub = PgFlow.onDidChange((flow) => {
      const next = welcomeFor(flow);
      if (next === shown) return;
      shown = next;
      term.setDefaultText(next);
    });
    return () => sub.dispose();
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
