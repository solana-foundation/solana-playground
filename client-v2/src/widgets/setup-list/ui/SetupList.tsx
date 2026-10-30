import { useEffect } from "react";

import { isSetupRejected } from "@/commands/connect/setup-rejected";
import { isSignInFailure, PgSession } from "@/features/auth";
import { useRenderOnChange, useWallet } from "@/hooks";
import { createLogger } from "@/shared/lib/logger";
import { shortAddress } from "@/shared/lib/short-address";
import { PgCommand, PgConnection, PgView } from "@/utils";
import { PgAssistant } from "@/views/sidebar/assistant/store";
import { SETUP_STEPS } from "../model/steps";
import type { StepView, TodoStep } from "../model/steps";
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
  /**
   * The fold while the user has kept none on this device: folded to its title
   * on the phone's menu page, which is the whole screen, so the prototype keeps
   * the list to one line there. Once the user folds or unfolds it anywhere,
   * that fold is the device's.
   */
  defaultFolded?: boolean;
}

/**
 * "Get set up": the four steps' live state, and their actions. Folded as the
 * user last left it on this device; gone for good on it once dismissed, or
 * once all four were done together.
 */
const SetupList = ({
  onConnectAssistant,
  defaultFolded = false,
}: SetupListProps) => {
  const marks = useSetupMarks();
  const cluster = useRenderOnChange(PgConnection.onDidChangeCluster);
  useRenderOnChange(PgSession.onDidChange);
  useRenderOnChange(PgAssistant.onDidChange);
  const wallet = useWallet();
  const user = PgSession.get();

  // Keyed by step, so a new step without a state does not compile
  const states: Record<TodoStep, { done: boolean; value?: string }> = {
    assistant: { done: PgAssistant.isConnected },
    github: { done: !!user, value: user?.login ?? undefined },
    wallet: {
      done: !!wallet,
      value: wallet ? shortAddress(wallet.publicKey.toBase58()) : undefined,
    },
  };
  const steps: StepView[] = SETUP_STEPS.map((step): StepView => {
    // A network is always chosen: Devnet until the user picks another
    if (step === "network") {
      return { step, done: true, value: cluster ?? undefined };
    }
    const { done, value } = states[step];
    return done ? { step, done, value } : { step, done };
  });
  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;

  useEffect(() => {
    if (!allDone || setupMarks.get().completed) return;
    setupMarks.mark("completed");
    setupTelemetry.track("setup_completed", {});
  }, [allDone]);

  // Keyed by step, so a new step without an action does not compile
  const actions: Record<TodoStep, () => void> = {
    assistant: onConnectAssistant,
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

  const pick = (step: TodoStep) => {
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
      folded={marks.folded ?? defaultFolded}
      onFold={setupMarks.fold}
    />
  );
};

export default SetupList;
