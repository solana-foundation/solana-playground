import { useEffect } from "react";

import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { isSignInFailure, PgSession } from "@/features/auth";
import { useRenderOnChange, useWallet } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { shortAddress } from "@/shared/lib/short-address";
import { PgCommand, PgConnection, PgView } from "@/utils";
import { SETTINGS_TRIGGER_ATTR } from "@/shared/lib/settings-request";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { SETUP_STEPS } from "../model/steps";
import type { SetupStep, StepView } from "../model/steps";
import { setupMarks, useSetupMarks } from "../model/storage";
import { setupTelemetry } from "../model/telemetry";
import BaseSetupList from "./BaseSetupList";

const log = createLogger("setup-list:actions");

const warnWallet = () =>
  PgView.setToast(
    () => (
      <span>
        <strong>Couldn't connect the wallet.</strong> The console has the
        details.
      </span>
    ),
    { options: { name: "wallet-failed" } }
  );

export interface SetupListProps {
  /** Opens Connect a model; the assistant widget owns it */
  onConnectAssistant: () => void;
  /** Opens the settings on the network; the layout owns them */
  onChooseNetwork: () => void;
  /** Starts folded to its title (the phone's menu page) */
  folded?: boolean;
}

/**
 * "Get set up": the four steps' live state, and their actions. Gone for good
 * on this device once dismissed, or once all four were done together.
 */
const SetupList = ({
  onConnectAssistant,
  onChooseNetwork,
  folded,
}: SetupListProps) => {
  const marks = useSetupMarks();
  const cluster = useRenderOnChange(PgConnection.onDidChangeCluster);
  useRenderOnChange(PgSession.onDidChange);
  useRenderOnChange(PgAssistant.onDidChange);
  const wallet = useWallet();
  const user = PgSession.get();

  // Keyed by step, so a new step without a state does not compile
  const states: Record<SetupStep, Omit<StepView, "step">> = {
    assistant: { done: PgAssistant.isConnected },
    network: { done: marks.networkChosen, value: cluster ?? undefined },
    github: { done: !!user, value: user?.login ?? undefined },
    wallet: {
      done: !!wallet,
      value: wallet ? shortAddress(wallet.publicKey.toBase58()) : undefined,
    },
  };
  const steps: StepView[] = SETUP_STEPS.map((step) => ({
    step,
    done: states[step].done,
    value: states[step].value,
  }));
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;

  useEffect(() => {
    if (!allDone || setupMarks.get().completed) return;
    setupMarks.mark("completed");
    setupTelemetry.track("setup_completed", {});
  }, [allDone]);

  // Keyed by step, so a new step without an action does not compile
  const actions: Record<SetupStep, () => void> = {
    assistant: onConnectAssistant,
    network: onChooseNetwork,
    github: () => {
      PgSession.signIn().catch((error: unknown) => {
        // `PgSession.signInState` holds every failure (a known step, or
        // `request-failed`) and the account row shows it; `auth` telemetry has
        // its reason
        if (isSignInFailure(error)) {
          log.info("sign-in failed", { context: { error: String(error) } });
          return;
        }
        log.error(error, { report: true, context: { step: "github" } });
      });
    },
    wallet: () => {
      // Rejects when the user closes the setup, which is their choice
      PgCommand.connect.execute().catch((error: unknown) => {
        if (isSetupRejected(error)) {
          log.info("wallet setup dismissed");
          return;
        }
        log.error(error, { report: true, context: { step: "wallet" } });
        warnWallet();
      });
    },
  };

  const pick = (step: SetupStep) => {
    setupTelemetry.track("setup_item_picked", { item: step });
    actions[step]();
  };

  const dismiss = () => {
    setupTelemetry.track("setup_dismissed", { done });
    setupMarks.mark("dismissed");
  };

  // `allDone` too: the effect marks completion after this render, and the
  // list must not flash in between
  if (marks.dismissed || marks.completed || allDone) return null;

  return (
    <BaseSetupList
      steps={steps}
      onPick={pick}
      onDismiss={dismiss}
      folded={folded}
      // The network step opens the settings, so it is marked as their trigger,
      // as tests find the triggers
      stepAttrs={{ network: { [SETTINGS_TRIGGER_ATTR]: "" } }}
    />
  );
};

export default SetupList;
