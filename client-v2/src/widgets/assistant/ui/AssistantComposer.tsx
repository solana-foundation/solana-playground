import { useEffect, useReducer, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { isSignInFailure, PgSession } from "@/features/auth";
import { Callout, CalloutDescription } from "@/shared/ui/callout";

import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgProgramInfo } from "../../../utils/program-info";
import type { LessonState } from "../../../views/flow/lessons";
import { INITIAL_LESSON_STATE, PgLesson } from "../../../views/flow/lessons";
import { PgBuildOutput } from "../../../views/sidebar/assistant/bridge/build-output";
import { describeLesson } from "../../../views/sidebar/assistant/bridge/lesson-context";
import { realBridge } from "../../../views/sidebar/assistant/bridge/playground-bridge";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import { PgAssistantContext } from "@/entities/assistant-context";
import type { Connection } from "../../../views/sidebar/assistant/store";
import { INITIAL_LESSON_STATE, PgLesson } from "../../../views/flow/lessons";
import type { LessonState } from "../../../views/flow/lessons";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgProgramInfo } from "../../../utils/program-info";
import { aiOff } from "../model/ai-off";
import type { AiOffInput, AiOffReason } from "../model/ai-off";
import { modelOptions, modelShown } from "../model/choice";
import type { ModelOption } from "../model/choice";
import { connectLabel, DEFAULT_CONNECTION } from "../model/connection";
import {
  retryDefaultBackend,
  useDefaultBackend,
} from "../model/default-backend";
import { assistantTelemetry } from "../model/telemetry";
import { withEffort, withModel } from "../model/tune";
import type { Turn, TurnPhase } from "../model/use-turn";
import {
  BaseAssistantComposer,
  type ComposerContextChip,
} from "./BaseAssistantComposer";
import { AI_OFF_SEND_BLOCKED, BaseAiOffRow } from "./BaseAiOffRow";
import { BaseEffortMenu } from "./BaseEffortMenu";
import { BaseModelMenu } from "./BaseModelMenu";

const log = createLogger("assistant:composer");

/** How a chip names what it sends, for a screen reader */
const sent = (what: string) => `Sent with this message: ${what}`;

/** The workspace a context choice belongs to, by its stable id */
const workspace = () => PgExplorer.currentWorkspaceId ?? null;

/**
 * What the assistant reads each turn, as chips over the input: the lesson
 * step, one chip per file in the context (each removable until it is added
 * back), the build error and the IDL.
 *
 * Mirrors what `describeProject()` sends, so the row cannot claim less than
 * the model gets. Paths only, never file content: this runs on every render,
 * including every streamed token.
 */
const contextChips = (
  lessonState: LessonState,
  contextFiles: readonly string[]
): ComposerContextChip[] => {
  const lesson = describeLesson(lessonState);
  const files = contextFiles.map((path): ComposerContextChip => {
    const name = PgExplorer.getItemNameFromPath(path);
    return {
      label: name,
      title: `${path}\nSent in full with every message`,
      spoken: sent(`${name}, in full`),
      remove: {
        label: `Remove ${name} from the context`,
        run: () => {
          PgAssistantContext.remove(workspace(), path);
          assistantTelemetry.track("assistant_file_chip_removed", {});
        },
      },
    };
  });
  // Where you are, the files (tabs in tab order, then the added ones),
  // then what else is sent
  return [
    lesson
      ? {
          label: `Step ${lesson.stepIndex} of ${lesson.stepCount}`,
          title: lesson.objective,
          spoken: sent(
            `step ${lesson.stepIndex} of ${lesson.stepCount} and its goal`
          ),
        }
      : null,
    ...files,
    PgBuildOutput.latest?.failed
      ? {
          label: "build error",
          title: "The last build's compiler output",
          spoken: sent("the last build's compiler output"),
        }
      : null,
    PgProgramInfo.idl
      ? {
          label: "idl",
          title: "The built program's interface",
          spoken: sent("the built program's interface"),
        }
      : null,
  ].filter((chip): chip is ComposerContextChip => !!chip);
};

/** The project files not in the context, for + › Add a file */
const addableFiles = (contextFiles: readonly string[]) => {
  const inContext = new Set(contextFiles);
  return realBridge
    .listFiles()
    .filter((path) => !inContext.has(path))
    .map((path) => ({
      path,
      add: () => {
        PgAssistantContext.add(workspace(), path);
        assistantTelemetry.track("assistant_context_file_added", {
          via: "menu",
        });
      },
    }));
};

/** The input's placeholder, by where the turn is */
const PLACEHOLDERS: Record<TurnPhase, string> = {
  idle: "Ask about this project…",
  running: "Working…",
  awaiting: "Waiting on your decision…",
  stopping: "Stopping…",
  waiting: "Waiting for the model…",
};

/**
 * Whether someone is signed in, or `null` until the page's session read has
 * answered: a signed-in user must not see "Sign in" flash on load. It waits
 * for the page's read and never starts one (`afterFirstRead`, not
 * `whenRead`).
 */
const useSignedIn = (): boolean | null => {
  const [read, setRead] = useState(false);
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let live = true;
    void PgSession.afterFirstRead().then(() => {
      if (live) setRead(true);
    });
    const session = PgSession.onDidChange(render);
    return () => {
      live = false;
      session.dispose();
    };
  }, []);
  return read ? !!PgSession.get() : null;
};

/**
 * Why the assistant is off, reported once per reason while the composer is
 * mounted, however often it redraws
 */
const useAiOff = (input: AiOffInput) => {
  const reason = aiOff(input);
  const reported = useRef(new Set<AiOffReason>());
  useEffect(() => {
    if (!reason || reported.current.has(reason)) return;
    reported.current.add(reason);
    assistantTelemetry.track("assistant_ai_off_shown", { reason });
  }, [reason]);
  return reason;
};

/**
 * The assistant's composer, connected: the context it reads, the model and
 * effort menus, the + menu, and the turn shared with the thread.
 */
export function AssistantComposer({
  turn,
  onSources,
  focusPicked,
}: {
  turn: Turn;
  /** Opens Sources and tools in place of the conversation */
  onSources(): void;
  /** Gives focus to what a pick from + opened, as the head's More does */
  focusPicked(): boolean;
}) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgAssistant.onDidChange(render).dispose, []);
  // The chips follow the context: a pick, a tab opened or closed, a file
  // created or deleted, another project
  useEffect(() => PgAssistantContext.onDidChange(render).dispose, []);
  useEffect(() => {
    const subs = [
      PgExplorer.onDidSetTabs(render),
      PgExplorer.onDidCreateItem(render),
      PgExplorer.onDidDeleteItem(render),
      PgExplorer.onDidRenameItem(render),
      PgExplorer.onDidSwitchWorkspace(render),
    ];
    return () => subs.forEach((sub) => sub.dispose());
  }, []);
  const contextFiles = realBridge.listContextFiles();

  const [lessonState, setLessonState] =
    useState<LessonState>(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLessonState).dispose, []);

  const defaultBackend = useDefaultBackend();
  const connection = PgAssistant.connection;
  const shown = modelShown(connection, defaultBackend);
  const signedIn = useSignedIn();
  const off = useAiOff({
    connected: connection?.id ?? null,
    backend: defaultBackend,
    signedIn,
  });
  const [signInError, setSignInError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // A failed sign-in speaks for the row it was pressed in, never a later one
  useEffect(() => setSignInError(null), [off]);

  /** The off row's sign-in: Connect a model's, which keeps the open project */
  const signIn = () => {
    setSignInError(null);
    PgSession.signIn({ from: "assistant" }).catch((error: unknown) => {
      if (isSignInFailure(error)) {
        // Not reported: a blocked popup or a cancelled sign-in is expected,
        // and its message says what to do
        log.info("sign-in from the off row failed", {
          context: { error: String(error) },
        });
        setSignInError((error as Error).message);
        return;
      }
      log.error(error, { report: true, context: { from: "ai-off" } });
      setSignInError("Sign-in failed. Try again.");
    });
  };

  const retry = () => {
    setRetrying(true);
    retryDefaultBackend()
      .catch((error: unknown) => {
        // The probe answers its own failures and has told every reader the
        // default is unreachable; this is the bug past them
        log.error(error, { report: true, context: { from: "ai-off" } });
      })
      .finally(() => setRetrying(false));
  };

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
      {off && (
        <BaseAiOffRow
          reason={off}
          promptWaiting={turn.promptWaiting}
          signInError={signInError}
          signingIn={PgSession.signInState().status === "pending"}
          retrying={retrying}
          onAddKey={turn.addKey}
          onSignIn={signIn}
          onRetry={retry}
        />
      )}
      {!off && turn.promptWaiting && (
        // With no default at all the off row says it; this is the wait for a
        // thread's own key, or for the deployment's answer
        <Callout variant="info" role="status">
          <CalloutDescription>
            Connect a backend, or sign in for the default one, to send this to
            the assistant. Your prompt is waiting in the composer.
          </CalloutDescription>
        </Callout>
      )}
      <BaseAssistantComposer
        chips={contextChips(lessonState, contextFiles)}
        addable={addableFiles(contextFiles)}
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
        onSources={onSources}
        onConnect={() => turn.openConnect("add")}
        connectLabel={connectLabel(connection)}
        focusPicked={focusPicked}
        // While no model can answer this user, Send waits with the reason
        // and the off row above names the way in
        sendBlocked={off ? AI_OFF_SEND_BLOCKED[off] : null}
      />
    </div>
  );
}
