import { DEFAULT_SKILL_IDS } from "./grounding";
import {
  closeConnection,
  listGatewayServers,
  listTools,
  LOCAL_MCP_SERVERS,
  sameConnection,
} from "@/features/mcp";
import { redactKey } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";
import { forgetBackend, rememberBackend } from "./model/remembered-backend";
import { PgSession } from "../../../features/auth";
import {
  mergeThreads,
  versionOf,
} from "../../../features/persistence/model/chat-codec";
import {
  capThread,
  MAX_MESSAGES_PER_THREAD,
  PgChatStorage,
} from "../../../features/persistence/model/chat-storage";
import { report } from "../../../features/persistence";
import { uuid } from "../../../shared/lib/ids";
import type { Disposable } from "../../../utils";
import type { McpServerEntry, McpTool } from "@/features/mcp";
import type { ModelProvider } from "@/shared/lib/ai";
import { isDefaultBackend, type Effort } from "./model/types";

const log = createLogger("assistant:store");

/** A change the assistant wants to make, waiting on the user */
export interface PatchApproval {
  type: "patch";
  path: string;
  /** Current content, or `null` when the file does not exist yet */
  before: string | null;
  after: string;
}

/** A command the assistant wants to run, waiting on the user */
export interface CommandApproval {
  type: "command";
  name: "build" | "deploy";
  /** Plain-language description of what running it will do */
  effect: string;
  /**
   * The card's title, a question naming the program, and for a deploy the
   * network and, when it could be estimated, the cost; absent on a card
   * saved without one, which falls back to its name
   */
  question?: string;
}

export type ApprovalRequest = PatchApproval | CommandApproval;

/** How an approval was answered, and which card it was asked on */
export interface ApprovalAnswer {
  id: string;
  allowed: boolean;
}

/**
 * `unanswered` exists only on a restored card: the session ended while the
 * question was still on screen. Kept apart from `denied` because the user
 * never said no, and history that puts words in their mouth is worse than
 * history that admits the turn was cut short.
 */
export type ApprovalStatus = "pending" | "allowed" | "denied" | "unanswered";

/** What every rendered item carries, whatever its kind */
interface ChatItemBase {
  /**
   * Minted on the client, so appending the same item twice -- a re-sync, or a
   * second device -- collapses on the primary key instead of duplicating.
   */
  id: string;
  /** ISO 8601. Orders a restored thread; `id` breaks ties. */
  createdAt: string;
  /**
   * ISO 8601, set on every change to an item that already exists: text
   * streaming into a reply, an approval being answered or getting its
   * outcome. Absent until the first one, so an item's version is
   * `updatedAt ?? createdAt`.
   *
   * It is what lets the server and a pull keep the newer of two copies of the
   * same id: see `mergeThreads` in `chat-codec` and `appendMessages` in
   * `conversations.mjs`.
   */
  updatedAt?: string;
}

/**
 * Which backend a thread was created with, or a reply produced by.
 *
 * Never the API key, in any form -- not the value, not a hash, not the last
 * four characters. A thread is synced to the account; the key never is.
 */
export interface BackendParams {
  provider: ModelProvider;
  /** Absent only on a backend that picks its own model server-side */
  model?: string;
  /** Only the OpenAI-compatible providers have one */
  baseUrl?: string;
  effort?: Effort;
}

/** The parameters a connection is identified by, with the key left behind */
export const paramsOf = (
  connection: Connection | null
): BackendParams | undefined => {
  if (!connection) return undefined;

  const params: BackendParams = { provider: connection.id };
  const model = connection.endpoint?.model ?? connection.settings?.model;
  if (model) params.model = model;
  if (connection.endpoint?.baseUrl)
    params.baseUrl = connection.endpoint.baseUrl;
  if (connection.settings?.effort) params.effort = connection.settings.effort;
  return params;
};

export type ChatItem =
  | (ChatItemBase & { kind: "user"; text: string })
  | (ChatItemBase & {
      kind: "assistant";
      text: string;
      /**
       * What produced this reply. Absent on a thread restored from before
       * replies recorded it, and on one written while nothing was connected.
       */
      origin?: BackendParams;
    })
  | (ChatItemBase & { kind: "tool"; label: string })
  | (ChatItemBase & {
      kind: "approval";
      request: ApprovalRequest;
      status: ApprovalStatus;
      /** Set once the tool has actually run */
      outcome?: string;
    })
  | (ChatItemBase & { kind: "error"; text: string })
  /** Something the panel did, not the model — e.g. the user stopped the turn */
  | (ChatItemBase & { kind: "notice"; text: string });

/**
 * Whether the turn ending at the last item already produced an approval card.
 *
 * "Make this change" is offered on a finished reply, but never on one whose
 * turn already wrote its patch — asking again just rewrites the same file.
 */
export const turnProducedApproval = (items: readonly ChatItem[]) => {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") return false;
    if (items[i].kind === "approval") return true;
  }
  return false;
};

/**
 * Whether the turn ending at the last item actually wrote something.
 *
 * Stricter than `turnProducedApproval`, which counts a card the user denied.
 * An action offered on the strength of a rejected patch would point at code
 * that is not there.
 */
export const turnAppliedApproval = (items: readonly ChatItem[]) => {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user") return false;
    if (item.kind === "approval" && item.status === "allowed") return true;
  }
  return false;
};

/** Shown when disconnecting could not remove the key from this tab */
export const KEY_NOT_FORGOTTEN =
  "Your key could not be removed from this tab's storage. Close this tab to " +
  "remove it.";

/**
 * Shown on a thread that could not be read. Its file may still be recoverable
 * by hand, so nothing is written over it -- which means nothing typed here is
 * kept either, and the user has to be told.
 */
export const THREAD_NOT_SAVED =
  "This conversation could not be read from this device's storage, so new " +
  "messages here are not saved.";

/** Whether the open thread may be written, and why not -- see `_writes` */
type ThreadWrites = "open" | "reading" | "unreadable";

/** Which backend the panel is talking to, and what it needs to reach it */
export interface Connection {
  id: ModelProvider;
  apiKey: string;
  endpoint?: { baseUrl: string; model: string };
  /** Model and effort, for backends that pick them without a base URL */
  settings?: { model: string; effort: Effort };
}

/** A prompt the panel is asked to run on the user's behalf */
export interface PromptRequest {
  text: string;
  /** `false` puts it in the composer instead, for the user to edit and send */
  send: boolean;
}

/** What the panel is doing right now */
export type AssistantStatus =
  /** Waiting for the user to type */
  | "idle"
  /** A turn is in flight */
  | "running"
  /** A turn is in flight but blocked on an approval */
  | "awaiting";

/**
 * How long a cut turn may take to unwind before it is reported. Long enough
 * for a build or a deploy already under way to come back on its own.
 */
const CUT_TURN_OVERDUE_MS = 120_000;

const makeId = uuid;
const now = () => new Date().toISOString();

let lastCreated = 0;

/**
 * When a new item is made: now, but strictly later than the item made before
 * it in this tab. Items are ordered by `createdAt` wherever threads merge
 * (`mergeThreads`), and a tie falls to the id, which is random, so a message
 * and the reply started in the same millisecond came back either way round.
 */
const created = () => {
  lastCreated = Math.max(Date.now(), lastCreated + 1);
  return new Date(lastCreated).toISOString();
};

/**
 * Mark an existing item as changed now.
 *
 * Strictly later than its previous version, even when the clock says
 * otherwise: two deltas in one millisecond, or a clock stepped backwards,
 * would otherwise give the newer copy a version that does not beat the older
 * one, and the server would keep the shorter reply.
 *
 * In memory only. Persisting is the caller's `_emit`, which every mutator
 * makes anyway, so stamping adds no storage write of its own -- not even per
 * streamed token, where `_emit` already writes once.
 */
const stamp = (item: ChatItem) => {
  const at = now();
  // `NaN` for a version that does not parse, which compares false and so
  // falls through to the clock rather than throwing on `new Date(NaN)`
  const previous = versionOf(item);
  item.updatedAt =
    previous >= Date.parse(at) ? new Date(previous + 1).toISOString() : at;
};

/**
 * Whether `items` holds anything `stored` lacks, or a newer copy of what it
 * has. A version that does not parse counts as newer, so nothing is judged
 * already kept on a guess.
 */
const holdsNewer = (
  items: readonly ChatItem[],
  stored: readonly ChatItem[]
) => {
  const versions = new Map(stored.map((item) => [item.id, versionOf(item)]));
  return items.some(
    (item) => !(versionOf(item) <= (versions.get(item.id) ?? NaN))
  );
};

const isSame = (a: Connection | null, b: Connection) =>
  !!a &&
  a.id === b.id &&
  a.apiKey === b.apiKey &&
  a.endpoint?.baseUrl === b.endpoint?.baseUrl &&
  a.endpoint?.model === b.endpoint?.model &&
  a.settings?.model === b.settings?.model &&
  a.settings?.effort === b.settings?.effort;

/**
 * Everything the panel renders.
 *
 * The API key is held in memory and in this tab's `sessionStorage`, so a
 * reload keeps it; it is never written anywhere durable. See
 * `remembered-backend` and the spec `openspec/specs/assistant-own-key/spec.md`.
 * Conversation items are durable: the open thread is mirrored to IndexedDB on
 * every change under its own thread id, which `PgThreadIndex` maps from the
 * workspace, so a reload and a project switch both come back to the right
 * conversation. See `docs/persistent-conversations-spec.md`.
 */
export class PgAssistant {
  static get items(): readonly ChatItem[] {
    return PgAssistant._items;
  }

  static get status() {
    return PgAssistant._status;
  }

  /**
   * Which backend is selected, and its key. Held in memory; a key-based one is
   * also kept in this tab's `sessionStorage` by `rememberBackend`.
   */
  static get connection() {
    return PgAssistant._connection;
  }

  static get isConnected() {
    return !!PgAssistant._connection;
  }

  /** Whether Connect a model is open; reconnects stand down while it is */
  static get isPickingBackend() {
    return PgAssistant._pickingBackend;
  }

  /**
   * Choose a backend for this tab.
   *
   * Re-picking the current one keeps the conversation and marks Connect a
   * model closed; switching
   * to a different one starts a new conversation, because the history lives
   * inside the provider and the new one cannot see the old transcript.
   *
   * Connecting when nothing is connected is *not* a switch, and must not reset
   * anything. The live connection starts empty after every reload, and by the
   * time one is made -- the user's pick, or `useTurn`'s reconnect on load from
   * `remembered-backend` -- `chat-thread` may already have restored this
   * workspace's conversation from storage. Treating that as a switch cleared
   * the restored thread on every single reload.
   *
   * @param connection which provider, its key, and whatever it needs to be
   * reached — a base URL and model, or a model and effort
   */
  static connect(connection: Connection) {
    const next: Connection = {
      ...connection,
      apiKey: connection.apiKey.trim(),
    };
    if (PgAssistant._connection && !PgAssistant.isCurrent(next)) {
      PgAssistant.clear();
    }
    PgAssistant._connection = next;
    PgAssistant._pickingBackend = false;
    // So a reload of this tab reconnects without asking again: the keyless
    // default by id, a key-based backend whole for this tab only. See
    // `remembered-backend`.
    rememberBackend(next);

    // `_emitOnly`, because nothing here is the user writing to the
    // conversation. `clear` above goes out of its way to leave the stored
    // thread alone, and `_emit` would write the emptied list straight back
    // over it -- undoing that, one line later.
    PgAssistant._emitOnly();
  }

  /**
   * Switch the model or effort on the connected backend, keeping the thread.
   *
   * Does not `clear`, unlike `connect` with a different connection: the
   * provider for the next turn is rebuilt from what is rendered (`useTurn`
   * compares connection identity), so the new settings apply to the
   * next turn and the transcript on screen stays the history it works from.
   * Remembered as `connect` remembers, so a reload of this tab keeps the new
   * model and effort. `_emitOnly` for the same reason as `connect`: nothing
   * here is the user writing to the conversation.
   *
   * @throws when `canTune(next)` is false
   */
  static tune(next: Connection) {
    if (!PgAssistant.canTune(next)) {
      throw new Error("tune changes model or effort, not the backend");
    }
    PgAssistant._connection = next;
    rememberBackend(next);
    PgAssistant._emitOnly();
  }

  /** Whether `tune(next)` would take it: the connected backend, with its key */
  static canTune(next: Connection) {
    const current = PgAssistant._connection;
    return (
      !!current && current.id === next.id && current.apiKey === next.apiKey
    );
  }

  /** Whether connecting with these settings would keep the conversation */
  static isCurrent(next: Connection) {
    return isSame(PgAssistant._connection, next);
  }

  /** Mark Connect a model open, keeping the conversation */
  static pickBackend() {
    PgAssistant._pickingBackend = true;
    PgAssistant._emit();
  }

  /**
   * Whether the connection is the default backend while nobody is signed in.
   * `/api/agent` refuses every turn then, so `useTurn` treats it as nothing
   * connected and a send opens Connect a model, which offers sign-in.
   */
  static get needsSignIn() {
    return isDefaultBackend(PgAssistant._connection?.id) && !PgSession.get();
  }

  /** Mark Connect a model closed without changing anything */
  static keepBackend() {
    PgAssistant._pickingBackend = false;
    PgAssistant._emit();
  }

  /**
   * Drop the backend and the key, and clear the conversation with it.
   *
   * What Forget key in the assistant head's More does. If the key could not be
   * removed from this tab's storage, a notice says how to get rid of it.
   */
  static disconnect() {
    PgAssistant._connection = null;
    PgAssistant._pickingBackend = false;
    // Disconnecting is the user saying *not* to reconnect; without this the
    // next load would quietly undo it
    const forgotten = forgetBackend();
    PgAssistant.clear();
    if (forgotten) return;

    // `_emitOnly`, like `clear`: the notice is about this tab, and `_emit`
    // would write it over the stored conversation `clear` just left alone
    PgAssistant._items.push({
      kind: "notice",
      id: makeId(),
      createdAt: created(),
      text: KEY_NOT_FORGOTTEN,
    });
    PgAssistant._emitOnly();
  }

  /** Which skills the model may load this session */
  static get enabledSkillIds(): readonly string[] {
    return PgAssistant._enabledSkillIds;
  }

  static setSkillEnabled(id: string, enabled: boolean) {
    const ids = PgAssistant._enabledSkillIds.filter((i) => i !== id);
    PgAssistant._enabledSkillIds = enabled ? [...ids, id] : ids;
    PgAssistant._emit();
  }

  /**
   * Every MCP server, enabled or not: the gateway's own, then local additions.
   *
   * Held as two lists because they have different owners. The gateway decides
   * what it serves and the client cannot edit that; a local entry is an
   * addition. Merging them into one editable list would let Apply silently
   * delete a server the gateway still offers.
   *
   * Ids are unique: a local entry whose id the gateway serves is left out,
   * because tool names and connections are keyed by id.
   */
  static get mcpServers(): readonly McpServerEntry[] {
    const gatewayIds = new Set(PgAssistant._gatewayServers.map((s) => s.id));
    return [
      ...PgAssistant._gatewayServers,
      ...PgAssistant._localServers.filter((s) => !gatewayIds.has(s.id)),
    ];
  }

  /** Local entries the gateway took over by serving the same id; kept for when it stops */
  static get shadowedMcpServers(): readonly McpServerEntry[] {
    const gatewayIds = new Set(PgAssistant._gatewayServers.map((s) => s.id));
    return PgAssistant._localServers.filter((s) => gatewayIds.has(s.id));
  }

  /** The gateway's own upstreams, as it reported them */
  static get gatewayMcpServers(): readonly McpServerEntry[] {
    return PgAssistant._gatewayServers;
  }

  /** Only the entries the user added, which is what the editor edits */
  static get localMcpServers(): readonly McpServerEntry[] {
    return PgAssistant._localServers;
  }

  /** The servers a turn should actually declare */
  static get enabledMcpServers(): readonly McpServerEntry[] {
    return PgAssistant.mcpServers.filter((s) => s.enabled && s.url.trim());
  }

  /** Replace the local additions — edited as one JSON document */
  static setMcpServers(servers: readonly McpServerEntry[]) {
    PgAssistant._replaceServers(() => {
      PgAssistant._localServers = servers;
    });
    PgAssistant._emit();
  }

  /**
   * Apply a change to either server list, closing the connection of every id
   * it removes or points at another URL, and dropping that id's cached tools.
   */
  private static _replaceServers(change: () => void) {
    const before = PgAssistant.mcpServers;
    change();
    const after = new Map(PgAssistant.mcpServers.map((s) => [s.id, s]));
    // Another connection under the same id (an edit, or the gateway taking over a local id) is another server's session and tools
    const gone = before
      .filter((server) => {
        const next = after.get(server.id);
        return !next || !sameConnection(next, server);
      })
      .map((server) => server.id);
    for (const id of gone) closeConnection(id);
    if (gone.length) {
      const tools = { ...PgAssistant._mcpTools };
      for (const id of gone) delete tools[id];
      PgAssistant._mcpTools = tools;
    }
  }

  /**
   * Ask the gateway what it serves.
   *
   * Failure is not surfaced: running under a plain `craco start` there is no
   * `/api`, and that should leave the panel working with local additions and
   * skills rather than showing an error nobody can act on.
   */
  static async loadMcpServers() {
    try {
      const gateway = await listGatewayServers();
      PgAssistant._replaceServers(() => {
        PgAssistant._gatewayServers = gateway;
      });
      PgAssistant._emit();
    } catch (err) {
      console.warn("MCP gateway unavailable; using local servers only", err);
    }
  }

  /** Learn what exists, then what it offers. Safe to call on every mount. */
  static async initMcp() {
    await PgAssistant.loadMcpServers();
    await PgAssistant.discoverMcpTools();
  }

  /**
   * Tools discovered from each server, by server id.
   *
   * Cached because discovery is a network round trip and `createTools()` is
   * synchronous — a server missing from here contributes no tools this turn
   * rather than blocking it.
   */
  static get mcpTools(): Readonly<Record<string, readonly McpTool[]>> {
    return PgAssistant._mcpTools;
  }

  /**
   * Discover one server's tools and cache them under its id.
   *
   * The result is dropped when the id now names another connection or is off,
   * so a discovery that outlived a takeover or an edit cannot restore the old tools.
   *
   * @throws what {@link listTools} throws
   */
  static async discoverToolsOf(server: McpServerEntry) {
    const tools = await listTools(server);
    const current = PgAssistant.enabledMcpServers.find(
      (s) => s.id === server.id
    );
    if (!current || !sameConnection(current, server)) {
      log.debug("Dropped tools discovered on a replaced MCP server", {
        context: { server: server.id },
      });
      return;
    }
    PgAssistant._mcpTools = { ...PgAssistant._mcpTools, [server.id]: tools };
    PgAssistant._emit();
  }

  /**
   * Discover tools for every enabled server.
   *
   * Called when the panel mounts, not only from the Sources tab: `createTools`
   * reads this cache, so a model connected before discovery ran would simply
   * not be offered any MCP tool — with nothing on screen to explain why.
   *
   * Failures are left out rather than raised: a server being unreachable is a
   * fact about that server, and the console is where it gets explained.
   *
   * @param force re-read servers already cached, for when the config changed
   */
  static async discoverMcpTools(force = false) {
    const servers = PgAssistant.enabledMcpServers.filter(
      (server) => force || !PgAssistant._mcpTools[server.id]
    );

    await Promise.all(
      servers.map(async (server) => {
        try {
          await PgAssistant.discoverToolsOf(server);
        } catch (err) {
          console.warn(`MCP server ${server.id}: tool discovery failed`, err);
        }
      })
    );
  }

  static setStatus(status: AssistantStatus) {
    PgAssistant._status = status;
    PgAssistant._emit();
  }

  /**
   * Register the turn in flight, so that closing the open thread cuts it off.
   *
   * The panel owns the turn, but the thread can close under it from outside
   * (`closeThread`: a workspace switch, sign-out, a thread the server
   * deleted). Left running, a turn would keep calling the backend, and its
   * tool rows, notices and errors would land in whichever thread opened next
   * -- under sign-out, the previous user's turn in the next account's
   * conversation.
   *
   * @param controller aborts the turn's request; the store aborts it when the
   * thread closes, or on `stopTurn`
   */
  static beginTurn(controller: AbortController) {
    PgAssistant._turn = { controller, cut: false };
  }

  /**
   * Unregister the turn.
   *
   * @param controller the one passed to `beginTurn`
   * @returns `true` when the turn ran to its end uncut; `false` when a closed
   * thread or `stopTurn` cut it off, or `controller` is not the turn
   * registered. On `false` the caller must not push the thread open now as
   * this turn's result: it holds nothing of the turn.
   */
  static endTurn(controller: AbortController) {
    const turn = PgAssistant._turn;
    if (turn?.controller !== controller) return false;
    if (turn.overdue) clearTimeout(turn.overdue);
    PgAssistant._turn = null;
    return !turn.cut;
  }

  /**
   * Whether a turn is in flight, including one cut off and still unwinding.
   *
   * The panel reads this, not its own state, to decide whether it may start
   * another: leaving a thread resets `status` to idle, and a remounted panel
   * has lost its controller, while the cut turn can still write. A new turn
   * begun over it would replace `_turn` and let those writes through.
   */
  static get turnRunning() {
    return PgAssistant._turn !== null;
  }

  /**
   * Cut off the turn in flight whether or not a thread is open.
   *
   * For sign-out: the panel works with no thread open, and `closeThread` then
   * has nothing to close, so a turn running there would carry on for the next
   * account. Opening a thread does not cut a turn: that thread adopts what
   * the turn has written and what it writes next.
   */
  static stopTurn() {
    PgAssistant._cutTurn();
    // Not persisted: with a thread open the caller is leaving it, and with
    // none open there is nowhere to write
    PgAssistant._emitOnly();
  }

  /**
   * Stop the turn writing to the panel: abort its request and refuse the
   * items it would add (`_dropsCut`) until it ends.
   *
   * Aborting stops the request, but a provider unwinds on its own schedule: a
   * tool already running reports, and the stream's last chunk may already be
   * read. Writes into items the turn made before the cut miss because the
   * caller replaces `_items` (`closeThread`) or drops them (`clear`). No new
   * turn can overlap: the panel starts none while `turnRunning`.
   */
  private static _cutTurn() {
    const turn = PgAssistant._turn;
    if (!turn || turn.cut) return;
    turn.cut = true;
    turn.controller.abort();
    // Denied here as well as by `closeThread`, which returns early with no
    // thread open: an approval the cut turn waits on holds the turn open
    PgAssistant._denyPending();
    // The panel refuses new turns until this one ends, so one whose provider
    // ignores the abort (a hung tool, a fetch without the signal) is a bug
    // the team has to hear of
    turn.overdue = setTimeout(() => {
      log.error(new Error("a cut turn has not ended"), {
        report: true,
        context: { afterMs: CUT_TURN_OVERDUE_MS },
      });
    }, CUT_TURN_OVERDUE_MS);
  }

  /**
   * Whether a write now comes from a cut turn, and is to be dropped. Logged,
   * since anything else that writes while the turn unwinds is dropped too.
   */
  private static _dropsCut(kind: ChatItem["kind"], text: string) {
    if (!PgAssistant._turn?.cut) return false;
    log.debug(`dropped a ${kind} written while a cut turn unwinds`, {
      context: { text },
    });
    return true;
  }

  /**
   * Bumped whenever what is rendered is dropped while the same thread (or
   * none) stays open, so a provider seeded from it starts afresh: `threadId`
   * alone does not change then.
   */
  static get conversation() {
    return PgAssistant._conversation;
  }

  static addUserMessage(text: string) {
    PgAssistant._items.push({
      kind: "user",
      id: makeId(),
      createdAt: created(),
      text,
    });
    PgAssistant._emit();
  }

  /**
   * Ask the panel to send a prompt on the user's behalf - e.g. "Fix with
   * assistant" on a build error card.
   *
   * The panel itself owns the actual send (its provider lives in a ref
   * inside `useTurn`), so this only notifies; it does not append a message
   * itself.
   *
   * Observers subscribe too and never send: `Flow` reopens the panel when it
   * is collapsed, `Assistant` switches to the chat tab. `useTurn` is the only
   * subscriber that can act on a request, so with none registered the request
   * is buffered in `_pendingPrompt` until one mounts a moment later and claims
   * it -- which is exactly the collapsed-panel case.
   *
   * @param text the prompt to send
   * @param opts `send: false` leaves it in the composer for the user to edit,
   * which is what a prompt they did not type themselves wants
   */
  static requestPrompt(text: string, opts?: { send?: boolean }) {
    const request = { text, send: opts?.send !== false };
    PgAssistant._pendingPrompt = PgAssistant._promptSenders.size
      ? null
      : request;
    for (const cb of PgAssistant._promptListeners) cb(request);
  }

  /**
   * @param cb runs whenever `requestPrompt` is called. Not called on
   * subscribe with anything new - this is an event, not state, same as
   * `onDidChange` - except a prompt left buffered by `requestPrompt` (see
   * above), which only a `sends` subscriber claims, since an observer cannot
   * act on it.
   * @param opts `sends: true` marks the subscriber that can actually run a
   * prompt, and so the one whose absence makes a request worth buffering
   * @returns a disposable to clear the event
   */
  static onDidRequestPrompt(
    cb: (request: PromptRequest) => void,
    opts?: { sends?: boolean }
  ): Disposable {
    PgAssistant._promptListeners.add(cb);
    if (opts?.sends) PgAssistant._promptSenders.add(cb);

    if (opts?.sends && PgAssistant._pendingPrompt !== null) {
      const pending = PgAssistant._pendingPrompt;
      PgAssistant._pendingPrompt = null;
      cb(pending);
    }

    return {
      dispose: () => {
        PgAssistant._promptListeners.delete(cb);
        PgAssistant._promptSenders.delete(cb);
      },
    };
  }

  /** Start an assistant message and return its id so text can stream into it */
  static startAssistantMessage() {
    const id = makeId();
    // An id all the same: the provider streams into it, and finds nothing
    if (PgAssistant._dropsCut("assistant", "")) return id;
    // Stamped here because this is the only moment the panel knows what is
    // answering. A thread records the backend it was created with; a reply
    // records the one that wrote it, and the two differ as soon as the user
    // switches backends. Spread rather than assigned, so a reply written with
    // nothing connected has no `origin` key at all rather than an empty one.
    const origin = paramsOf(PgAssistant._connection);
    PgAssistant._items.push({
      kind: "assistant",
      id,
      createdAt: created(),
      text: "",
      ...(origin ? { origin } : {}),
    });
    PgAssistant._emit();
    return id;
  }

  static appendToAssistantMessage(id: string, delta: string) {
    const item = PgAssistant._items.find((i) => i.id === id);
    if (item?.kind === "assistant") {
      item.text += delta;
      stamp(item);
      PgAssistant._emit();
    }
  }

  static addToolCall(label: string) {
    if (PgAssistant._dropsCut("tool", label)) return;
    PgAssistant._items.push({
      kind: "tool",
      id: makeId(),
      createdAt: created(),
      label,
    });
    PgAssistant._emit();
  }

  static addNotice(text: string) {
    if (PgAssistant._dropsCut("notice", text)) return;
    PgAssistant._items.push({
      kind: "notice",
      id: makeId(),
      createdAt: created(),
      text,
    });
    PgAssistant._emit();
  }

  static addError(text: string) {
    if (PgAssistant._dropsCut("error", text)) return;
    PgAssistant._items.push({
      kind: "error",
      id: makeId(),
      createdAt: created(),
      text: redactKey(text, PgAssistant._connection?.apiKey),
    });
    PgAssistant._emit();
  }

  /**
   * Ask the user to approve something.
   *
   * The promise settles when they click, which is what holds the agent loop
   * open — the tool's `run` does not return until then.
   *
   * The card's id comes back with the answer so the caller can record the
   * outcome on *this* card. Looking up "the latest card" afterwards found
   * whichever card was added last, and the Anthropic runner executes a
   * turn's tool calls concurrently: with two gated tools, both outcomes landed
   * on the second card and the first got none.
   *
   * A cut turn (`stopTurn`, or its thread closed) is refused without a card:
   * nobody is left to answer it, and the tool must not run.
   *
   * @param request what needs approving
   * @returns the card's id, and whether the user allowed it
   */
  static requestApproval(request: ApprovalRequest): Promise<ApprovalAnswer> {
    const id = makeId();
    if (PgAssistant._dropsCut("approval", request.type)) {
      return Promise.resolve({ id, allowed: false });
    }
    PgAssistant._items.push({
      kind: "approval",
      id,
      createdAt: created(),
      request,
      status: "pending",
    });
    PgAssistant._status = "awaiting";
    PgAssistant._emit();

    return new Promise((resolve) => {
      PgAssistant._pending.set(id, (allowed) => resolve({ id, allowed }));
    });
  }

  /** Resolve a pending approval */
  static resolveApproval(id: string, allowed: boolean) {
    const item = PgAssistant._items.find((i) => i.id === id);
    if (item?.kind !== "approval" || item.status !== "pending") return;

    item.status = allowed ? "allowed" : "denied";
    stamp(item);
    PgAssistant._status = "running";
    PgAssistant._emit();

    PgAssistant._pending.get(id)?.(allowed);
    PgAssistant._pending.delete(id);
  }

  /** Record what happened after an approved tool actually ran */
  static setApprovalOutcome(id: string, outcome: string) {
    const item = PgAssistant._items.find((i) => i.id === id);
    if (item?.kind === "approval") {
      item.outcome = outcome;
      stamp(item);
      PgAssistant._emit();
    }
  }

  /** Deny everything still waiting — used when a turn is abandoned */
  static cancelPending() {
    PgAssistant._denyPending();
    PgAssistant._emit();
  }

  /**
   * Deny what is waiting, without notifying or writing back.
   *
   * Leaving a thread has to resolve its blocked promises, but must not persist
   * on the way out: at that moment the items still belong to the thread being
   * left while the caller is already pointing elsewhere. The stored copy needs
   * no fixing either — the codec writes a pending approval as `unanswered`,
   * because nothing could ever resolve it after a reload.
   */
  private static _denyPending() {
    for (const [id, resolve] of PgAssistant._pending) {
      const item = PgAssistant._items.find((i) => i.id === id);
      // Stamped too: `cancelPending` persists this, and a stopped turn's card
      // reading as denied is a change the account should keep
      if (item?.kind === "approval") {
        item.status = "denied";
        stamp(item);
      }
      resolve(false);
    }
    PgAssistant._pending.clear();
    PgAssistant._status = "idle";
  }

  /**
   * Drop what is rendered, keeping the stored thread.
   *
   * Called when the backend changes, which starts a new conversation with the
   * provider but is not the user deleting anything — so it deliberately does
   * not write back. `_emitOnly` rather than `_emit` is what makes that true.
   * Also called by sign-out, to drop what the panel holds with no thread
   * open, which the next account's thread would otherwise adopt; `conversation`
   * changes, so the provider forgets it too.
   */
  static clear() {
    PgAssistant._conversation++;
    PgAssistant._denyPending();
    // Not while a read is out: what is rendered then is only what was typed
    // during it, written nowhere yet, and the read adopts it from this very
    // list -- a new one would leave it, and anything typed after, unkept
    if (PgAssistant._writes !== "reading") PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();
  }

  /** Which thread is open, or `null` before one has been chosen */
  static get threadId() {
    return PgAssistant._threadId;
  }

  /**
   * Whether the open thread could not be read, so nothing typed into it is
   * saved. The panel shows `THREAD_NOT_SAVED` while it is.
   */
  static get unsaved() {
    return PgAssistant._writes === "unreadable";
  }

  /**
   * Close the open thread without touching what is stored.
   *
   * Called whenever the panel leaves a thread: a workspace switch, no
   * workspace to key a conversation on, sign-out, a thread the server
   * deleted. The panel still renders and still works with none open, it just
   * has nowhere to persist to, so it must not keep writing into whichever
   * thread happened to be open last.
   *
   * With a thread open, a turn still running is cut off (`_cutTurn`): its
   * request is aborted and what it adds is dropped until it ends. With none
   * open this returns early and the turn runs on; sign-out cuts it with
   * `stopTurn`.
   */
  static closeThread() {
    // Nothing open is nothing to close. Clearing anyway would throw away
    // messages typed before the first thread finished resolving -- the ones
    // `loadThread` is about to adopt -- and the explorer announces a switch
    // late enough for that to be an ordinary sequence, not a rare one.
    if (PgAssistant._threadId === null) return;

    PgAssistant._cutTurn();
    PgAssistant._denyPending();
    PgAssistant._threadId = null;
    // A read still out for the closed thread is stale from here on, even if
    // the same thread opens again before it lands
    PgAssistant._loadSeq++;
    PgAssistant._writes = "open";
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();
  }

  /**
   * Open a thread, replacing whatever is rendered.
   *
   * Called when the workspace changes, after `closeThread`. Anything still
   * awaiting approval is denied rather than carried across. A running turn is
   * not cut: a workspace switch has cut it in `closeThread` already, and a
   * turn started with no thread open carries on into the thread opened. Sync
   * moving the open workspace to another thread id uses `repointThread`
   * instead, which keeps memory while it reads.
   *
   * The id is claimed before the read so a second switch landing mid-read can
   * be detected and its result discarded — otherwise a slow read for project A
   * would repaint the panel after the user has already moved to B.
   *
   * A call for the thread that is already open does nothing -- but waits for
   * that thread's read when it is still out. Returning at once let a caller
   * act on the empty list standing in for it: `foldIn` merged the server's
   * copy into that list, and the read then landing appended the stored
   * thread to it as though every item had arrived mid-read, so each synced
   * message appeared twice.
   *
   * @param threadId the thread to open
   * @param force re-read even if this thread is already open, for when sync
   * has just rewritten it underneath
   */
  static async loadThread(threadId: string, force = false) {
    if (!force && PgAssistant._threadId === threadId) {
      await PgAssistant._settled(threadId);
      return;
    }

    const loading = { threadId, done: PgAssistant._load(threadId) };
    PgAssistant._loading = loading;
    try {
      await loading.done;
    } finally {
      if (PgAssistant._loading === loading) PgAssistant._loading = null;
    }
  }

  /**
   * Move the open thread to another id, keeping the conversation in memory.
   *
   * For sync adopting the account's thread for the open workspace
   * (`openThread`): the same conversation under the id the account knows,
   * possibly mid-turn. `loadThread` replaced memory with an empty list while
   * it read the new id, so chunks streamed meanwhile found no message to
   * append to and the saved reply had a hole; it also denied the approval the
   * turn waited on. Here what is rendered stays in memory, `to`'s stored copy
   * is merged into it as `foldIn` merges the server's, and the turn, the
   * status and pending approvals carry on untouched.
   *
   * `from`'s file is removed once its queued writes land. `adoptAccountThread`
   * has already merged it into `to` and removed it, but a write the turn
   * queued before the move would bring it back as a thread no workspace
   * points at.
   *
   * @param from the thread open now
   * @param to the thread the workspace points at instead
   * @returns whether `from` was open and the panel is now on `to`
   */
  static async repointThread(from: string, to: string) {
    await PgAssistant._settled(from);
    if (PgAssistant._threadId !== from) return false;

    PgAssistant._threadId = to;
    const seq = ++PgAssistant._loadSeq;
    // Closed to writes until `to` is read: memory lacks what `to` holds, and
    // a write now would replace it
    PgAssistant._writes = "reading";
    // Registered as `to`'s read, so a `foldIn` or `loadThread` of `to` waits
    // for the merge instead of landing in the middle of it
    const loading = { threadId: to, done: PgAssistant._repoint(from, to, seq) };
    PgAssistant._loading = loading;
    try {
      return await loading.done;
    } finally {
      if (PgAssistant._loading === loading) PgAssistant._loading = null;
    }
  }

  private static async _repoint(from: string, to: string, seq: number) {
    // Captured for an overtaken move: the close or load overtaking it
    // replaces `_items`, and what was typed in the meantime is `to`'s
    const live = PgAssistant._items;

    await PgAssistant._afterThreadWrites(to);
    const stored = await PgChatStorage.read(to);
    if (PgAssistant._loadSeq !== seq) {
      PgAssistant._keepOvertaken(to, live);
      return false;
    }

    // As in `_load`: an unreadable `to` is shown from memory but not written
    // over, and `from` is kept, since it may hold what `to` cannot give back
    PgAssistant._writes = stored === null ? "unreadable" : "open";
    PgAssistant._items = capThread(
      to,
      mergeThreads(stored ?? [], live),
      Math.max(MAX_MESSAGES_PER_THREAD, live.length)
    );
    PgAssistant._emit();
    if (stored !== null) PgAssistant._dropMoved(from, to);
    return true;
  }

  /**
   * Remove `from` once `to`, as stored, holds every item of it at least as
   * new.
   *
   * Checked against storage rather than trusting the write queued for `to`:
   * `PgChatStorage.write` reports a failure and returns, and `from` may then
   * hold the only stored copy of what the turn wrote last.
   */
  private static _dropMoved(from: string, to: string) {
    PgAssistant._enqueue(from, async () => {
      const [left, moved] = await Promise.all([
        PgChatStorage.read(from),
        PgChatStorage.read(to),
      ]);
      if (left === null || moved === null) return;

      if (!holdsNewer(left, moved)) {
        await PgChatStorage.remove(from);
        return;
      }
      // `report` appends "failed" to this
      report(`move ${from} to ${to}: ${from} kept, as ${to} lacks it`, null);
    });
  }

  /** Once `threadId`'s read has landed, if one is in flight */
  private static async _settled(threadId: string) {
    const loading = PgAssistant._loading;
    if (loading?.threadId === threadId) await loading.done;
  }

  private static async _load(threadId: string) {
    // Messages sitting in a panel with no thread open belong to nothing yet:
    // the thread that opens adopts them, rather than what the user typed
    // vanishing because a read was still in flight. On a switch there *is* a
    // previous thread and its messages stay with it, which is why this is
    // conditional -- see `effects/chat-thread`, which closes the old thread
    // before resolving the new one so the gap has no owner.
    const orphans = PgAssistant._threadId === null ? PgAssistant._items : [];

    PgAssistant._denyPending();
    PgAssistant._threadId = threadId;
    const seq = ++PgAssistant._loadSeq;
    // Kept by reference: messages sent during the read are pushed onto it,
    // and it is what holds them if the read is overtaken before it lands
    const gap: ChatItem[] = [];
    PgAssistant._items = gap;
    PgAssistant._status = "idle";
    // Closed to writes until the read lands. `_items` is a stand-in for the
    // thread until then, and any `_emit` in the gap -- MCP discovery on a
    // reload, say -- would write it over the stored thread, behind a read
    // that still returns the old content: memory right, storage `[]`.
    // Messages sent meanwhile are adopted when the read lands, and written
    // unless it failed.
    PgAssistant._writes = "reading";
    PgAssistant._emitOnly();

    // After this thread's queued writes, such as what `_keepOvertaken` kept
    // for it: a read issued first would come back without them, and the next
    // write from memory would replace the file that had them. Only this
    // thread's, so another thread's write that is slow, or never settles,
    // does not hold a load with nothing of its own queued behind it
    await PgAssistant._afterThreadWrites(threadId);
    const items = await PgChatStorage.read(threadId);
    // By load, not by thread id: A -> B -> A faster than a read leaves the
    // same id open, and the first read passing for the current one dropped
    // what was typed in its gap and handed the second read its whole thread
    // to adopt, so every item showed twice
    if (PgAssistant._loadSeq !== seq) {
      PgAssistant._keepOvertaken(threadId, [...orphans, ...gap]);
      return;
    }

    // A thread that could not be read renders as empty -- there is nothing
    // else the panel can show -- but it must not be *persisted* as empty. The
    // next `_persist()` would write this back over a file that may still be
    // recoverable, so the thread stays closed to writes until it reads
    // cleanly, and the panel says so (`unsaved`).
    // `__pgChatStorage.lastFailure` says why. A clean read is also what opens
    // the thread to writes again, closed since the read began. Set before the
    // emit below, which is where `_persist` reads it.
    PgAssistant._writes = items === null ? "unreadable" : "open";

    // Whatever is in `_items` now arrived during the read, for this thread
    const adopted = [...orphans, ...PgAssistant._items];
    PgAssistant._items = [...(items ?? []), ...adopted];
    // `_emit` rather than `_emitOnly` when something was adopted: those
    // messages have never been written down under this thread. On an
    // unreadable thread `_persist` declines regardless, so they stay on
    // screen without overwriting a file that may still be recoverable.
    if (adopted.length) PgAssistant._emit();
    else PgAssistant._emitOnly();
  }

  /**
   * Keep what was typed during a read that was overtaken before it landed,
   * or what an overtaken `repointThread` held.
   *
   * With writes closed it was never written, and the close or the next load
   * took it off screen: it belongs to `threadId`, so it is not dropped. An
   * item already stored is written again when this copy is newer.
   *
   * - The same thread is open again: it goes onto what is rendered, where
   *   that load adopts it, or writes it now if its read has landed.
   * - Another thread, or none, is open: it is written after what is stored
   *   by then, on the write queue.
   * - The thread could not be read: nothing is written over it, and the loss
   *   is reported, since nothing else would say so.
   */
  private static _keepOvertaken(threadId: string, unwritten: ChatItem[]) {
    if (!unwritten.length) return;

    if (PgAssistant._threadId === threadId) {
      // In place, in the order they were typed: a newer load of this thread
      // may still hold this list, and what was typed during it is newer
      const all = mergeThreads(PgAssistant._items, unwritten);
      PgAssistant._items.splice(0, PgAssistant._items.length, ...all);
      PgAssistant._emit();
      return;
    }

    // Merged into the thread as it is when the write's turn comes, not into
    // the copy this read saw: two overtaken reads of one thread saw the same
    // copy, and writing each one's own let the second replace the first
    PgAssistant._enqueue(threadId, async () => {
      const stored = await PgChatStorage.read(threadId);
      if (stored === null) {
        // `report` appends "failed" to this
        report(
          `keep ${unwritten.length} message(s) typed while ${threadId} was unreadable`,
          null
        );
        return;
      }
      // A newer copy of a stored item is owed as much as a new one: an
      // overtaken `repointThread` hands over a reply that streamed on, or an
      // approval answered, under an id the thread already has
      if (holdsNewer(unwritten, stored)) {
        await PgChatStorage.write(threadId, mergeThreads(stored, unwritten));
      }
    });
  }

  /**
   * Merge the server's copy of the open thread into what is rendered.
   *
   * Instead of re-reading the thread from storage, which `loadThread(id,
   * true)` does and which is wrong for a thread that is already open: it
   * denies the card the user has not answered, drops the status to idle in
   * the middle of a turn, and replaces memory with a copy on disk that can lag
   * it -- the store's writes are queued, and a pull's storage write was not
   * on that queue, so a message sent during the request could vanish.
   *
   * Here the merge is newest-wins by version with ties to this tab, like the
   * pull's. Status and pending approvals are left exactly as they are, and an
   * item this tab holds keeps its object, so a reply still streaming into it
   * carries on. The result persists through `_emit`, on the same chain as
   * every other write, which is what makes memory the source of truth.
   *
   * Capped like storage: the server keeps every message, and without the cap
   * a long thread rendered all of them under a notice saying the earlier ones
   * are not on this device, and replayed them all to the provider. The cap
   * never trims below what is already in memory, so a session that has grown
   * past it keeps showing what it showed.
   *
   * Waits for the thread's read when one is still out, for the same reason
   * as `loadThread`: merged into the empty list standing in for it, the read
   * landing afterwards would duplicate every item.
   *
   * @param threadId the thread the server's copy belongs to
   * @param fromServer the server's items for it
   * @returns whether that thread was open, so the copy is now in memory
   */
  static async foldIn(threadId: string, fromServer: readonly ChatItem[]) {
    await PgAssistant._settled(threadId);
    if (PgAssistant._threadId !== threadId) return false;

    const items = PgAssistant._items;
    const merged = capThread(
      threadId,
      mergeThreads(fromServer, items),
      Math.max(MAX_MESSAGES_PER_THREAD, items.length)
    );
    // Every ordinary reopen lands here with nothing new, and a write per
    // reopen is a write for nothing
    const unchanged =
      merged.length === items.length &&
      merged.every((item, i) => item === items[i]);
    if (unchanged) return true;

    PgAssistant._items = merged;
    PgAssistant._emit();
    return true;
  }

  /**
   * @param cb runs whenever anything changes. Deliberately not called on
   * subscribe: consumers read the getters directly while rendering, and firing
   * synchronously here caused React state updates during mount/unmount.
   * @returns a disposable to clear the event
   */
  static onDidChange(cb: () => void): Disposable {
    PgAssistant._listeners.add(cb);
    return { dispose: () => PgAssistant._listeners.delete(cb) };
  }

  private static _items: ChatItem[] = [];
  private static _status: AssistantStatus = "idle";
  private static _connection: Connection | null = null;
  private static _pickingBackend = false;
  private static _enabledSkillIds: readonly string[] = DEFAULT_SKILL_IDS;
  private static _gatewayServers: readonly McpServerEntry[] = [];
  // Copied, so editing a server in the UI never mutates the registry default
  private static _localServers: readonly McpServerEntry[] =
    LOCAL_MCP_SERVERS.map((server) => ({ ...server }));
  private static _mcpTools: Readonly<Record<string, readonly McpTool[]>> = {};
  /**
   * The turn in flight, if `beginTurn` registered one. `cut` once its thread
   * has closed, until the turn ends.
   */
  private static _turn: {
    controller: AbortController;
    cut: boolean;
    /** Reports a cut turn that has not ended in `CUT_TURN_OVERDUE_MS` */
    overdue?: ReturnType<typeof setTimeout>;
  } | null = null;
  private static _conversation = 0;
  private static readonly _pending = new Map<
    string,
    (allowed: boolean) => void
  >();
  private static readonly _listeners = new Set<() => void>();
  private static readonly _promptListeners = new Set<
    (request: PromptRequest) => void
  >();
  /** The subset of `_promptListeners` that can actually run a prompt */
  private static readonly _promptSenders = new Set<
    (request: PromptRequest) => void
  >();
  // Set by `requestPrompt` when `useTurn` is not around to receive it live;
  // claimed and cleared by the next `onDidRequestPrompt` subscriber.
  private static _pendingPrompt: PromptRequest | null = null;

  private static _threadId: string | null = null;
  /**
   * Whether the open thread may be written: not while its read is out, nor
   * after that read failed, since in both cases `_items` is not the thread
   */
  private static _writes: ThreadWrites = "open";
  /** Bumped by every load and close, so a read can tell it was overtaken */
  private static _loadSeq = 0;
  private static _lastWrite: Promise<void> = Promise.resolve();
  /** Each thread's latest step on the write queue, while it is out */
  private static readonly _threadWrites = new Map<string, Promise<void>>();
  /** The thread read `loadThread` or `repointThread` has out, if any */
  private static _loading: {
    threadId: string;
    done: Promise<unknown>;
  } | null = null;

  /**
   * Resolves once every pending write has landed.
   *
   * Persistence is deliberately fire-and-forget -- no mutator can usefully
   * wait on a disk write -- so this is how a caller that *does* care (a test,
   * or sync before sign-out) finds out.
   */
  static whenPersisted() {
    return PgAssistant._lastWrite;
  }

  /**
   * Mirror the open thread to storage.
   *
   * Fired and not awaited: every mutator calls `_emit` synchronously and none
   * can usefully wait on a disk write. Failures are swallowed inside
   * `PgChatStorage` — a lost write must not take the panel down.
   */
  private static _persist() {
    if (!PgAssistant._threadId) return;
    // The open thread is still being read, or could not be: either way what
    // is in memory is not the stored thread, and writing it back would
    // replace that thread, or a file that may still be recoverable by hand
    if (PgAssistant._writes !== "open") return;

    PgAssistant._queueWrite(PgAssistant._threadId, [...PgAssistant._items]);
  }

  /**
   * Chained rather than fired independently, so writes cannot land out of
   * order -- two quick messages must not race into the second overwriting
   * the first with a shorter list
   */
  private static _queueWrite(threadId: string, items: readonly ChatItem[]) {
    PgAssistant._enqueue(threadId, () => PgChatStorage.write(threadId, items));
  }

  /**
   * Put a step for `threadId` on the write queue, and remember it as that
   * thread's latest until it settles, for `_afterThreadWrites`
   */
  private static _enqueue(threadId: string, step: () => Promise<void>) {
    const done = PgAssistant._afterWrites().then(step);
    PgAssistant._lastWrite = done;
    PgAssistant._threadWrites.set(threadId, done);
    // Both ways rather than `finally`, whose own promise would reject
    // unhandled with `done`; a failure is `_settle`'s to report
    const forget = () => {
      if (PgAssistant._threadWrites.get(threadId) === done) {
        PgAssistant._threadWrites.delete(threadId);
      }
    };
    void done.then(forget, forget);
  }

  /** Once `threadId`'s queued writes have settled; at once if it has none */
  private static async _afterThreadWrites(threadId: string) {
    const pending = PgAssistant._threadWrites.get(threadId);
    if (pending) await PgAssistant._settle(pending);
  }

  /** Once every write queued so far has settled, however it went */
  private static _afterWrites() {
    return PgAssistant._settle(PgAssistant._lastWrite);
  }

  private static _settle(write: Promise<void>) {
    return write.catch((e) => {
      // Nothing on the queue rejects today: `PgChatStorage` catches and
      // reports its own failures. If something ever did, it is reported here
      // and the queue goes on, since one failed write must not stop the rest
      report("chat write queue", e);
    });
  }

  /** Notify and write back. Every mutator goes through here. */
  private static _emit() {
    PgAssistant._persist();
    PgAssistant._emitOnly();
  }

  /** Notify without writing back — for changes that came *from* storage */
  private static _emitOnly() {
    for (const cb of PgAssistant._listeners) cb();
  }
}

// A handle on the panel's state for the browser console, and for the e2e tests
// that cover thread persistence -- sending a message for real would need a
// configured backend and a live model call, which is not what those assert.
//
// Development only: `craco build` sets NODE_ENV to production, so this is
// dropped from the shipped bundle rather than merely unused in it.
if (process.env.NODE_ENV !== "production") {
  (window as unknown as { __pgAssistant?: typeof PgAssistant }).__pgAssistant =
    PgAssistant;
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;
  describe("views/sidebar/assistant/store", () => {
    let MIN_REDACTED_KEY_LENGTH: typeof import("@/shared/lib/ai").MIN_REDACTED_KEY_LENGTH;
    let REDACTED_KEY: typeof import("@/shared/lib/ai").REDACTED_KEY;
    let isDefaultBackendRemembered: typeof import("./model/remembered-backend").isDefaultBackendRemembered;
    let rememberedConnection: typeof import("./model/remembered-backend").rememberedConnection;
    let truncationNoticeId: typeof import("../../../features/persistence/model/chat-storage").truncationNoticeId;
    let PgFs: typeof import("@/utils/explorer/fs").PgFs;
    let storedValues: typeof import("../../../test-utils/stored-values").storedValues;
    beforeAll(async () => {
      ({ MIN_REDACTED_KEY_LENGTH, REDACTED_KEY } = await import(
        "@/shared/lib/ai"
      ));
      ({ isDefaultBackendRemembered, rememberedConnection } = await import(
        "./model/remembered-backend"
      ));
      ({ truncationNoticeId } = await import(
        "../../../features/persistence/model/chat-storage"
      ));
      // Through `@/` on purpose: this dynamic import fails if vitest stops resolving `@/` through tsconfig `paths`
      ({ PgFs } = await import("@/utils/explorer/fs"));
      ({ storedValues } = await import("../../../test-utils/stored-values"));
    });

    /** Storage writes are fired and forgotten; this waits for them to land */
    const settled = () => PgAssistant.whenPersisted();

    /** The texts of a stored thread, in order */
    const storedTexts = (items: readonly ChatItem[] | null) =>
      (items ?? []).map((i) => (i as { text?: string }).text);

    /** The id of the approval card added most recently */
    const latestCard = () =>
      PgAssistant.items.filter((i) => i.kind === "approval").slice(-1)[0].id;

    const at = "2026-01-01T00:00:00.000Z";

    const user = (text: string): ChatItem => ({
      kind: "user",
      id: "u",
      createdAt: at,
      text,
    });
    const assistant = (text: string): ChatItem => ({
      kind: "assistant",
      id: "a",
      createdAt: at,
      text,
    });
    const approval: ChatItem = {
      kind: "approval",
      id: "p",
      createdAt: at,
      request: { type: "patch", path: "src/lib.rs", before: "a", after: "b" },
      status: "allowed",
    };

    describe("turnProducedApproval", () => {
      it("is false for a turn that only replied", () => {
        expect(turnProducedApproval([user("hi"), assistant("hello")])).toBe(
          false
        );
      });

      it("is true when this turn wrote a patch before replying", () => {
        expect(
          turnProducedApproval([
            user("write it"),
            approval,
            assistant("I added the hello instruction."),
          ])
        ).toBe(true);
      });

      it("does not look past the start of the current turn", () => {
        expect(
          turnProducedApproval([
            user("write it"),
            approval,
            assistant("done"),
            user("what does it do?"),
            assistant("it logs a message"),
          ])
        ).toBe(false);
      });

      it("is false for an empty conversation", () => {
        expect(turnProducedApproval([])).toBe(false);
      });
    });

    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    describe("PgAssistant item identity", () => {
      beforeEach(() => PgAssistant.clear());

      it("gives every item a uuid, not a session counter", () => {
        PgAssistant.addUserMessage("hi");

        expect(PgAssistant.items[0].id).toMatch(UUID_RE);
      });

      it("stamps every item with a creation time", () => {
        PgAssistant.addUserMessage("hi");

        expect(Number.isNaN(Date.parse(PgAssistant.items[0].createdAt))).toBe(
          false
        );
      });

      it("does not reuse ids across a clear, unlike the old counter", () => {
        PgAssistant.addUserMessage("first");
        const first = PgAssistant.items[0].id;

        PgAssistant.clear();
        PgAssistant.addUserMessage("second");

        expect(PgAssistant.items[0].id).not.toBe(first);
      });

      it("gives items made in one millisecond increasing times", () => {
        // A tie in `createdAt` is ordered by id, which is random, so a merge put
        // a message and the reply started in the same millisecond either way
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
          PgAssistant.addUserMessage("asked");
          PgAssistant.startAssistantMessage();

          const [asked, reply] = PgAssistant.items;
          expect(Date.parse(reply.createdAt)).toBeGreaterThan(
            Date.parse(asked.createdAt)
          );
        } finally {
          vi.useRealTimers();
        }
      });

      it("stamps every kind of item, not just user messages", () => {
        PgAssistant.addUserMessage("hi");
        PgAssistant.startAssistantMessage();
        PgAssistant.addToolCall("read src/lib.rs");
        PgAssistant.addNotice("stopped");
        PgAssistant.addError("boom");

        expect(PgAssistant.items).toHaveLength(5);
        for (const item of PgAssistant.items) {
          expect(item.id).toMatch(UUID_RE);
          expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
        }
      });

      it("keeps ids unique across many items", () => {
        for (let i = 0; i < 50; i++) PgAssistant.addUserMessage(`m${i}`);

        const ids = new Set(PgAssistant.items.map((i) => i.id));
        expect(ids.size).toBe(50);
      });
    });

    /**
     * Items change after they are created -- a reply streams in, an approval is
     * answered -- and the server keeps whichever copy of an id is newer. So every
     * change to an existing item has to say when it happened.
     */
    describe("PgAssistant item versions", () => {
      beforeEach(() => PgAssistant.clear());

      /** An item's version: when it last changed, or when it was made */
      const versionOf = (item: ChatItem) =>
        Date.parse(item.updatedAt ?? item.createdAt);

      const find = (id: string) => PgAssistant.items.find((i) => i.id === id)!;

      it("leaves a new item unstamped, so its version is its creation", () => {
        PgAssistant.addUserMessage("hi");
        const id = PgAssistant.startAssistantMessage();

        expect(PgAssistant.items[0].updatedAt).toBeUndefined();
        expect(find(id).updatedAt).toBeUndefined();
      });

      it("stamps a reply each time text streams into it", () => {
        const id = PgAssistant.startAssistantMessage();
        const created = versionOf(find(id));

        PgAssistant.appendToAssistantMessage(id, "Hel");
        const first = versionOf(find(id));
        PgAssistant.appendToAssistantMessage(id, "lo");
        const second = versionOf(find(id));

        expect(first).toBeGreaterThan(created);
        // Strictly, even when two deltas land in the same millisecond: a tie
        // would let the server keep the shorter copy
        expect(second).toBeGreaterThan(first);
      });

      it("stamps an approval when the user answers it", () => {
        void PgAssistant.requestApproval({
          type: "command",
          name: "build",
          effect: "builds",
        });
        const id = latestCard();
        const created = versionOf(find(id));

        PgAssistant.resolveApproval(id, true);

        expect(versionOf(find(id))).toBeGreaterThan(created);
      });

      it("stamps an approval when its outcome is recorded", () => {
        void PgAssistant.requestApproval({
          type: "command",
          name: "build",
          effect: "builds",
        });
        const id = latestCard();
        PgAssistant.resolveApproval(id, true);
        const answered = versionOf(find(id));

        PgAssistant.setApprovalOutcome(id, "built");

        expect(versionOf(find(id))).toBeGreaterThan(answered);
      });

      it("stamps an approval denied because the turn was stopped", () => {
        void PgAssistant.requestApproval({
          type: "command",
          name: "deploy",
          effect: "deploys",
        });
        const id = latestCard();
        const created = versionOf(find(id));

        PgAssistant.cancelPending();

        expect(versionOf(find(id))).toBeGreaterThan(created);
      });

      it("writes the stamp to storage with the item", async () => {
        PgAssistant.closeThread();
        (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
        await PgAssistant.loadThread("versions");
        const id = PgAssistant.startAssistantMessage();
        PgAssistant.appendToAssistantMessage(id, "done");
        await settled();

        const [stored] = (await PgChatStorage.read("versions"))!;
        expect(stored.updatedAt).toEqual(expect.any(String));
        expect(stored.updatedAt).toBe(find(id).updatedAt);
        PgAssistant.closeThread();
      });
    });

    /**
     * The server's copy of the open thread, merged into memory rather than
     * reloaded from storage -- a reload denies pending approvals, resets the
     * status, and replaces memory with a copy on disk that can lag it.
     */
    describe("PgAssistant.foldIn", () => {
      const files = () =>
        (PgFs as unknown as { __files: Map<string, string> }).__files;

      beforeEach(async () => {
        files().clear();
        PgAssistant.closeThread();
        PgAssistant.clear();
        await PgAssistant.loadThread("fold");
      });

      afterEach(() => PgAssistant.closeThread());

      const reply = (text: string, updatedAt?: string): ChatItem => ({
        kind: "assistant",
        id: "66666666-6666-4666-8666-666666666666",
        createdAt: at,
        text,
        ...(updatedAt ? { updatedAt } : {}),
      });

      const texts = () =>
        PgAssistant.items.map((i) => ("text" in i ? i.text : i.kind));

      it("adds the server's items and keeps the ones only this tab has", async () => {
        PgAssistant.addUserMessage("local only");

        await PgAssistant.foldIn("fold", [reply("from the server")]);

        expect(texts()).toEqual(["from the server", "local only"]);
        await settled();
        expect(await PgChatStorage.read("fold")).toHaveLength(2);
      });

      it("takes the server's copy of an item when it is newer", async () => {
        await PgAssistant.foldIn("fold", [
          reply("Do", "2026-01-01T00:00:01.000Z"),
        ]);

        await PgAssistant.foldIn("fold", [
          reply("Done.", "2026-01-01T00:00:05.000Z"),
        ]);

        expect(texts()).toEqual(["Done."]);
      });

      it("keeps this tab's copy when it is newer, or on a tie", async () => {
        await PgAssistant.foldIn("fold", [
          reply("Done.", "2026-01-01T00:00:05.000Z"),
        ]);

        await PgAssistant.foldIn("fold", [
          reply("Do", "2026-01-01T00:00:01.000Z"),
        ]);
        await PgAssistant.foldIn("fold", [
          reply("other", "2026-01-01T00:00:05.000Z"),
        ]);

        expect(texts()).toEqual(["Done."]);
      });

      it("leaves a running turn running, and its approval waiting", async () => {
        PgAssistant.setStatus("running");
        const id = PgAssistant.startAssistantMessage();
        const approval = PgAssistant.requestApproval({
          type: "command",
          name: "build",
          effect: "builds",
        });
        const card = latestCard();

        // The server's copy of the card reads as unanswered: the codec stores a
        // pending one that way. Same version, so this tab's copy stands.
        const asked = PgAssistant.items.find((i) => i.id === card)!;
        await PgAssistant.foldIn("fold", [
          {
            kind: "approval",
            id: asked.id,
            createdAt: asked.createdAt,
            request: { type: "command", name: "build", effect: "builds" },
            status: "unanswered",
          },
        ]);

        expect(PgAssistant.status).toBe("awaiting");
        expect(PgAssistant.items.find((i) => i.id === card)).toMatchObject({
          status: "pending",
        });

        // The reply still streams into the item the turn is holding
        PgAssistant.appendToAssistantMessage(id, "Hi");
        expect(texts()).toContain("Hi");

        PgAssistant.resolveApproval(card, true);
        await expect(approval).resolves.toEqual({ id: card, allowed: true });
      });

      it("writes nothing when the server had nothing new", async () => {
        PgAssistant.addUserMessage("hi");
        await settled();
        const write = vi.spyOn(PgChatStorage, "write");

        await PgAssistant.foldIn("fold", [...PgAssistant.items]);
        await settled();

        expect(write).not.toHaveBeenCalled();
        write.mockRestore();
      });

      it("does nothing for a thread that is not open", async () => {
        expect(await PgAssistant.foldIn("other", [reply("elsewhere")])).toBe(
          false
        );

        expect(PgAssistant.items).toHaveLength(0);
      });

      it("waits for the thread's read, so the stored items are not added twice", async () => {
        // A fold into the empty list standing in for the thread, followed by the
        // read landing, appended the stored thread to the server's copy as though
        // every item had arrived mid-read
        const stored = reply("stored");
        await PgChatStorage.write("racy", [stored]);
        PgAssistant.closeThread();

        const loading = PgAssistant.loadThread("racy");
        const folded = PgAssistant.foldIn("racy", [stored]);
        await Promise.all([loading, folded]);

        expect(texts()).toEqual(["stored"]);
      });

      describe("on a thread longer than this device keeps", () => {
        /** `n` server messages, oldest first, a second apart */
        const history = (n: number) =>
          Array.from(
            { length: n },
            (_, i): ChatItem => ({
              kind: "user",
              id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
              text: `m${i}`,
            })
          );

        it("keeps only the newest, as storage would", async () => {
          // The server keeps every message; memory held all of them under a
          // notice saying the earlier ones were not on this device
          await PgAssistant.foldIn(
            "fold",
            history(MAX_MESSAGES_PER_THREAD + 50)
          );

          expect(PgAssistant.items).toHaveLength(MAX_MESSAGES_PER_THREAD);
          expect(PgAssistant.items[0].id).toBe(truncationNoticeId("fold"));
          expect(texts()).toContain(`m${MAX_MESSAGES_PER_THREAD + 49}`);
        });

        it("writes nothing when folding the same history again", async () => {
          const server = history(MAX_MESSAGES_PER_THREAD + 50);
          await PgAssistant.foldIn("fold", server);
          await settled();
          const write = vi.spyOn(PgChatStorage, "write");

          await PgAssistant.foldIn("fold", server);

          expect(write).not.toHaveBeenCalled();
          write.mockRestore();
        });

        it("never trims what a long session already shows", async () => {
          const server = history(MAX_MESSAGES_PER_THREAD);
          await PgAssistant.foldIn("fold", server);
          for (let i = 0; i < 20; i++) PgAssistant.addUserMessage(`new ${i}`);
          const shown = PgAssistant.items.map((i) => i.id).sort();

          await PgAssistant.foldIn("fold", server);

          expect(PgAssistant.items.map((i) => i.id).sort()).toEqual(shown);
        });
      });
    });

    describe("PgAssistant reply provenance", () => {
      beforeEach(() => {
        localStorage.clear();
        PgAssistant.disconnect();
        PgAssistant.clear();
      });

      it("records the backend that wrote a reply", () => {
        PgAssistant.connect({
          id: "openai",
          apiKey: "sk-test",
          endpoint: { baseUrl: "https://api.openai.com/v1", model: "gpt-5.1" },
        });

        PgAssistant.startAssistantMessage();

        expect(PgAssistant.items[0]).toMatchObject({
          origin: {
            provider: "openai",
            model: "gpt-5.1",
            baseUrl: "https://api.openai.com/v1",
          },
        });
      });

      it("never records the key", () => {
        PgAssistant.connect({ id: "anthropic", apiKey: "sk-ant-secret" });

        PgAssistant.startAssistantMessage();

        expect(JSON.stringify(PgAssistant.items)).not.toContain(
          "sk-ant-secret"
        );
      });

      it("records nothing when nothing is connected", () => {
        PgAssistant.startAssistantMessage();

        expect(PgAssistant.items[0]).not.toHaveProperty("origin");
      });

      it("follows the user switching backends mid-thread", () => {
        PgAssistant.connect({ id: "default", apiKey: "" });
        PgAssistant.startAssistantMessage();

        PgAssistant.connect({
          id: "gemini",
          apiKey: "k",
          endpoint: { baseUrl: "https://g", model: "gemini-3.6-flash" },
        });
        PgAssistant.startAssistantMessage();

        // Switching backends clears the conversation, so the second reply stands
        // alone -- but it stands alone carrying the backend that produced it
        expect(PgAssistant.items[0]).toMatchObject({
          origin: { provider: "gemini", model: "gemini-3.6-flash" },
        });
      });
    });

    describe("PgAssistant backend memory", () => {
      beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        PgAssistant.disconnect();
      });

      it("remembers the default backend, so the next load reconnects itself", () => {
        PgAssistant.connect({ id: "default", apiKey: "" });
        expect(isDefaultBackendRemembered()).toBe(true);
      });

      it("does not remember a key-based backend as the default", () => {
        PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
        expect(isDefaultBackendRemembered()).toBe(false);
      });

      it("forgets the default once the user switches away from it", () => {
        PgAssistant.connect({ id: "default", apiKey: "" });
        PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });
        expect(isDefaultBackendRemembered()).toBe(false);
      });

      it("forgets the default when the user disconnects", () => {
        PgAssistant.connect({ id: "default", apiKey: "" });
        PgAssistant.disconnect();
        expect(isDefaultBackendRemembered()).toBe(false);
      });
    });

    describe("PgAssistant when the session changes", () => {
      const signedIn = (name: string | null) =>
        PgSession.refreshWith({ id: "u1", name, image: null, login: null });

      const signedOutAndDisconnected = () => {
        PgAssistant.disconnect();
        localStorage.clear();
        sessionStorage.clear();
        PgSession.reset();
      };

      beforeEach(signedOutAndDisconnected);
      afterEach(signedOutAndDisconnected);

      it("needs sign-in for the default backend once the session ends", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "default", apiKey: "" });
        expect(PgAssistant.needsSignIn).toBe(false);

        await PgSession.refreshWith(null);

        expect(PgAssistant.needsSignIn).toBe(true);
        // Nothing opens on its own: the next send asks (`useTurn`)
        expect(PgAssistant.isPickingBackend).toBe(false);
      });

      it("never needs sign-in for a key-based backend", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "openai", apiKey: "sk-test" });

        await PgSession.refreshWith(null);

        expect(PgAssistant.needsSignIn).toBe(false);
        // Signing out leaves the backend and its key where they were
        expect(PgAssistant.connection).toMatchObject({
          id: "openai",
          apiKey: "sk-test",
        });
      });

      it("closes Connect a model even while the default backend has no session", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "default", apiKey: "" });
        await PgSession.refreshWith(null);
        PgAssistant.pickBackend();

        PgAssistant.keepBackend();

        // The dialog's cleanup ends the mark this way, and `openConnectDialog`
        // opens nothing while it is set
        expect(PgAssistant.isPickingBackend).toBe(false);
      });
    });

    describe("PgAssistant threads", () => {
      beforeEach(() => {
        // Straight at the mock's store: `PgChatStorage.clear()` swallows its own
        // failures, so a clear that silently did nothing would look identical
        (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
        // `clear` keeps the open thread on purpose, so close it explicitly or a
        // previous test's thread keeps receiving writes
        PgAssistant.closeThread();
        // And `closeThread` leaves items alone when no thread is open, so that a
        // message typed before one resolves is adopted rather than dropped --
        // which means a previous case's orphan would follow us in here
        PgAssistant.clear();
      });

      it("writes the open thread through to storage on every change", async () => {
        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("hi");
        await settled();

        expect(await PgChatStorage.read("t1")).toHaveLength(1);
      });

      it("does not write back over a thread it could not read", async () => {
        // The panel renders an unreadable thread as empty, because there is
        // nothing else it can show -- but persisting that empty list would
        // replace a file that may still be recoverable by hand with nothing.
        const files = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
        const corrupt = "{ not json";
        files.set("/.config/chats/t1.json", corrupt);

        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("hi");
        await settled();

        expect(files.get("/.config/chats/t1.json")).toBe(corrupt);
      });

      it("says a thread it could not read is not being saved", async () => {
        // Every message after a failed read stays in memory only; without this
        // the panel looked like any other conversation while nothing was kept
        const files = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
        const corrupt = "{ not json";
        files.set("/.config/chats/t1.json", corrupt);

        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("hi");
        await settled();

        expect(PgAssistant.unsaved).toBe(true);
        expect(files.get("/.config/chats/t1.json")).toBe(corrupt);
      });

      it("still says so after the panel resets on a backend switch", async () => {
        const files = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
        files.set("/.config/chats/t1.json", "{ not json");
        await PgAssistant.loadThread("t1");

        // `clear` empties what is rendered; the thread is no more saved than before
        PgAssistant.clear();

        expect(PgAssistant.unsaved).toBe(true);
      });

      it("does not say so while a thread is only being read", async () => {
        const loading = PgAssistant.loadThread("t1");
        expect(PgAssistant.unsaved).toBe(false);
        await loading;
      });

      it("stops saying so once the thread reads cleanly", async () => {
        const files = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
        files.set("/.config/chats/t1.json", "{ not json");
        await PgAssistant.loadThread("t1");

        files.delete("/.config/chats/t1.json");
        await PgAssistant.loadThread("t1", true);

        expect(PgAssistant.unsaved).toBe(false);
      });

      it("writes again once a thread reads cleanly", async () => {
        const files = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
        files.set("/.config/chats/t1.json", "{ not json");
        await PgAssistant.loadThread("t1");

        await PgAssistant.loadThread("t2");
        PgAssistant.addUserMessage("hi");
        await settled();

        expect(await PgChatStorage.read("t2")).toHaveLength(1);
      });

      it("loads a stored thread when switching to it", async () => {
        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("in one");
        await settled();

        await PgAssistant.loadThread("t2");
        expect(PgAssistant.items).toHaveLength(0);

        await PgAssistant.loadThread("t1");
        expect(
          PgAssistant.items.map((i) => (i as { text: string }).text)
        ).toEqual(["in one"]);
      });

      it("keeps threads separate rather than mixing them", async () => {
        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("one");
        await settled();
        await PgAssistant.loadThread("t2");
        PgAssistant.addUserMessage("two");
        await settled();

        expect(await PgChatStorage.read("t1")).toHaveLength(1);
        expect(await PgChatStorage.read("t2")).toHaveLength(1);
      });

      it("does not persist anything when no thread is open", async () => {
        PgAssistant.addUserMessage("orphan");
        await settled();

        expect(await PgChatStorage.threadIds()).toEqual([]);
      });

      it("gives the thread that opens the messages typed before it did", async () => {
        // The panel is mounted before the workspace announces itself, so a
        // message can be sent with nowhere yet to put it. Losing it would be the
        // user watching what they typed disappear.
        PgAssistant.addUserMessage("typed while it was still opening");
        await PgAssistant.loadThread("t1");
        await settled();

        expect(await PgChatStorage.read("t1")).toHaveLength(1);
      });

      it("leaves the previous conversation behind when switching thread", async () => {
        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("in one");
        await settled();

        await PgAssistant.loadThread("t2");
        await settled();

        // Adoption is for messages with no thread, never for another thread's
        expect(PgAssistant.items).toHaveLength(0);
        expect(await PgChatStorage.read("t2")).toHaveLength(0);
      });

      it("does not write over a thread while it is still being read", async () => {
        // A reload restores the thread while the panel's mount effects land:
        // MCP discovery calls `_emit` with nothing in the conversation changed.
        // Landing mid-read, that wrote the empty list standing in for the thread
        // over the stored one, behind a read that still returned it -- so memory
        // held the conversation and storage held `[]` (HOO-2109)
        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "55555555-5555-4555-8555-555555555555",
            createdAt: at,
            text: "remember me",
          },
        ]);

        const loading = PgAssistant.loadThread("t1");
        PgAssistant.keepBackend();
        await loading;
        await settled();

        expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
          "remember me",
        ]);

        // And open to writes again once the read has landed
        PgAssistant.addUserMessage("after");
        await settled();
        expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
          "remember me",
          "after",
        ]);
      });

      // Passes without the HOO-2109 fix too: it guards the adoption that fix
      // relies on, since with writes closed nothing else would write the message
      it("writes a message sent while the thread was being read, after the stored ones", async () => {
        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "66666666-6666-4666-8666-666666666666",
            createdAt: at,
            text: "stored",
          },
        ]);

        const loading = PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("sent mid-read");
        await loading;
        await settled();

        expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
          "stored",
          "sent mid-read",
        ]);
      });

      it("keeps a message sent mid-read when the thread closes before the read lands", async () => {
        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "77777777-7777-4777-8777-777777777777",
            createdAt: at,
            text: "stored",
          },
        ]);

        const loading = PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("sent mid-read");
        // A workspace switch or a sign-out, before the read is back
        PgAssistant.closeThread();
        await loading;
        await settled();

        expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
          "stored",
          "sent mid-read",
        ]);
      });

      it("does not write a message sent mid-read over a thread it could not read", async () => {
        const files = (PgFs as unknown as { __files: Map<string, string> })
          .__files;
        const corrupt = "{ not json";
        files.set("/.config/chats/t1.json", corrupt);

        const loading = PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("sent mid-read");
        await loading;
        await settled();

        expect(files.get("/.config/chats/t1.json")).toBe(corrupt);
        // Still on screen, with the panel saying it is not saved
        expect(storedTexts(PgAssistant.items)).toEqual(["sent mid-read"]);
        expect(PgAssistant.unsaved).toBe(true);
      });

      it("reads a reopened thread after the write that kept its overtaken message", async () => {
        // Overtaken by a switch, A's message is queued behind B's writes. A reopen
        // reading before that write was issued came back without it, and the next
        // write from memory then replaced the file that had it
        await PgChatStorage.write("tA", [
          {
            kind: "user",
            id: "99999999-9999-4999-8999-999999999999",
            createdAt: at,
            text: "stored",
          },
        ]);
        // Each write waits on the gate in place when it is issued, so the queue
        // can be held twice: behind B's write, then behind the kept message
        const gates: Array<() => void> = [];
        let hold: Promise<void> = Promise.resolve();
        const holdWrites = () => {
          hold = new Promise<void>((resolve) => gates.push(resolve));
        };
        const releaseAll = () => gates.forEach((resolve) => resolve());
        const realWrite = PgChatStorage.write.bind(PgChatStorage);
        const write = vi
          .spyOn(PgChatStorage, "write")
          .mockImplementation(async (threadId, items) => {
            await hold;
            return realWrite(threadId, items);
          });

        try {
          await PgAssistant.loadThread("tB");
          holdWrites();
          PgAssistant.addUserMessage("in B");

          // A's read is overtaken by going back to B, so its message is queued
          const first = PgAssistant.loadThread("tA");
          PgAssistant.addUserMessage("sent mid-read");
          const backToB = PgAssistant.loadThread("tB", true);
          // B's write must have taken the first gate before the second goes up
          await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
          const releaseB = gates[0];
          holdWrites();
          releaseB();
          await Promise.all([first, backToB]);

          // Reopened while that write is still held
          const reopened = PgAssistant.loadThread("tA");
          releaseAll();
          await reopened;
          PgAssistant.addUserMessage("later");
          await settled();
        } finally {
          releaseAll();
          write.mockRestore();
        }

        expect(storedTexts(await PgChatStorage.read("tA"))).toEqual([
          "stored",
          "sent mid-read",
          "later",
        ]);
      });

      it("opens a thread while another thread's write is still out", async () => {
        // Only this thread's own writes are waited for: a write of another thread
        // that never settles used to hold every later load at "reading"
        await PgChatStorage.write("tA", [
          {
            kind: "user",
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            createdAt: at,
            text: "stored",
          },
        ]);
        let release = () => {};
        const hold = new Promise<void>((resolve) => (release = resolve));
        const realWrite = PgChatStorage.write.bind(PgChatStorage);
        const write = vi
          .spyOn(PgChatStorage, "write")
          .mockImplementation(async (threadId, items) => {
            await hold;
            return realWrite(threadId, items);
          });

        try {
          await PgAssistant.loadThread("tB");
          PgAssistant.addUserMessage("in B");
          await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));

          void PgAssistant.loadThread("tA");
          await vi.waitFor(() =>
            expect(storedTexts(PgAssistant.items)).toEqual(["stored"])
          );
        } finally {
          release();
          write.mockRestore();
        }
      });

      it("keeps what was typed mid-read across a backend switch", async () => {
        // `clear` on a backend switch replaced the stand-in list, so messages
        // typed after it were on no list an overtaken read could keep
        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            createdAt: at,
            text: "stored",
          },
        ]);

        const loading = PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("before the switch");
        PgAssistant.clear();
        PgAssistant.addUserMessage("after the switch");
        PgAssistant.closeThread();
        await loading;
        await settled();

        expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
          "stored",
          "before the switch",
          "after the switch",
        ]);
      });

      it("puts messages kept from an overtaken read in the order they were typed", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          await PgChatStorage.write("t1", [
            {
              kind: "user",
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              createdAt: at,
              text: "stored",
            },
          ]);

          vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
          const first = PgAssistant.loadThread("t1");
          PgAssistant.addUserMessage("earlier");
          PgAssistant.closeThread();
          const second = PgAssistant.loadThread("t1");
          vi.setSystemTime(new Date("2026-02-01T00:00:01.000Z"));
          PgAssistant.addUserMessage("later");
          await Promise.all([first, second]);
          await settled();

          expect(storedTexts(PgAssistant.items)).toEqual([
            "stored",
            "earlier",
            "later",
          ]);
          expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
            "stored",
            "earlier",
            "later",
          ]);
        } finally {
          vi.useRealTimers();
        }
      });

      it("keeps the messages of two overtaken reads of one thread", async () => {
        // A -> B -> A -> C with a message typed in each read of A: both reads
        // are overtaken, and writing each one's own snapshot let the second
        // replace the first
        await PgChatStorage.write("tA", [
          {
            kind: "user",
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            createdAt: at,
            text: "stored",
          },
        ]);

        const first = PgAssistant.loadThread("tA");
        PgAssistant.addUserMessage("first read");
        const toB = PgAssistant.loadThread("tB");
        const second = PgAssistant.loadThread("tA");
        PgAssistant.addUserMessage("second read");
        const toC = PgAssistant.loadThread("tC");
        await Promise.all([first, toB, second, toC]);
        await settled();

        expect(storedTexts(await PgChatStorage.read("tA"))).toEqual([
          "stored",
          "first read",
          "second read",
        ]);
      });

      it("keeps a message sent mid-read when the same thread is reopened before the read lands", async () => {
        // A -> B -> A faster than a read: the first read used to pass for the
        // current one, since the thread id matched again. The message typed in
        // its gap was dropped by the close, and the second read adopted the
        // first's whole thread as though it had arrived mid-read: every item twice
        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "88888888-8888-4888-8888-888888888888",
            createdAt: at,
            text: "stored",
          },
        ]);

        const first = PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("sent mid-read");
        PgAssistant.closeThread();
        const second = PgAssistant.loadThread("t1");
        await Promise.all([first, second]);
        await settled();

        expect(storedTexts(PgAssistant.items)).toEqual([
          "stored",
          "sent mid-read",
        ]);
        expect(storedTexts(await PgChatStorage.read("t1"))).toEqual([
          "stored",
          "sent mid-read",
        ]);
      });

      it("does not overwrite a thread when the panel resets on backend switch", async () => {
        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("keep me");
        await settled();

        // `clear` is a render reset, not a conversation the user deleted
        PgAssistant.clear();
        await settled();

        expect(await PgChatStorage.read("t1")).toHaveLength(1);
      });

      it("keeps the restored conversation when a backend is connected", async () => {
        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "44444444-4444-4444-8444-444444444444",
            createdAt: at,
            text: "from before the reload",
          },
        ]);

        // A reload starts with no connection in memory, so the first thing the
        // user does is connect, and that must not be mistaken for switching away
        // from a backend they were already talking to
        PgAssistant.disconnect();
        await PgAssistant.loadThread("t1");
        expect(PgAssistant.items).toHaveLength(1);

        PgAssistant.connect({ id: "anthropic", apiKey: "k" });
        await settled();

        expect(PgAssistant.items).toHaveLength(1);
      });

      it("does not overwrite the stored thread when a backend is connected", async () => {
        await PgAssistant.loadThread("t1");
        PgAssistant.addUserMessage("keep me");
        await settled();

        // `clear` leaves storage alone, but whatever follows it must too
        PgAssistant.disconnect();
        PgAssistant.connect({ id: "anthropic", apiKey: "k" });
        await settled();

        expect(await PgChatStorage.read("t1")).toHaveLength(1);
      });

      it("reloads the same thread when forced, after a pull rewrote it", async () => {
        await PgAssistant.loadThread("t1");
        expect(PgAssistant.items).toHaveLength(0);

        await PgChatStorage.write("t1", [
          {
            kind: "user",
            id: "33333333-3333-4333-8333-333333333333",
            createdAt: at,
            text: "from elsewhere",
          },
        ]);

        // Without `force` the unchanged id short-circuits
        await PgAssistant.loadThread("t1");
        expect(PgAssistant.items).toHaveLength(0);

        await PgAssistant.loadThread("t1", true);
        expect(PgAssistant.items).toHaveLength(1);
      });
    });

    /** A turn is cut off when the panel closes its thread, or on `stopTurn` */
    describe("PgAssistant turns", () => {
      let turn: AbortController;
      let logger: typeof import("../../../shared/lib/logger");

      beforeAll(async () => {
        logger = await import("../../../shared/lib/logger");
      });

      beforeEach(async () => {
        (PgFs as unknown as { __files: Map<string, string> }).__files.clear();
        PgAssistant.closeThread();
        PgAssistant.clear();
        await PgAssistant.loadThread("t1");
        turn = new AbortController();
        PgAssistant.beginTurn(turn);
      });

      afterEach(() => {
        PgAssistant.endTurn(turn);
        PgAssistant.closeThread();
        vi.useRealTimers();
        logger.resetLogger();
      });

      it("stops when its thread closes", () => {
        PgAssistant.closeThread();
        PgAssistant.addToolCall("listed the project");

        expect(turn.signal.aborted).toBe(true);
        expect(PgAssistant.items).toEqual([]);
        expect(PgAssistant.endTurn(turn)).toBe(false);
      });

      /**
       * `openThread` adopting the account's thread: the same conversation
       * under another id, with a reply still streaming into it
       */
      describe("when sync repoints the workspace at another thread", () => {
        const onAccount: ChatItem = {
          kind: "user",
          id: "66666666-6666-4666-8666-666666666666",
          createdAt: "2026-01-01T00:00:00.000Z",
          text: "from the account",
        };

        const texts = () =>
          PgAssistant.items.map((i) => ("text" in i ? i.text : i.kind));

        /** Holds the read of `threadId` until the returned gate opens */
        const holdRead = (threadId: string) => {
          let open = () => {};
          const gate = new Promise<void>((resolve) => (open = resolve));
          const realRead = PgChatStorage.read.bind(PgChatStorage);
          const read = vi
            .spyOn(PgChatStorage, "read")
            .mockImplementation(async (id) => {
              if (id === threadId) await gate;
              return realRead(id);
            });
          return { open, read };
        };

        /**
         * What `adoptAccountThread` does before the move: the local thread
         * merged into the account's, and removed
         */
        const adopt = async () => {
          await PgAssistant.whenPersisted();
          const local = (await PgChatStorage.read("t1")) ?? [];
          await PgChatStorage.write("t2", mergeThreads([onAccount], local));
          await PgChatStorage.remove("t1");
        };

        const storedTexts = async (threadId: string) =>
          (await PgChatStorage.read(threadId))?.map((i) =>
            "text" in i ? i.text : i.kind
          );

        it("streams the reply on without losing text mid-move", async () => {
          PgAssistant.addUserMessage("build it");
          const id = PgAssistant.startAssistantMessage();
          PgAssistant.appendToAssistantMessage(id, "Hel");
          await adopt();
          const { open, read } = holdRead("t2");

          try {
            const moving = PgAssistant.repointThread("t1", "t2");
            await vi.waitFor(() => expect(read).toHaveBeenCalledWith("t2"));
            PgAssistant.appendToAssistantMessage(id, "lo, ");
            open();
            await moving;
            PgAssistant.appendToAssistantMessage(id, "world");
          } finally {
            read.mockRestore();
          }

          expect(PgAssistant.threadId).toBe("t2");
          expect(texts()).toEqual([
            "from the account",
            "build it",
            "Hello, world",
          ]);
          await PgAssistant.whenPersisted();
          expect(await storedTexts("t2")).toEqual([
            "from the account",
            "build it",
            "Hello, world",
          ]);
          expect(turn.signal.aborted).toBe(false);
          expect(PgAssistant.endTurn(turn)).toBe(true);
        });

        it("leaves the approval the turn waits on to the user", async () => {
          const approval = PgAssistant.requestApproval({
            type: "command",
            name: "build",
            effect: "builds",
          });

          await PgAssistant.repointThread("t1", "t2");
          const [card] = PgAssistant.items;
          PgAssistant.resolveApproval(card.id, true);

          expect(await approval).toEqual({ id: card.id, allowed: true });
        });

        it("drops the thread it moved from once its writes land", async () => {
          // `adoptAccountThread` has removed it already; a write queued for it
          // before the move would bring it back, pointed at by no workspace
          PgAssistant.addUserMessage("build it");

          await PgAssistant.repointThread("t1", "t2");
          await PgAssistant.whenPersisted();

          expect(await PgChatStorage.threadIds()).toEqual(["t2"]);
        });

        it("keeps the thread it moved from when the move's write fails", async () => {
          // `PgChatStorage.write` reports a failure and returns: removing the
          // source on that would lose what only the source holds
          PgAssistant.addUserMessage("build it");
          await PgAssistant.whenPersisted();
          const realWrite = PgChatStorage.write.bind(PgChatStorage);
          const write = vi
            .spyOn(PgChatStorage, "write")
            .mockImplementation(async (threadId, items) => {
              if (threadId !== "t2") await realWrite(threadId, items);
            });

          try {
            await PgAssistant.repointThread("t1", "t2");
            await PgAssistant.whenPersisted();
          } finally {
            write.mockRestore();
          }

          expect(await storedTexts("t1")).toEqual(["build it"]);
        });

        describe("overtaken by a switch before the read lands", () => {
          it("keeps text streamed into a reply the account already has", async () => {
            // Every id is already stored, so only the newer version says
            // anything is owed
            PgAssistant.addUserMessage("build it");
            const id = PgAssistant.startAssistantMessage();
            PgAssistant.appendToAssistantMessage(id, "Hel");
            await adopt();
            const { open, read } = holdRead("t2");

            try {
              const moving = PgAssistant.repointThread("t1", "t2");
              await vi.waitFor(() => expect(read).toHaveBeenCalledWith("t2"));
              PgAssistant.appendToAssistantMessage(id, "lo");
              PgAssistant.closeThread();
              open();
              expect(await moving).toBe(false);
              await PgAssistant.whenPersisted();
            } finally {
              read.mockRestore();
            }

            expect(await storedTexts("t2")).toEqual([
              "from the account",
              "build it",
              "Hello",
            ]);
          });

          it("keeps the answer to an approval the account already has", async () => {
            void PgAssistant.requestApproval({
              type: "command",
              name: "build",
              effect: "builds",
            });
            await adopt();
            const { open, read } = holdRead("t2");

            try {
              const moving = PgAssistant.repointThread("t1", "t2");
              await vi.waitFor(() => expect(read).toHaveBeenCalledWith("t2"));
              // Denies the card, which nobody is left to answer
              PgAssistant.closeThread();
              open();
              await moving;
              await PgAssistant.whenPersisted();
            } finally {
              read.mockRestore();
            }

            const stored = await PgChatStorage.read("t2");
            const card = stored?.find((i) => i.kind === "approval");
            expect(card).toMatchObject({ status: "denied" });
          });
        });
      });

      it("carries on into the thread that opens when none was", async () => {
        PgAssistant.endTurn(turn);
        PgAssistant.closeThread();
        turn = new AbortController();
        PgAssistant.beginTurn(turn);

        await PgAssistant.loadThread("t2");
        PgAssistant.addToolCall("listed the project");

        expect(turn.signal.aborted).toBe(false);
        expect(PgAssistant.items.map((i) => i.kind)).toEqual(["tool"]);
        expect(PgAssistant.endTurn(turn)).toBe(true);
      });

      it("reports a cut turn that does not end", () => {
        vi.useFakeTimers();
        const logged = logger.memoryProvider();
        logger.initLogger({ providers: [logged] });

        PgAssistant.closeThread();
        vi.advanceTimersByTime(CUT_TURN_OVERDUE_MS);

        expect(logged.entries).toEqual([
          expect.objectContaining({
            ns: "assistant:store",
            level: "error",
            report: true,
          }),
        ]);
      });

      it("reports nothing for a cut turn that ends in time", () => {
        vi.useFakeTimers();
        const logged = logger.memoryProvider();
        logger.initLogger({ providers: [logged] });

        PgAssistant.closeThread();
        PgAssistant.endTurn(turn);
        vi.advanceTimersByTime(CUT_TURN_OVERDUE_MS);

        expect(logged.entries.filter((e) => e.level === "error")).toEqual([]);
      });

      it("carries on when the same thread is re-read after a pull", async () => {
        await PgAssistant.loadThread("t1", true);
        PgAssistant.addToolCall("listed the project");

        expect(turn.signal.aborted).toBe(false);
        expect(PgAssistant.items.map((i) => i.kind)).toEqual(["tool"]);
        expect(PgAssistant.endTurn(turn)).toBe(true);
      });

      it("writes again once the stopped turn has ended", async () => {
        PgAssistant.closeThread();
        PgAssistant.endTurn(turn);
        await PgAssistant.loadThread("t2");

        PgAssistant.addNotice("Stopped.");

        expect(PgAssistant.items.map((i) => i.kind)).toEqual(["notice"]);
      });

      it("counts as running until it ends, even once cut off", () => {
        expect(PgAssistant.turnRunning).toBe(true);
        PgAssistant.closeThread();

        expect(PgAssistant.status).toBe("idle");
        expect(PgAssistant.turnRunning).toBe(true);
        PgAssistant.endTurn(turn);
        expect(PgAssistant.turnRunning).toBe(false);
      });

      it("stops on sign-out with no thread open", async () => {
        PgAssistant.endTurn(turn);
        PgAssistant.closeThread();
        turn = new AbortController();
        PgAssistant.beginTurn(turn);
        const approval = PgAssistant.requestApproval({
          type: "command",
          name: "build",
          effect: "builds",
        });

        PgAssistant.stopTurn();
        PgAssistant.addToolCall("listed the project");

        expect(turn.signal.aborted).toBe(true);
        await expect(approval).resolves.toMatchObject({ allowed: false });
        expect(PgAssistant.items.map((i) => i.kind)).toEqual(["approval"]);
        expect(PgAssistant.endTurn(turn)).toBe(false);
      });
    });

    describe("the user's own key", () => {
      const KEY = "sk-test-store-0123456789";
      const openai = {
        id: "openai" as const,
        apiKey: KEY,
        endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
      };

      beforeEach(async () => {
        PgAssistant.disconnect();
        sessionStorage.clear();
        localStorage.clear();
        await PgAssistant.loadThread("own-key");
      });

      const errorTexts = () =>
        PgAssistant.items.flatMap((item) =>
          item.kind === "error" ? [item.text] : []
        );

      it("is kept for this tab and nowhere durable", async () => {
        PgAssistant.connect(openai);
        PgAssistant.addUserMessage("hello");
        await settled();

        expect(sessionStorage.getItem("assistant.connection")).toContain(KEY);
        expect(JSON.stringify(storedValues(localStorage))).not.toContain(KEY);
        expect(
          JSON.stringify(await PgChatStorage.read("own-key"))
        ).not.toContain(KEY);
      });

      it("is redacted from a provider error before it is stored", async () => {
        PgAssistant.connect(openai);
        PgAssistant.addError(`401: Incorrect API key provided: ${KEY}. Retry.`);
        await settled();

        expect(JSON.stringify(PgAssistant.items)).not.toContain(KEY);
        expect(JSON.stringify(PgAssistant.items)).toContain(REDACTED_KEY);
        expect(
          JSON.stringify(await PgChatStorage.read("own-key"))
        ).not.toContain(KEY);
      });

      it("is redacted from an error at exactly the minimum length", () => {
        const apiKey = "a".repeat(MIN_REDACTED_KEY_LENGTH);
        PgAssistant.connect({
          id: "openai",
          apiKey,
          endpoint: openai.endpoint,
        });
        PgAssistant.addError(`rejected ${apiKey} here`);

        expect(errorTexts()).toEqual([`rejected ${REDACTED_KEY} here`]);
      });

      it("is left alone in an error when it is one short of the minimum", () => {
        const apiKey = "a".repeat(MIN_REDACTED_KEY_LENGTH - 1);
        PgAssistant.connect({
          id: "openai",
          apiKey,
          endpoint: openai.endpoint,
        });
        PgAssistant.addError(`rejected ${apiKey} here`);

        expect(errorTexts()).toEqual([`rejected ${apiKey} here`]);
      });

      it("is forgotten on disconnect", () => {
        PgAssistant.connect(openai);
        PgAssistant.disconnect();
        expect(sessionStorage.getItem("assistant.connection")).toBeNull();
        expect(PgAssistant.items).toEqual([]);
      });

      it("tells the user to close the tab when disconnecting cannot remove it", async () => {
        PgAssistant.connect(openai);
        PgAssistant.addUserMessage("hello");
        await settled();
        // Neither the removal nor its blanking fallback goes through
        for (const method of ["removeItem", "setItem"] as const) {
          const original = Storage.prototype[method] as (
            ...args: string[]
          ) => void;
          vi.spyOn(Storage.prototype, method).mockImplementation(function (
            this: Storage,
            ...args: string[]
          ) {
            if (this === sessionStorage) throw new Error("blocked");
            original.apply(this, args);
          } as never);
        }

        PgAssistant.disconnect();
        await settled();
        vi.restoreAllMocks();

        expect(PgAssistant.items).toEqual([
          expect.objectContaining({ kind: "notice", text: KEY_NOT_FORGOTTEN }),
        ]);
        // Shown in this tab only: the stored thread keeps its conversation
        expect(
          JSON.stringify(await PgChatStorage.read("own-key"))
        ).not.toContain(KEY_NOT_FORGOTTEN);
      });
    });

    describe("PgAssistant.tune", () => {
      beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        PgAssistant.disconnect();
        PgAssistant.clear();
      });

      it("changes model and effort and keeps the thread", () => {
        PgAssistant.connect({
          id: "anthropic",
          apiKey: "sk-test",
          settings: { model: "claude-opus-4-8", effort: "medium" },
        });
        PgAssistant.addUserMessage("hello");

        PgAssistant.tune({
          id: "anthropic",
          apiKey: "sk-test",
          settings: { model: "claude-sonnet-5-5", effort: "high" },
        });

        expect(PgAssistant.items).toHaveLength(1);
        expect(PgAssistant.connection?.settings).toEqual({
          model: "claude-sonnet-5-5",
          effort: "high",
        });
      });

      it("keeps the tuned model and effort for a reload of this tab", () => {
        PgAssistant.connect({
          id: "anthropic",
          apiKey: "sk-test",
          settings: { model: "claude-opus-4-8", effort: "medium" },
        });

        PgAssistant.tune({
          id: "anthropic",
          apiKey: "sk-test",
          settings: { model: "claude-sonnet-5-5", effort: "high" },
        });

        expect(rememberedConnection()).toEqual({
          id: "anthropic",
          apiKey: "sk-test",
          settings: { model: "claude-sonnet-5-5", effort: "high" },
        });
      });

      it("refuses another backend and leaves the connection", () => {
        PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });

        expect(() =>
          PgAssistant.tune({ id: "openai", apiKey: "sk-test" })
        ).toThrow("tune changes model or effort, not the backend");
        expect(PgAssistant.connection?.id).toBe("anthropic");
      });

      it("refuses another key", () => {
        PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });

        expect(() =>
          PgAssistant.tune({ id: "anthropic", apiKey: "sk-other" })
        ).toThrow("tune changes model or effort, not the backend");
        expect(PgAssistant.connection?.apiKey).toBe("sk-test");
      });

      it("says beforehand which changes it takes", () => {
        expect(
          PgAssistant.canTune({ id: "anthropic", apiKey: "sk-test" })
        ).toBe(false);
        PgAssistant.connect({ id: "anthropic", apiKey: "sk-test" });

        expect(
          PgAssistant.canTune({ id: "anthropic", apiKey: "sk-test" })
        ).toBe(true);
        expect(
          PgAssistant.canTune({ id: "anthropic", apiKey: "sk-other" })
        ).toBe(false);
        expect(PgAssistant.canTune({ id: "openai", apiKey: "sk-test" })).toBe(
          false
        );
      });

      it("refuses when nothing is connected", () => {
        expect(() =>
          PgAssistant.tune({ id: "anthropic", apiKey: "sk-test" })
        ).toThrow("tune changes model or effort, not the backend");
        expect(PgAssistant.isConnected).toBe(false);
      });
    });
  });
}
