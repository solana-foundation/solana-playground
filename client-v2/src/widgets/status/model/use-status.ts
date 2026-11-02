import { useSyncExternalStore } from "react";

import type { AnalyzerState } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";
import { PgAnalyzerStatus } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";
import { PgSession } from "@/features/auth";
import { useRenderOnChange } from "@/hooks";
import { useElapsed } from "@/shared/lib/hooks/use-elapsed";
import { useOnline } from "@/shared/lib/hooks/use-online";
import { PgConnection } from "@/utils";
import { displayModelName } from "@/views/sidebar/assistant/model/labels";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import type { AiInput, StatusIndicator } from "./indicators";
import { aiIndicator, analyzerIndicator, networkIndicator } from "./indicators";

const subscribeAnalyzer = (cb: () => void) =>
  PgAnalyzerStatus.onDidChange(() => cb()).dispose;

const useAnalyzer = (): AnalyzerState =>
  useSyncExternalStore(subscribeAnalyzer, PgAnalyzerStatus.get);

/** The AI as the indicator reads it, from the live connection and session */
const aiInput = (): AiInput => {
  const connection = PgAssistant.connection;
  if (!connection || PgAssistant.needsSignIn) {
    return { kind: "off", needsSignIn: PgAssistant.needsSignIn };
  }
  const model =
    connection.endpoint?.model ?? connection.settings?.model ?? connection.id;
  return { kind: "ready", model: displayModelName(model) };
};

/** The network, the AI and the Rust analyzer, in that order, kept current */
export const useStatus = (): StatusIndicator[] => {
  const cluster = useRenderOnChange(PgConnection.onDidChangeCluster);
  const isConnected = useRenderOnChange(PgConnection.onDidChangeIsConnected);
  const slotStalled = useRenderOnChange(PgConnection.onDidChangeIsClusterDown);
  useRenderOnChange(PgAssistant.onDidChange);
  useRenderOnChange(PgSession.onDidChange);
  const analyzer = useAnalyzer();
  const online = useOnline();
  const since = analyzer.kind === "starting" ? analyzer.since : null;
  // Ticks only while the analyzer starts; the model reads the seconds from it
  const elapsed = useElapsed(since);
  const now = since === null ? Date.now() : since + (elapsed ?? 0);

  return [
    networkIndicator(
      { name: cluster ?? "unknown", isConnected, slotStalled },
      online
    ),
    aiIndicator(aiInput(), online),
    analyzerIndicator(analyzer, now, online),
  ];
};
