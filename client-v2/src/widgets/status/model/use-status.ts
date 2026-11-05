import { useSyncExternalStore } from "react";

import type { AnalyzerState } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";
import { PgAnalyzerStatus } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";
import { useSelectedConnection } from "@/entities/cluster";
import { PgSession } from "@/features/auth";
import { useRenderOnChange } from "@/hooks";
import { useElapsed } from "@/shared/lib/hooks/use-elapsed";
import { useOnline } from "@/shared/lib/hooks/use-online";
import { PgFlow } from "@/views/flow/state/stage";
import { displayModelName } from "@/views/sidebar/assistant/model/labels";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import type {
  AiInput,
  NetworkInput,
  RunUnderWay,
  StatusIndicator,
} from "./indicators";
import {
  aiIndicator,
  analyzerIndicator,
  holdingReload,
  networkIndicator,
} from "./indicators";
import { networkHold } from "./notice";

const subscribeAnalyzer = (cb: () => void) =>
  PgAnalyzerStatus.onDidChange(() => cb()).dispose;

const useAnalyzer = (): AnalyzerState =>
  useSyncExternalStore(subscribeAnalyzer, PgAnalyzerStatus.get);

const subscribeFlow = (cb: () => void) =>
  PgFlow.onDidChange(() => cb()).dispose;

/** The build or the deploy running now, which a reload would throw away */
const useRunUnderWay = (): RunUnderWay | undefined => {
  const flow = useSyncExternalStore(subscribeFlow, () => PgFlow.state);
  if (flow.build === "running") return "build";
  return flow.deploy === "running" ? "deploy" : undefined;
};

/** The AI as the indicator reads it, from the live connection and session */
const aiInput = (): AiInput => {
  const connection = PgAssistant.connection;
  // Only with nothing connected: a connected backend is asked by its turns
  if (!connection && PgAssistant.defaultProbe === "unreachable") {
    return { kind: "unreachable" };
  }
  if (!connection || PgAssistant.needsSignIn) {
    return { kind: "off", needsSignIn: PgAssistant.needsSignIn };
  }
  const until = PgAssistant.limitReachedUntil;
  if (until !== undefined) return { kind: "limit", until };
  const model =
    connection.endpoint?.model ?? connection.settings?.model ?? connection.id;
  return { kind: "ready", model: displayModelName(model) };
};

/** The cluster as the network indicator and the stage notice read it */
export const useNetworkInput = (): NetworkInput => {
  const { cluster, isConnected, isClusterDown } = useSelectedConnection();
  return {
    name: cluster ?? "unknown",
    isConnected,
    slotStalled: isClusterDown,
  };
};

/** Why Deploy and Interact's action is held right now, if it is */
export const useNetworkHold = (): string | undefined =>
  networkHold(useNetworkInput(), useOnline());

/** The network, the AI and the Rust analyzer, in that order, kept current */
export const useStatus = (): StatusIndicator[] => {
  const network = useNetworkInput();
  useRenderOnChange(PgAssistant.onDidChange);
  useRenderOnChange(PgSession.onDidChange);
  const analyzer = useAnalyzer();
  const online = useOnline();
  const run = useRunUnderWay();
  const since = analyzer.kind === "starting" ? analyzer.since : undefined;
  // Ticks only while the analyzer starts; the model reads the seconds from it
  const elapsed = useElapsed(since);
  const now = since === undefined ? Date.now() : since + (elapsed ?? 0);

  const rust = analyzerIndicator(analyzer, now, online);
  return [
    networkIndicator(network, online),
    aiIndicator(aiInput(), online),
    run ? holdingReload(rust, run) : rust,
  ];
};
