import { useEffect, useReducer, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgSession } from "@/features/auth";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { PgBuildOutput } from "../../../views/sidebar/assistant/bridge/build-output";
import { describeLesson } from "../../../views/sidebar/assistant/bridge/lesson-context";
import { realBridge } from "../../../views/sidebar/assistant/bridge/playground-bridge";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { Connection } from "../../../views/sidebar/assistant/store";
import { INITIAL_LESSON_STATE, PgLesson } from "../../../views/flow/lessons";
import type { LessonState } from "../../../views/flow/lessons";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgProgramInfo } from "../../../utils/program-info";
import { modelOptions, modelShown } from "../model/choice";
import type { ModelOption } from "../model/choice";
import { DEFAULT_CONNECTION } from "../model/connection";
import { useDefaultBackend } from "../model/default-backend";
import { assistantTelemetry } from "../model/telemetry";
import { withEffort, withModel } from "../model/tune";
import type { Turn, TurnPhase } from "../model/use-turn";
import {
  BaseAssistantComposer,
  type ComposerContextChip,
} from "./BaseAssistantComposer";
import { BaseEffortMenu } from "./BaseEffortMenu";
import { BaseModelMenu } from "./BaseModelMenu";

const log = createLogger("assistant:composer");

/** What the assistant reads each turn, as chips over the input */
const contextChips = (lessonState: LessonState): ComposerContextChip[] => {
  // Mirror what `describeProject()` actually sends, so the row cannot claim
  // less than the model gets. Paths only — never file content, since this runs
  // on every render, including every streamed token.
  const currentFilePath = PgExplorer.currentFilePath;
  const filePaths = realBridge.listFiles();
  const openPaths = realBridge.listOpenFiles();
  const lesson = describeLesson(lessonState);
  return [
    lesson
      ? {
          label: `step ${lesson.stepIndex} of ${lesson.stepCount}`,
          title: lesson.objective,
        }
      : null,
    {
      label: `${filePaths.length} ${filePaths.length === 1 ? "file" : "files"}`,
      title: `Every path is sent each turn, and the assistant can read any of them:\n\n${filePaths.join(
        "\n"
      )}`,
    },
    openPaths.length > 1
      ? {
          label: `${openPaths.length} open`,
          title: `Your open tabs are named each turn; only the active one is sent in full:\n\n${openPaths.join(
            "\n"
          )}`,
        }
      : null,
    currentFilePath
      ? {
          label: `${PgExplorer.getItemNameFromPath(currentFilePath)} active`,
          title: "The tab you are looking at, sent in full every turn",
        }
      : null,
    PgBuildOutput.latest?.failed
      ? { label: "build error", title: "The last build's compiler output" }
      : null,
    PgProgramInfo.idl
      ? { label: "idl", title: "The built program's interface" }
      : null,
  ].filter((chip): chip is ComposerContextChip => !!chip);
};

/** The input's placeholder, by where the turn is */
const PLACEHOLDERS: Record<TurnPhase, string> = {
  idle: "Ask about this project…",
  running: "Working…",
  awaiting: "Waiting on your decision…",
  stopping: "Stopping…",
};

/**
 * The assistant's composer, connected: the context it reads, the model and
 * effort menus, and the turn shared with the thread.
 */
export function AssistantComposer({ turn }: { turn: Turn }) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgAssistant.onDidChange(render).dispose, []);

  const [lessonState, setLessonState] =
    useState<LessonState>(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLessonState).dispose, []);

  const defaultBackend = useDefaultBackend();
  const connection = PgAssistant.connection;
  const shown = modelShown(connection, defaultBackend);

  /**
   * Apply a model or effort pick, then `track` it. Nothing when `next` is
   * `null` (nothing changed), or the store would refuse it.
   *
   * The refusal is asked first rather than caught: a throw from something
   * reacting to the change comes after the change is made, so it is neither
   * a refusal nor a reason to leave the pick untracked.
   */
  const tune = (next: Connection | null, track: () => void) => {
    if (!next) return;
    if (!PgAssistant.canTune(next)) {
      // `tune` refuses a change of backend or key; the menus only offer the
      // connected one's, so this is a bug to hear of, not a user's mistake
      log.error(new Error("tune refused the composer's pick"), {
        report: true,
        context: { provider: next.id },
      });
      return;
    }
    try {
      PgAssistant.tune(next);
    } finally {
      track();
    }
  };

  const pick = (option: ModelOption) => {
    if (option.provider === "default") {
      if (connection?.id === "default") return;
      // The default answers only a signed-in user: Connect a model, opened on
      // it, offers the sign-in and leaves the current backend until then
      if (!PgSession.get()) {
        turn.openConnect("model", { provider: "default" });
        return;
      }
      // From a keyed backend this is a change of backend; the conversation
      // carries over, as it does on every connect
      PgAssistant.connect(DEFAULT_CONNECTION);
      assistantTelemetry.track("assistant_model_picked", {
        provider: "default",
        via: "menu",
      });
      return;
    }
    if (connection?.id !== option.provider) {
      // Another backend needs its key, so Connect a model asks for it, opened
      // on that backend and model
      turn.openConnect("model", {
        provider: option.provider,
        model: option.model,
      });
      return;
    }
    tune(withModel(connection, option.model), () =>
      assistantTelemetry.track("assistant_model_picked", {
        provider: option.provider,
        via: "menu",
      })
    );
  };

  const effort =
    shown.kind === "keyed" && shown.effort && connection ? (
      <BaseEffortMenu
        effort={shown.effort}
        disabled={turn.busy}
        onChange={(next) =>
          tune(withEffort(connection, next), () =>
            assistantTelemetry.track("assistant_effort_changed", {
              effort: next,
            })
          )
        }
      />
    ) : null;

  return (
    <div className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-3">
      {turn.promptWaiting && (
        <Callout variant="info" role="status">
          <CalloutDescription>
            {/* No default to sign in for: the model is the one way in */}
            {shown.kind === "none"
              ? "Connect a model to send this to the assistant."
              : "Connect a backend, or sign in for the default one, to send this to the assistant."}{" "}
            Your prompt is waiting in the composer.
          </CalloutDescription>
        </Callout>
      )}
      <BaseAssistantComposer
        chips={contextChips(lessonState)}
        value={turn.input}
        onValueChange={turn.setInput}
        onSend={(text) => {
          void turn.send(text);
        }}
        onStop={turn.stop}
        busy={turn.busy}
        placeholder={PLACEHOLDERS[turn.phase]}
        model={
          <BaseModelMenu
            model={shown}
            options={modelOptions(defaultBackend)}
            onPick={pick}
            // "Connect a model" on the button and "Connect with a key…" in
            // its menu: both are the model chip's; "menu" is the head's More
            onConnect={() => turn.openConnect("model")}
            disabled={turn.busy}
          />
        }
        effort={effort}
        focusRequest={turn.focusRequest}
        // The deployment serves no default and nothing is connected: the model
        // button reads "Connect a model" and is the way in, so Send waits for
        // it. A default the probe could not reach keeps Send, whose send asks
        // again
        sendBlocked={
          shown.kind === "none" && defaultBackend.state === "absent"
            ? "Connect a model to send"
            : null
        }
      />
    </div>
  );
}
