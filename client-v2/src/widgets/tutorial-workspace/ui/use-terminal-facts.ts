import { useEffect, useState } from "react";

import { PgExplorer, PgProgramInfo } from "@/utils";
import { PgBuildOutput } from "@/views/sidebar/assistant/bridge/build-output";
import { parseBuildReport } from "@/views/flow/stages/build-report";
import { PgFlow } from "@/views/flow/state/stage";
import { restoredRun, stepFacts } from "../model/terminal";
import type { TerminalFacts, Verdicts } from "../model/terminal";

/**
 * The first diagnostic of the open workspace's last failed build, if the
 * compiler named one. The output outlives a switch of workspace, so one
 * another workspace produced says nothing about this one's code.
 */
export const firstDiagnostic = () => {
  const out = PgBuildOutput.latest;
  if (!out?.failed || out.workspace !== PgExplorer.currentWorkspaceName) {
    return null;
  }
  return parseBuildReport(out.stderr).diagnostics[0] ?? null;
};

/** What the output and the program say at the moment a verdict is read */
const verdicts = (): Verdicts => ({
  failedLine: firstDiagnostic()?.line ?? null,
  instructions: PgProgramInfo.idl?.instructions.map((ix) => ix.name) ?? [],
});

const contentOf = (path: string) => {
  const full = PgExplorer.convertToFullPath(path);
  return PgExplorer.files[full] ? PgExplorer.getFileContent(full) ?? "" : null;
};

const readBack = (): TerminalFacts => ({
  running: null,
  last: restoredRun(PgFlow.state, verdicts()),
  changed: null,
});

/**
 * The terminal bar's facts for the open tutorial, kept up from `PgFlow`, the
 * build's output and the explorer's saves (`model/terminal.ts`, `stepFacts`).
 * A save that makes one of `files` differ from what the last good deploy
 * shipped turns the bar amber. The deployed copy belongs to the visit and to
 * `tutorial`, which resets it, so after a reload or a switch no edit reads
 * as amber until the next deploy.
 */
export const useTerminalFacts = (
  tutorial: string,
  files: string[]
): TerminalFacts => {
  const [facts, setFacts] = useState<TerminalFacts>(readBack);
  const key = files.join("\n");

  useEffect(() => {
    const paths = key ? key.split("\n") : [];
    let prev = PgFlow.state;
    let current = readBack();
    let deployed: Map<string, string | null> | null = null;
    const changedFile = () => {
      if (!deployed) return null;
      for (const [path, content] of deployed) {
        if (contentOf(path) !== content) return path.split("/").pop() ?? path;
      }
      return null;
    };
    const publish = (next: TerminalFacts) => {
      current = next;
      setFacts(next);
    };
    publish(current);

    const flow = PgFlow.onDidChange((next) => {
      const step = stepFacts(current, prev, next, verdicts());
      prev = next;
      if (step.deployed === "take") {
        deployed = new Map(paths.map((p) => [p, contentOf(p)]));
      } else if (step.deployed === "drop") deployed = null;
      publish({ ...step.facts, changed: changedFile() });
    });
    // The failed build's line comes with its output, a moment after the event
    const output = PgBuildOutput.onDidChange(() => {
      const last = current.last;
      if (last?.kind !== "build" || last.ok) return;
      publish({ ...current, last: { ...last, line: verdicts().failedLine } });
    });
    const saved = PgExplorer.onDidSaveFile(() =>
      publish({ ...current, changed: changedFile() })
    );
    return () => {
      flow.dispose();
      output.dispose();
      saved.dispose();
    };
  }, [tutorial, key]);

  return facts;
};
