import { useEffect, useReducer, useRef, useState } from "react";

import type { AiTurnError } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";

import { pushThread } from "../../../effects/chat-thread/push-thread";
import { PgSession } from "@/features/auth";
import { report, toReplayMessages } from "@/features/persistence";
import { createProvider } from "../../../views/sidebar/assistant/model";
import {
  isDefaultBackendRemembered,
  rememberedChoice,
  rememberedConnection,
} from "../../../views/sidebar/assistant/model/remembered-backend";
import { threadBackend } from "../../../views/sidebar/assistant/model/thread-backend";
import {
  isDefaultBackend,
  PROVIDERS,
} from "../../../views/sidebar/assistant/model/types";
import type { Provider } from "../../../views/sidebar/assistant/model/types";
import { paramsOf, PgAssistant } from "../../../views/sidebar/assistant/store";
import type {
  Connection,
  PromptRequest,
} from "../../../views/sidebar/assistant/store";
import type { ConnectPreset } from "../../../views/sidebar/assistant/Component/Connect";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
// Deep import rather than the `utils` barrel, as `effects/chat-thread` does
import { PgExplorer } from "../../../utils/explorer/explorer";
import { DEFAULT_CONNECTION } from "./connection";
import { probeDefaultBackend } from "./default-backend";
import { assistantTelemetry } from "./telemetry";
import type { AssistantEvents } from "./telemetry";

export type { ConnectPreset };

const log = createLogger("assistant:turn");
const connectLog = createLogger("assistant:connect");

/**
 * The rejection an aborted fetch or stream ends with. By name: a
 * `DOMException` is not an `Error` everywhere (jsdom's is not).
 */
const isAbort = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "AbortError";

/**
 * Whether a turn ended on the provider refusing the key: a 401. Not a 403,
 * which providers also answer for a valid key without access to the model, a
 * region or an organisation's policy; asking for the key again there loops,
 * so a 403 keeps the provider's own message. By name, since the slice entry
 * exports `AiTurnError` as a type only: the class loads with the SDK.
 */
const isRejectedKey = (error: unknown) =>
  error instanceof Error &&
  error.name === "AiTurnError" &&
  (error as AiTurnError).status === 401;

/** Where Connect a model was opened from */
export type ConnectVia = AssistantEvents["assistant_connect_opened"]["via"];

/**
 * Opens Connect a model and marks it open (`PgAssistant.pickBackend`), or
 * does nothing while it is open already. The app hands the panel
 * `openConnectDialog`; this module only decides when to call it.
 */
export type ConnectOpener = (via: ConnectVia, preset?: ConnectPreset) => void;

export interface TurnOptions {
  open: ConnectOpener;
}

/**
 * Where the turn is. `stopping` is a turn that was stopped, by the user
 * (`stop`) or by the store (`PgAssistant.stopTurn`, or its thread closing),
 * and is still unwinding: the store's status reads idle before its provider
 * finishes.
 */
export type TurnPhase = "idle" | "running" | "awaiting" | "stopping";

/**
 * One assistant turn at a time, shared by the thread and the composer.
 *
 * Called once by the panel and handed to both: two calls would hold two
 * providers, two histories and two Stop buttons for one conversation.
 */
export interface Turn {
  /** Send a prompt; with nothing connected, connect the default or open Connect */
  send(text: string): Promise<void>;
  /** Abort the turn in flight and deny whatever it is waiting on */
  stop(): void;
  phase: TurnPhase;
  /** `phase` is not idle: a turn runs, waits on an approval, or unwinds */
  busy: boolean;
  /** What is in the composer */
  input: string;
  setInput(value: string): void;
  /** Open Connect a model, on `preset`'s backend when given */
  openConnect: ConnectOpener;
  /** A requested prompt waits in the composer for a backend to be connected */
  promptWaiting: boolean;
  /** Bumped whenever the composer's input should take focus */
  focusRequest: number;
}

/**
 * The connection a turn can run on: none for the default backend while nobody
 * is signed in, since `/api/agent` refuses every turn then. Connect a model is
 * where that user signs in.
 */
const usableConnection = () =>
  PgAssistant.needsSignIn ? null : PgAssistant.connection;

/**
 * Whether someone is signed in, once the page's session read has answered: a
 * send can come before it. Never a read of its own: one that found a session
 * started in another tab would reach the session effect as a sign-in, and it
 * would open the account's latest project under the prompt being sent.
 */
const isSignedIn = async () => {
  await PgSession.whenRead();
  return !!PgSession.get();
};

/**
 * Connect the deployment's default when it has one and someone is signed in;
 * `null` otherwise, or while Connect a model is open, for the caller to ask
 * the user.
 */
const connectDefault = async (): Promise<Connection | null> => {
  const [backend, signedIn] = await Promise.all([
    probeDefaultBackend(),
    isSignedIn(),
  ]);
  if (backend.state !== "present" || !signedIn) return null;
  // Another caller may have connected while the probe was out; and a user
  // choosing in Connect a model is not overruled by a send behind the dialog
  if (!PgAssistant.connection && !PgAssistant.isPickingBackend) {
    PgAssistant.connect(DEFAULT_CONNECTION);
  }
  return PgAssistant.connection;
};

/** Where a send with nothing connected goes */
type SendBackend =
  /** The default, if this deployment serves it to this user */
  | { kind: "default" }
  /** A key-based backend: the user has to give its key in Connect a model */
  | { kind: "ask"; via: "thread" | "send"; preset: ConnectPreset };

/**
 * The backend a send with nothing connected goes to: the one that last
 * answered the open thread, else the one this browser last chose, else the
 * default. A key-based answer is never replaced by the default, which would
 * continue the user's conversation with their own model on another one
 * behind their back (HOO-1719).
 */
const resolveSendBackend = (): SendBackend => {
  const thread = threadBackend(PgAssistant.items);
  if (thread) {
    return isDefaultBackend(thread.provider)
      ? { kind: "default" }
      : { kind: "ask", via: "thread", preset: thread };
  }
  const choice = rememberedChoice();
  if (choice && !isDefaultBackend(choice.provider)) {
    return { kind: "ask", via: "send", preset: choice };
  }
  return { kind: "default" };
};

export const useTurn = ({ open }: TurnOptions): Turn => {
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgAssistant.onDidChange(render).dispose, []);
  // A session ending or starting changes whether the default can take a turn
  useEffect(() => PgSession.onDidChange(render).dispose, []);

  const [input, setInput] = useState("");
  const [focusRequest, focus] = useReducer((n: number) => n + 1, 0);
  // A prompt that arrived with no backend waits in the composer. Saying so is
  // the panel's job, not the conversation's: a notice item would outlive the
  // connect and be stored with the thread
  const [promptWaiting, setPromptWaiting] = useState(false);

  const provider = useRef<{
    connection: Connection;
    /** The conversation its history was seeded from */
    threadId: string | null;
    /** `PgAssistant.conversation` when it was seeded */
    conversation: number;
    instance: Provider;
  } | null>(null);
  const turn = useRef<AbortController | null>(null);
  // Set from the first `send` until its turn starts, so a second send in the
  // meantime (a double Enter, a suggestion clicked twice) cannot start another
  // while the first is still finding a backend
  const starting = useRef(false);

  // The store says what a live turn is doing; the controller says whether a
  // turn is over, since a stopped one still has to unwind. A turn the store
  // records but this hook has no controller for was started before the hook
  // remounted. The store's status may already read idle (a closed thread, a
  // backend change), so its record is all that says the turn still runs; it
  // shows as stopping because this hook cannot stop it
  const phaseOf = (): TurnPhase => {
    if (turn.current?.signal.aborted) return "stopping";
    if (PgAssistant.status !== "idle") return PgAssistant.status;
    if (turn.current) return "running";
    if (PgAssistant.turnRunning) return "stopping";
    return "idle";
  };
  const phase = phaseOf();
  const busy = phase !== "idle";

  const connection = usableConnection();
  // Connecting answers the hint; a later disconnect must not bring it back
  useEffect(() => {
    if (connection) setPromptWaiting(false);
  }, [connection]);

  /**
   * Reconnect what this tab was using before a reload, without asking again.
   *
   * First the key-based backend kept in this tab's `sessionStorage` by
   * `rememberBackend` (a new tab has none; a tab the browser duplicates or
   * restores carries it). It needs no probe, so it is connected on mount,
   * before the probe can answer, and the default's reconnect then finds a
   * connection and stands down: a kept key wins over a remembered default.
   *
   * Then the keyless default, only if the user picked it before, only once
   * the probe confirms this deployment still serves it, and only for a
   * signed-in user: tried again when a user arrives, since the session is
   * read after this mounts and a sign-in can come later.
   *
   * `probeDefaultBackend` is shared with the composer and Connect a model, so
   * the page asks once (again only after a failure).
   *
   * Neither overrules a live connection or a choice in progress in Connect a
   * model. A Forget key stays forgotten because `forgetBackend` drops what
   * both would read.
   */
  useEffect(() => {
    if (!PgAssistant.connection && !PgAssistant.isPickingBackend) {
      const kept = rememberedConnection();
      if (kept) PgAssistant.connect(kept);
    }

    let live = true;
    const reconnectDefault = () =>
      probeDefaultBackend()
        .then((backend) => {
          if (!live || backend.state !== "present") return;
          if (PgAssistant.connection || PgAssistant.isPickingBackend) return;
          if (!isDefaultBackendRemembered() || !PgSession.get()) return;
          PgAssistant.connect(DEFAULT_CONNECTION);
        })
        .catch((error: unknown) => {
          // Nothing on screen asked for it: the panel opens unconnected, and
          // the first send connects or asks
          connectLog.error(error, {
            report: true,
            context: { reconnect: "default" },
          });
        });
    void reconnectDefault();
    // `onDidChange` fires for every step of a sign-in too; only a user
    // arriving can make the default reconnect
    let signedIn = !!PgSession.get();
    const session = PgSession.onDidChange(() => {
      const now = !!PgSession.get();
      if (now && !signedIn) void reconnectDefault();
      signedIn = now;
    });
    return () => {
      live = false;
      session.dispose();
    };
  }, []);

  // Through a ref: `onDidRequestPrompt` subscribes once, with the first
  // render's `open`; the ref hands it the latest
  const opener = useRef(open);
  opener.current = open;
  const openConnect = (via: ConnectVia, preset?: ConnectPreset) =>
    opener.current(via, preset);

  /**
   * Whether a turn, or a send still finding its backend, is under way.
   * `PgAssistant.turnRunning` covers a turn this hook has no controller for,
   * and one whose status a closed thread reset; see `turnRunning`.
   */
  const occupied = () =>
    starting.current ||
    !!turn.current ||
    PgAssistant.turnRunning ||
    PgAssistant.status !== "idle";

  /**
   * @returns `false` when the send was refused because another one is under
   * way, or because another project opened while it waited on the default
   * backend, so a caller holding text the user never typed can keep it
   */
  const start = async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (occupied()) return false;

    // Only a send with nothing connected waits, so a connected one has started
    // its turn by the time it first yields
    let current = usableConnection();
    // Nothing connected: the thread's own backend, or the default. Connected
    // to the default with no session falls through to Connect a model, which
    // offers sign-in
    if (!current && !PgAssistant.connection) {
      const backend = resolveSendBackend();
      if (backend.kind === "ask") {
        setInput(text);
        openConnect(backend.via, backend.preset);
        return true;
      }
      const project = PgExplorer.currentWorkspaceId;
      starting.current = true;
      try {
        current = await connectDefault();
      } finally {
        starting.current = false;
      }
      // A turn may have started while the probe was out, or the user may have
      // opened another project: the prompt was written for the one it left,
      // and would land in the new one's conversation with its files
      if (occupied() || PgExplorer.currentWorkspaceId !== project) {
        return false;
      }
    }
    if (!current) {
      // Nothing to send to: the prompt stays where the user can send it once
      // a backend is connected
      setInput(text);
      openConnect("send");
      return true;
    }

    // One provider per connection and conversation; it owns the history.
    // Every connect and tune stores a new object, so identity catches any
    // change, a re-pick included, and another project's thread gets its own,
    // or the model would carry the last project's turns. `conversation`
    // catches what is dropped with no thread change: sign-out with no thread
    // open would otherwise hand the next account the last one's history. A
    // rebuild is harmless: the new provider is seeded from what is rendered.
    if (
      provider.current?.connection !== current ||
      provider.current.threadId !== PgAssistant.threadId ||
      provider.current.conversation !== PgAssistant.conversation
    ) {
      provider.current = {
        connection: current,
        threadId: PgAssistant.threadId,
        conversation: PgAssistant.conversation,
        // Seeded from what is rendered, so reopening a stored thread gives the
        // model the conversation rather than amnesia behind a full transcript
        instance: createProvider(current, toReplayMessages(PgAssistant.items)),
      };
    }
    const instance = provider.current.instance;

    PgAssistant.addUserMessage(trimmed);
    // Cleared only once the message is in: a store that throws leaves the
    // typed text where the user can send it again
    setInput("");
    const controller = new AbortController();
    turn.current = controller;
    PgAssistant.beginTurn(controller);
    PgAssistant.setStatus("running");

    try {
      await instance.send(trimmed, controller.signal);
    } catch (e) {
      if (
        !controller.signal.aborted &&
        isRejectedKey(e) &&
        !isDefaultBackend(current.id)
      ) {
        // The key-based backend refused the key: say which, and offer to enter
        // it again on the same backend rather than leaving a bare 401
        const { id } = current;
        const name = PROVIDERS.find((p) => p.id === id)?.name ?? id;
        PgAssistant.addError(
          `${name} did not accept this key. Check it and enter it again, or pick another model.`,
          paramsOf(current)
        );
        assistantTelemetry.track("assistant_key_rejected", {
          provider: current.id,
        });
        connectLog.warn("the provider refused the key", {
          context: { provider: current.id },
        });
      } else if (!controller.signal.aborted) {
        PgAssistant.addError(e instanceof Error ? e.message : String(e));
      } else if (isAbort(e)) {
        // Aborted by `stop`, which has already written its notice, or by the
        // store cutting the turn off, when there is nothing to tell the user
        log.debug("the stopped turn unwound");
      } else {
        // Stopped, but the turn ended on something other than the abort: not
        // the user's to read, since the turn was stopped, but a bug to hear of
        log.error(e, { report: true, context: { stopped: true } });
      }
    } finally {
      if (turn.current === controller) turn.current = null;
      const finished = PgAssistant.endTurn(controller);
      PgAssistant.setStatus("idle");
      focus();

      // End of turn is the natural commit point: the exchange is complete and
      // the user is reading rather than typing. Deliberately not awaited --
      // a slow or failed upload must not hold up the panel, and the local
      // copy is already written either way. Not for a turn that was cut off
      // (`endTurn` answers false): the thread open now holds nothing of it.
      const threadId = PgAssistant.threadId;
      if (finished && threadId) {
        void pushThread(threadId).catch((e) => report("push turn", e));
      }
    }
    return true;
  };
  // `start` answers its own failures once a turn runs; one before that (the
  // store throwing on the new message) would be an unhandled rejection with
  // nothing on screen
  const send = async (text: string) => {
    await start(text).catch(reportButtonFailure("send your message"));
  };
  // Bridges `onDidRequestPrompt`, which subscribes once, to this render's `start`
  const startRef = useRef(start);
  startRef.current = start;

  /**
   * Aborting the request is not enough on its own: a tool waiting on an
   * approval holds the agent loop open, so deny whatever is pending too.
   *
   * A stopped turn stays busy until its provider unwinds; a second Stop in
   * that window has nothing left to stop and must not say so twice.
   */
  const stop = () => {
    if (!turn.current || turn.current.signal.aborted) return;
    turn.current.abort();
    PgAssistant.cancelPending();
    PgAssistant.addNotice("Stopped.");
    assistantTelemetry.track("assistant_turn_stopped", {});
  };

  // "Fix with assistant" and similar callers outside the panel ask for a
  // prompt to be sent through `PgAssistant.requestPrompt`; this is the only
  // place that turns the request into an actual send
  useEffect(() => {
    /** A prompt the user did not type gets one look before it costs a turn */
    const place = (text: string) => {
      setInput(text);
      focus();
    };
    /**
     * With a backend to run it: send, or leave it for a look first. A send
     * refused because another is under way leaves it in the composer rather
     * than dropping a prompt the user never typed and cannot retype.
     */
    const run = ({ text, send }: PromptRequest) => {
      if (!send) {
        place(text);
        return;
      }
      startRef.current(text).then(
        (started) => {
          if (!started) place(text);
        },
        (e) => {
          place(text);
          reportButtonFailure("send the prompt")(e);
        }
      );
    };
    return PgAssistant.onDidRequestPrompt(
      (request) => {
        if (usableConnection()) {
          run(request);
          return;
        }
        if (!PgAssistant.connection) {
          const backend = resolveSendBackend();
          if (backend.kind === "ask") {
            setInput(request.text);
            setPromptWaiting(true);
            openConnect(backend.via, backend.preset);
            return;
          }
        }
        const project = PgExplorer.currentWorkspaceId;
        Promise.all([probeDefaultBackend(), isSignedIn()])
          .then(([backend, signedIn]) => {
            // Another project opened while this waited: the prompt was asked
            // for in the one it left, so it waits in the composer unsent
            if (PgExplorer.currentWorkspaceId !== project) {
              place(request.text);
              return;
            }
            // Connected while the probe was out, or the default can be; not
            // behind an open Connect a model, where the user is choosing, and
            // not for a user the default would refuse
            const canConnectDefault =
              backend.state === "present" &&
              signedIn &&
              !PgAssistant.connection &&
              !PgAssistant.isPickingBackend;
            if (usableConnection() || canConnectDefault) {
              if (!PgAssistant.isConnected) {
                PgAssistant.connect(DEFAULT_CONNECTION);
              }
              run(request);
              return;
            }
            setInput(request.text);
            setPromptWaiting(true);
            openConnect("send");
          })
          .catch((e: unknown) => {
            // A prompt the user did not type, and cannot retype, is kept
            place(request.text);
            reportButtonFailure("send the prompt")(e);
          });
      },
      { sends: true }
    ).dispose;
    // `openConnect`, `place` and `run` only touch the store, state setters and
    // the `startRef` and `opener` refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    send,
    stop,
    phase,
    busy,
    input,
    setInput,
    openConnect,
    promptWaiting,
    focusRequest,
  };
};
