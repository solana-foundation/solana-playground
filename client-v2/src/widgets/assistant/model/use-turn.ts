import { useEffect, useReducer, useRef, useState } from "react";

import { PgSession } from "@/features/auth";
import { report, toReplayMessagesWith } from "@/features/persistence";
import type { AiTurnError, ModelProvider } from "@/shared/lib/ai";
import { isNetworkFailure } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

import { pushThread } from "../../../effects/chat-thread/push-thread";
// Deep import rather than the `utils` barrel, as `effects/chat-thread` does
import { PgExplorer } from "../../../utils/explorer/explorer";
import { realBridge } from "../../../views/sidebar/assistant/bridge/playground-bridge";
import type { ConnectPreset } from "../../../views/sidebar/assistant/Component/Connect";
import { createProvider } from "../../../views/sidebar/assistant/model";
import { ModelBusyError } from "../../../views/sidebar/assistant/model/model-busy";
import {
  dropKeptKey,
  isDefaultBackendRemembered,
  rememberedChoice,
} from "../../../views/sidebar/assistant/model/remembered-backend";
import { threadBackend } from "../../../views/sidebar/assistant/model/thread-backend";
import type { Provider } from "../../../views/sidebar/assistant/model/types";
import {
  isDefaultBackend,
  TurnFailure,
} from "../../../views/sidebar/assistant/model/types";
import type {
  Connection,
  PromptRequest,
} from "../../../views/sidebar/assistant/store";
import {
  CONNECTION_LOST,
  paramsOf,
  PgAssistant,
  STOPPED_NOTICE,
} from "../../../views/sidebar/assistant/store";
import { DEFAULT_CONNECTION } from "./connection";
import { probeDefaultBackend } from "./default-backend";
import { KEY_OWNER } from "./head-label";
import type { AssistantEvents } from "./telemetry";
import { assistantTelemetry } from "./telemetry";

export type { ConnectPreset };

const log = createLogger("assistant:turn");

/**
 * The open thread as the model's history, without the content of a file the
 * user has taken out of the context since: a path is read the way `read_file`
 * reads it
 *
 * @param context the context's project-relative paths now
 */
const replayFor = (context: readonly string[]) =>
  toReplayMessagesWith((asked) => {
    const path = realBridge.toProjectPath(asked);
    return path !== undefined && context.includes(path);
  })(PgAssistant.items);
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

/** Seconds to wait on a busy model whose server named no wait (Spec 08 AI-03) */
const BUSY_WAIT_SECONDS = 10;

/** Busy answers sent again by themselves before the panel stops and says so */
const BUSY_RETRIES = 3;

/**
 * The longest wait the panel counts down. A server asking for longer (some
 * name an hour) gets no countdown: the panel would sit locked behind it.
 */
const BUSY_WAIT_MAX_SECONDS = 60;

/** What the thread adds once the model stays busy, or asks for a long wait */
const COME_BACK_LATER = "Send your message again in a minute.";

/** What the thread says when the model changed while a message waited */
const NOT_RESENT =
  "The model changed while your message waited, so it was not sent again. Send it again.";

/** A message on its way to the model */
interface Outgoing {
  text: string;
  /** Which retry this is, 0 for the first send */
  attempt: number;
}

/** A message the model turned away for load, waiting to be sent again */
interface BusyRetry {
  text: string;
  /** When it is sent again, in `Date.now()` time */
  at: number;
  /** The server named no wait, so the user may send it sooner */
  canTryNow: boolean;
  /** Which retry this is, from 1 */
  attempt: number;
  /** The thread it belongs to; another thread open by then drops it */
  threadId: string | null;
  /** `PgAssistant.conversation` when it waited: a sign-out drops it too */
  conversation: number;
  /** The backend the turn was sent to, which its outcome is reported under */
  provider: ModelProvider;
}

/**
 * The SDK's `AiTurnError` a turn failed with, which the provider keeps as its
 * `TurnFailure`'s `cause`. By name, since the slice entry
 * exports `AiTurnError` as a type only: the class loads with the SDK.
 */
const turnErrorOf = (error: unknown): AiTurnError | undefined => {
  if (!(error instanceof Error)) return undefined;
  if (error.name === "AiTurnError") return error as AiTurnError;
  return error.name === "TurnFailure" ? turnErrorOf(error.cause) : undefined;
};

/**
 * Whether a turn ended on the provider refusing the key: kind `key-refused`,
 * a 401 or Gemini's 400 (`failureKindOf`). Not a 403, which providers also
 * answer for a valid key without access to the model, a region or an
 * organisation's policy; asking for the key again there loops, so a 403 gets
 * the `forbidden` words.
 */
const isRejectedKey = (error: unknown) =>
  turnErrorOf(error)?.kind === "key-refused";

/**
 * Whether the turn ended on the connection dropping: `runTurn` reports it as
 * an `AiTurnError` of kind `network`; a send that failed before reaching it
 * throws the dropped fetch itself.
 */
const isDroppedConnection = (error: unknown) =>
  isNetworkFailure(error) || turnErrorOf(error)?.kind === "network";

/**
 * Report a turn that ended without an answer: capped for the cost gate's
 * refusal, failed otherwise, with the `TurnFailure`'s reason and status. A
 * dropped connection is the backend not answering (`provider`); anything else
 * raised on this side is `other`. Never the error's text, which can quote the
 * prompt. `runTurn` calls it for every failure but a busy model's, which
 * `waitOnBusyWith` reports once it gives up.
 */
const trackTurnFailureFor = (backend: ModelProvider) => (error: unknown) => {
  if (!(error instanceof TurnFailure)) {
    assistantTelemetry.track("assistant_turn_failed", {
      provider: backend,
      reason: isDroppedConnection(error) ? "provider" : "other",
    });
    return;
  }
  if (error.reason === "capped") {
    assistantTelemetry.track("assistant_turn_capped", { provider: backend });
    return;
  }
  const params: AssistantEvents["assistant_turn_failed"] = {
    provider: backend,
    reason: error.reason,
  };
  // Omitted, not `undefined`, so the event carries no `status` key at all
  if (error.status !== undefined) params.status = error.status;
  assistantTelemetry.track("assistant_turn_failed", params);
};

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
  /**
   * Keeps what the composer holds for the next hook with the same key, so a
   * chat that unmounts and comes back (a tutorial's, across Back to
   * tutorials) still holds its draft. Without one the draft is the hook's own.
   */
  draftKey?: string;
}

/**
 * Drafts by account and `draftKey`, for this page's life; an empty one is
 * dropped. By account, so one signed in after another in the same tab never
 * finds the last one's half-typed question, whether or not a chat was
 * mounted when the account changed.
 */
const drafts = new Map<string, string>();
/** Whose a draft typed before the page has read the session is */
const UNREAD = "unread";
const draftSlot = (draftKey: string | undefined) => {
  if (draftKey === undefined) return undefined;
  const owner = PgSession.hasRead
    ? PgSession.get()?.id ?? "signed-out"
    : UNREAD;
  return `${owner}\u0000${draftKey}`;
};
const earlySlot = (draftKey: string) => `${UNREAD}\u0000${draftKey}`;
/**
 * The draft for `draftKey` under the account signed in. One typed before the
 * session was read by a chat no longer on screen is dropped once the read
 * lands: nothing says whose it is, and the next account to open that chat
 * must not get it. A chat on screen across the read keeps it (`useTurn`).
 */
const draftOf = (draftKey: string | undefined) => {
  const slot = draftSlot(draftKey);
  if (slot === undefined || draftKey === undefined) return "";
  if (PgSession.hasRead) drafts.delete(earlySlot(draftKey));
  return drafts.get(slot) ?? "";
};

/**
 * The turn in flight, whichever hook started it, and a send still finding
 * its backend. Both are the page's, not a hook's: a chat that unmounts
 * mid-turn and mounts again still has its Stop, and two hooks mounted at
 * once (the panel and a tutorial's chat) cannot both start a turn.
 */
const liveTurn: { current?: AbortController } = {};
const startingTurn = { current: false };

/**
 * Where the turn is. `stopping` is a turn that was stopped, by the user
 * (`stop`) or by the store (`PgAssistant.stopTurn`, or its thread closing),
 * and is still unwinding: the store's status reads idle before its provider
 * finishes. `waiting` is a message the model turned away for load, counting
 * down to its next send (`retry`).
 */
export type TurnPhase =
  | "idle"
  | "running"
  | "awaiting"
  | "stopping"
  | "waiting";

/** What became of a message handed to `send` */
export type SendOutcome =
  /** Its turn started: the assistant has it */
  | "sent"
  /** Nothing connected: it waits in the composer, with Connect a model open */
  | "connecting"
  /** Another send was under way, or another project opened while it waited */
  | "refused"
  /** It failed before its turn started; the failure is already reported */
  | "failed"
  /** Nothing but whitespace */
  | "empty";

/**
 * One assistant turn at a time, shared by the thread and the composer.
 *
 * Called once by the panel and handed to both: two calls would hold two
 * providers, two histories and two Stop buttons for one conversation.
 */
export interface Turn {
  /** Send a prompt; with nothing connected, connect the default or open Connect */
  send(text: string): Promise<SendOutcome>;
  /** Abort the turn in flight and deny whatever it is waiting on, or end a busy wait */
  stop(): void;
  /**
   * A message the model turned away for load, counting down to its next send
   * (Spec 08's AI-03). `canTryNow` is off while the server's own wait runs.
   */
  retry: { secondsLeft: number; canTryNow: boolean } | null;
  /** Send the waiting message now */
  tryNow(): Promise<void>;
  phase: TurnPhase;
  /** `phase` is not idle: a turn runs, waits on an approval or on a busy model, or unwinds */
  busy: boolean;
  /** What is in the composer */
  input: string;
  setInput(value: string): void;
  /** Open Connect a model, on `preset`'s backend when given */
  openConnect: ConnectOpener;
  /**
   * The off row's Add an API key: Connect a model, on the backend that answered
   * the open thread when that one needs a key, so a key-based conversation is
   * never offered to another backend from here either (HOO-1719)
   */
  addKey(): void;
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

/**
 * The backend Connect a model starts on when it is opened with nothing
 * connected and no preset of its own: the one a send would ask for, or none
 * (the default) when a send would take the default
 */
const unconnectedPreset = (): ConnectPreset | undefined => {
  if (PgAssistant.connection) return undefined;
  const backend = resolveSendBackend();
  return backend.kind === "ask" ? backend.preset : undefined;
};

/**
 * Connections the page made on its own, reconnecting a remembered default:
 * nobody chose them for the thread now open. A send treats one as nothing
 * connected when that thread was last answered by a key-based backend, so
 * project A's conversation never goes to the default the user picked in
 * project B (HOO-1719). A pick in Connect a model connects a new object, and
 * from then on the user's choice holds.
 */
const restored = new WeakSet<Connection>();

export const useTurn = ({ open, draftKey }: TurnOptions): Turn => {
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgAssistant.onDidChange(render).dispose, []);
  // A session ending or starting changes whether the default can take a turn
  useEffect(() => PgSession.onDidChange(render).dispose, []);

  const slot = draftSlot(draftKey);
  const [draft, setDraft] = useState(() => ({
    slot,
    input: draftOf(draftKey),
  }));
  // Typed here while the session was still being read: it is the account's
  // the read found, and stays on screen rather than blanking mid-typing
  const isCarried =
    draftKey !== undefined &&
    slot !== undefined &&
    draft.slot === earlySlot(draftKey) &&
    slot !== draft.slot;
  if (isCarried) {
    if (draft.input) drafts.set(slot, draft.input);
    drafts.delete(earlySlot(draftKey));
    setDraft({ slot, input: draft.input });
  }
  // Another chat or another account: it shows that one's draft
  const input =
    draft.slot === slot || isCarried ? draft.input : draftOf(draftKey);
  // Through a ref: `onDidRequestPrompt` subscribes once and keeps the first
  // render's `setInput`
  const key = useRef(draftKey);
  key.current = draftKey;
  const setInput = (value: string) => {
    const at = draftSlot(key.current);
    if (at !== undefined) {
      if (value) drafts.set(at, value);
      else drafts.delete(at);
    }
    setDraft({ slot: at, input: value });
  };
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
    /**
     * Every file in the context at a send since it was seeded: what its
     * history may hold the content of
     */
    context: ReadonlySet<string>;
    instance: Provider;
  } | null>(null);
  const turn = liveTurn;
  // Set from the first `send` until its turn starts, so a second send in the
  // meantime (a double Enter, a suggestion clicked twice) cannot start another
  // while the first is still finding a backend
  const starting = startingTurn;
  // A turn outlives the hook that started it (`liveTurn`); what it ends on
  // after the unmount is said in the thread, since no composer is left to show it
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A message waiting on a busy model. The ref is what the handlers read: a
  // send through `startRef` holds an older render's state. The state draws it
  const waiting = useRef<BusyRetry | null>(null);
  const [retry, setRetry] = useState<BusyRetry | null>(null);
  const setWaiting = (next: BusyRetry | null) => {
    waiting.current = next;
    setRetry(next);
  };
  // Re-read each second while a retry counts down
  const [now, setNow] = useState(() => Date.now());

  // The store says what a live turn is doing; the controller says whether a
  // turn is over, since a stopped one still has to unwind. A turn the store
  // records with no controller here was cut off by the store (a closed
  // thread, a backend change), which resets its status to idle, so its record
  // is all that says the turn still runs; it shows as stopping
  const phaseOf = (): TurnPhase => {
    if (turn.current?.signal.aborted) return "stopping";
    if (PgAssistant.status !== "idle") return PgAssistant.status;
    if (turn.current) return "running";
    if (PgAssistant.turnRunning) return "stopping";
    if (retry) return "waiting";
    return "idle";
  };
  const phase = phaseOf();
  const busy = phase !== "idle";
  // Delete my key reads this through `PgAssistant.keyHold`, in the head and
  // in Settings alike
  useEffect(() => {
    PgAssistant.markTurnBusy(busy);
  }, [busy]);
  // A turn still running when the chat unmounts keeps the key held; its own
  // end releases it (`runTurn`)
  useEffect(
    () => () => {
      if (!liveTurn.current) PgAssistant.markTurnBusy(false);
    },
    []
  );

  const connection = usableConnection();
  // Connecting answers the hint; a later disconnect must not bring it back
  useEffect(() => {
    if (connection) setPromptWaiting(false);
  }, [connection]);

  /**
   * Reconnect the keyless default this browser chose before, without asking
   * again: only once the probe confirms this deployment still serves it, and
   * only for a signed-in user, tried again when a user arrives, since the
   * session is read after this mounts and a sign-in can come later.
   *
   * A key-based backend is never reconnected: its key lives in memory only,
   * so a reload asks for it again, and the next send opens Connect a model
   * preset to it (`resolveSendBackend`). A key an older build kept in this
   * tab's `sessionStorage` is removed at startup (`effects/kept-key`), and
   * again here, for a panel that mounts before the effects run (HOO-2423).
   *
   * `probeDefaultBackend` is shared with the composer and Connect a model, so
   * the page asks once (again only after a failure).
   *
   * It never overrules a live connection or a choice in progress in Connect a
   * model, and a default reconnected here never answers a thread a key-based
   * backend answered (`restored`). A Delete my key stays deleted because
   * `forgetBackend` drops the remembered choice it reads.
   */
  useEffect(() => {
    dropKeptKey();

    let live = true;
    const reconnectDefault = () =>
      probeDefaultBackend()
        .then((backend) => {
          if (!live || backend.state !== "present") return;
          if (PgAssistant.connection || PgAssistant.isPickingBackend) return;
          if (!isDefaultBackendRemembered() || !PgSession.get()) return;
          PgAssistant.connect(DEFAULT_CONNECTION);
          if (PgAssistant.connection) restored.add(PgAssistant.connection);
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
      const signedInNow = !!PgSession.get();
      if (signedInNow && !signedIn) void reconnectDefault();
      signedIn = signedInNow;
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
  // With nothing connected, Connect a model starts on the backend a send
  // would ask for: the user's own key lives in memory only, so after a reload
  // this is how they are asked for it again (HOO-2423)
  const openConnect = (via: ConnectVia, preset?: ConnectPreset) =>
    opener.current(via, preset ?? unconnectedPreset());

  const addKey = () => {
    const backend = resolveSendBackend();
    openConnect("ai-off", backend.kind === "ask" ? backend.preset : undefined);
  };

  /**
   * Whether a turn, a send still finding its backend, or a message waiting on
   * a busy model is under way.
   * `PgAssistant.turnRunning` covers a turn the store cut off, whose status a
   * closed thread reset; see `turnRunning`.
   */
  const occupied = () =>
    starting.current ||
    !!turn.current ||
    !!waiting.current ||
    PgAssistant.turnRunning ||
    PgAssistant.status !== "idle";

  /**
   * @returns `refused` when another send is under way, or another project
   * opened while it waited on the default backend, so a caller holding text
   * the user never typed can keep it
   */
  const start = async (text: string): Promise<SendOutcome> => {
    const trimmed = text.trim();
    if (!trimmed) return "empty";
    if (occupied()) return "refused";

    // Only a send with nothing connected waits, so a connected one has started
    // its turn by the time it first yields
    let current = usableConnection();
    if (current && restored.has(current)) {
      const backend = resolveSendBackend();
      if (backend.kind === "ask") {
        setInput(text);
        openConnect(backend.via, backend.preset);
        return "connecting";
      }
    }
    // Nothing connected: the thread's own backend, or the default. Connected
    // to the default with no session falls through to Connect a model, which
    // offers sign-in
    if (!current && !PgAssistant.connection) {
      const backend = resolveSendBackend();
      if (backend.kind === "ask") {
        setInput(text);
        openConnect(backend.via, backend.preset);
        return "connecting";
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
        return "refused";
      }
    }
    if (!current) {
      // Nothing to send to: the prompt stays where the user can send it once
      // a backend is connected
      setInput(text);
      openConnect("send");
      return "connecting";
    }

    // One provider per connection and conversation; it owns the history.
    // Every connect and tune stores a new object, so identity catches any
    // change, a re-pick included, and another project's thread gets its own,
    // or the model would carry the last project's turns. `conversation`
    // catches what is dropped with no thread change: sign-out with no thread
    // open would otherwise hand the next account the last one's history. A
    // rebuild loses little: the new provider is seeded from the open thread,
    // which drops provider-only parts and the oldest calls past the replay
    // budget (`toReplayMessagesWith`).
    //
    // A file taken out of the context rebuilds it too: the history holds what
    // the model read of it, and the replay leaves that out (`replayFor`)
    const context = realBridge.listContextFiles();
    if (
      provider.current?.connection !== current ||
      provider.current.threadId !== PgAssistant.threadId ||
      provider.current.conversation !== PgAssistant.conversation ||
      [...provider.current.context].some((path) => !context.includes(path))
    ) {
      provider.current = {
        connection: current,
        threadId: PgAssistant.threadId,
        conversation: PgAssistant.conversation,
        context: new Set(context),
        // Seeded from the open thread, its stored tool calls included, so
        // reopening it gives the model the conversation and what its tools
        // returned
        instance: createProvider(current, replayFor(context)),
      };
    } else {
      provider.current.context = new Set([
        ...provider.current.context,
        ...context,
      ]);
    }
    PgAssistant.addUserMessage(trimmed);
    // Cleared only once the message is in: a store that throws leaves the
    // typed text where the user can send it again
    setInput("");
    await runTurn({ text: trimmed, attempt: 0 });
    return "sent";
  };
  /**
   * One request for a message already in the thread, on the provider `start`
   * chose: the first send, or a busy message sent again.
   */
  const runTurn = async (outgoing: Outgoing) => {
    const { text, attempt } = outgoing;
    if (!provider.current) {
      throw new Error("runTurn has no provider: start builds one first");
    }
    const { instance, connection: current } = provider.current;
    const controller = new AbortController();
    turn.current = controller;
    PgAssistant.beginTurn(controller);
    PgAssistant.setStatus("running");
    // A busy message sent again is the same turn, so only the first attempt reports a send
    if (attempt === 0) {
      assistantTelemetry.track("assistant_turn_sent", { provider: current.id });
    }

    try {
      await instance.send(text, { signal: controller.signal });
      // A provider may resolve after Stop, which has already ended the turn
      if (!controller.signal.aborted) {
        assistantTelemetry.track("assistant_turn_answered", {
          provider: current.id,
        });
      }
    } catch (e) {
      const cutReply = isDroppedConnection(e)
        ? PgAssistant.turnReplyWithText()
        : undefined;
      // A stopped turn's outcome is `stop`'s; a busy one waits for its resend
      if (!controller.signal.aborted && !(e instanceof ModelBusyError)) {
        trackTurnFailureFor(current.id)(e);
      }
      if (
        !controller.signal.aborted &&
        e instanceof ModelBusyError &&
        !mounted.current
      ) {
        // No composer is left to count down: the wait ends as a Stop, as it
        // does when the chat unmounts during one
        PgAssistant.addNotice("Stopped.");
        assistantTelemetry.track("assistant_turn_stopped", {});
      } else if (!controller.signal.aborted && e instanceof ModelBusyError) {
        waitOnBusyWith(current.id)(outgoing, e);
      } else if (
        !controller.signal.aborted &&
        isRejectedKey(e) &&
        !isDefaultBackend(current.id)
      ) {
        // The key-based backend refused the key: say whose, as the head does;
        // the error's buttons say what to do (`Thread`)
        const { id } = current;
        const name = id === "default" ? id : KEY_OWNER[id];
        PgAssistant.addErrorWith(paramsOf(current))(
          `${name} did not accept this key.`
        );
        assistantTelemetry.track("assistant_key_rejected", {
          provider: current.id,
        });
        connectLog.warn("the provider refused the key", {
          context: { provider: current.id },
        });
      } else if (!controller.signal.aborted && cutReply) {
        // The reply keeps what it streamed and says it was cut off
        PgAssistant.markCutOff(cutReply);
        log.warn("the connection dropped mid-reply", {
          context: { error: e instanceof Error ? e.message : String(e) },
        });
        assistantTelemetry.track("assistant_reply_failed", {
          reason: "interrupted",
        });
      } else if (!controller.signal.aborted && isDroppedConnection(e)) {
        // No reply text to keep: say so in words, with Try again (`isConnectionLost`)
        PgAssistant.addError(CONNECTION_LOST);
        log.warn("the connection dropped before the reply", {
          context: { error: e instanceof Error ? e.message : String(e) },
        });
        assistantTelemetry.track("assistant_reply_failed", {
          reason: "connection-lost",
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
      if (turn.current === controller) turn.current = undefined;
      const finished = PgAssistant.endTurn(controller);
      PgAssistant.setStatus("idle");
      // Its hook is gone, so no effect of it releases the key it held
      if (!mounted.current && !liveTurn.current) {
        PgAssistant.markTurnBusy(false);
      }
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
  };

  /**
   * A busy model: count down and send the message again, up to
   * `BUSY_RETRIES` times, then say so in the thread. The wait is the
   * server's when it names one, and Try now is off until it ends; a wait past
   * `BUSY_WAIT_MAX_SECONDS` is not counted down at all; giving up reports the
   * turn as failed.
   *
   * @param backend the backend the turn was sent to, which giving up reports
   */
  const waitOnBusyWith =
    (backend: ModelProvider) =>
    (outgoing: Outgoing, busyError: ModelBusyError) => {
      const { text, attempt } = outgoing;
      const seconds = Math.max(1, busyError.waitSeconds ?? BUSY_WAIT_SECONDS);
      if (attempt >= BUSY_RETRIES || seconds > BUSY_WAIT_MAX_SECONDS) {
        PgAssistant.addError(`${busyError.message} ${COME_BACK_LATER}`);
        trackTurnFailureFor(backend)(busyError);
        return;
      }
      const at = Date.now();
      setNow(at);
      setWaiting({
        text,
        at: at + seconds * 1000,
        canTryNow: busyError.waitSeconds === undefined,
        attempt: attempt + 1,
        threadId: PgAssistant.threadId,
        conversation: PgAssistant.conversation,
        provider: backend,
      });
    };

  // Another thread, or a sign-out, while a message waits: it belongs to the
  // conversation it was written in, so it is dropped, not sent here. That
  // thread keeps the message, unanswered
  const threadId = PgAssistant.threadId;
  const conversation = PgAssistant.conversation;
  useEffect(() => {
    const held = waiting.current;
    if (!held) return;
    if (held.threadId === threadId && held.conversation === conversation) {
      return;
    }
    log.warn("a busy message was not sent again: the conversation changed");
    setWaiting(null);
  }, [threadId, conversation]);

  /**
   * Send the waiting message again. Taken from the ref, so a Try now and the
   * countdown reaching zero together send it once. A model changed in the
   * meantime would answer a conversation it never saw, so the thread says it
   * was not sent instead.
   */
  const resend = async () => {
    const held = waiting.current;
    if (!held) return;
    setWaiting(null);
    // The effect above drops a wait whose conversation changed, but only once
    // React commits; a click in that render must not send it either
    if (
      held.threadId !== PgAssistant.threadId ||
      held.conversation !== PgAssistant.conversation
    ) {
      return;
    }
    const current = usableConnection();
    if (!current || provider.current?.connection !== current) {
      PgAssistant.addError(NOT_RESENT);
      // The turn ends here, on this side: no backend saw the resend
      assistantTelemetry.track("assistant_turn_failed", {
        provider: held.provider,
        reason: "other",
      });
      return;
    }
    await runTurn({ text: held.text, attempt: held.attempt });
  };
  const resendRef = useRef(resend);
  resendRef.current = resend;

  // The countdown: a tick each second while a message waits
  useEffect(() => {
    if (!retry) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retry]);
  // ...and the send once it reaches zero
  useEffect(() => {
    if (!retry || retry.at > now) return;
    void resendRef.current().catch(reportButtonFailure("send again"));
  }, [retry, now]);

  const tryNow = async () => {
    if (!waiting.current?.canTryNow) return;
    await resend();
  };
  // `start` answers its own failures once a turn runs; one before that (the
  // store throwing on the new message) would be an unhandled rejection with
  // nothing on screen
  const send = (text: string): Promise<SendOutcome> =>
    start(text).catch((e: unknown) => {
      reportButtonFailure("send your message")(e);
      return "failed" as const;
    });
  // Bridges `onDidRequestPrompt`, which subscribes once, to this render's `start`
  const startRef = useRef(start);
  startRef.current = start;

  /**
   * Aborting the request is not enough on its own: a tool waiting on an
   * approval holds the agent loop open, so deny whatever is pending too.
   *
   * A stopped turn stays busy until its provider unwinds; a second Stop in
   * that window has nothing left to stop and must not say so twice. With no
   * turn running, Stop ends a busy model's countdown instead.
   */
  const stop = () => {
    if (waiting.current && !turn.current) {
      // The message stays in the thread; nothing more is sent for it
      setWaiting(null);
      PgAssistant.addNotice("Stopped.");
      // The waiting message's turn reported its send and ends here
      assistantTelemetry.track("assistant_turn_stopped", {});
      return;
    }
    if (!turn.current || turn.current.signal.aborted) return;
    turn.current.abort();
    PgAssistant.cancelPending();
    PgAssistant.addNotice(STOPPED_NOTICE);
    assistantTelemetry.track("assistant_turn_stopped", {});
  };

  // Closing the panel unmounts this hook and the countdown with it, so the
  // wait ends as a Stop; a running turn is left to finish on its own
  useEffect(
    () => () => {
      if (!waiting.current) return;
      PgAssistant.addNotice("Stopped.");
      assistantTelemetry.track("assistant_turn_stopped", {});
    },
    []
  );

  // A build error's Explain or Fix and similar callers outside the panel ask
  // for a prompt to be sent through `PgAssistant.requestPrompt`; this is the
  // only place that turns the request into an actual send
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
    const run = ({ text, send: shouldSend }: PromptRequest) => {
      if (!shouldSend) {
        place(text);
        return;
      }
      startRef.current(text).then(
        (outcome) => {
          if (outcome === "refused") place(text);
        },
        (e) => {
          place(text);
          reportButtonFailure("send the prompt")(e);
        }
      );
    };
    return PgAssistant.onDidRequestPrompt(
      (request) => {
        // Nothing is sent, so no backend is needed: the prompt takes the
        // composer and its focus whether or not one is connected
        if (!request.send) {
          place(request.text);
          return;
        }
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
            // Focused first, so Connect a model gives focus back to the
            // composer holding the prompt when it closes
            place(request.text);
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
    retry: retry && {
      secondsLeft: Math.max(0, Math.ceil((retry.at - now) / 1000)),
      canTryNow: retry.canTryNow,
    },
    tryNow,
    phase,
    busy,
    input,
    setInput,
    openConnect,
    addKey,
    promptWaiting,
    focusRequest,
  };
};
