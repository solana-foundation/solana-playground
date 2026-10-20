import {
  DEFAULT_SKILL_IDS,
  listGatewayServers,
  listTools,
  LOCAL_MCP_SERVERS,
} from "./grounding";
import { redactKey } from "./model/redact-key";
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
import { uuid } from "../../../shared/lib/ids";
import type { Disposable } from "../../../utils";
import type { McpServerEntry, McpTool } from "./grounding";
import { isDefaultBackend, type Effort, type ProviderId } from "./model/types";

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
  provider: ProviderId;
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

/** Which backend the panel is talking to, and what it needs to reach it */
export interface Connection {
  id: ProviderId;
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

const makeId = uuid;
const now = () => new Date().toISOString();

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

  /** Whether the backend picker is open on top of an existing connection */
  static get isPickingBackend() {
    return PgAssistant._pickingBackend;
  }

  /**
   * Choose a backend for this tab.
   *
   * Re-picking the current one is a no-op beyond closing the picker; switching
   * to a different one starts a new conversation, because the history lives
   * inside the provider and the new one cannot see the old transcript.
   *
   * Connecting when nothing is connected is *not* a switch, and must not reset
   * anything. The live connection starts empty after every reload, and by the
   * time one is made -- the user's pick, or `Connect`'s reconnect on load from
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

  /** Whether connecting with these settings would keep the conversation */
  static isCurrent(next: Connection) {
    return isSame(PgAssistant._connection, next);
  }

  /** Reopen the picker, keeping the conversation in case the user comes back */
  static pickBackend() {
    PgAssistant._pickingBackend = true;
    PgAssistant._emit();
  }

  /** Whether the connection is the default backend while nobody is signed in */
  static get needsSignIn() {
    return isDefaultBackend(PgAssistant._connection?.id) && !PgSession.get();
  }

  /**
   * Close the picker without changing anything.
   *
   * Refused while `needsSignIn`: every turn would get the 401 refusal, and a
   * refresh of an already null session fires no change to reopen the picker.
   */
  static keepBackend() {
    if (PgAssistant.needsSignIn) return;
    PgAssistant._pickingBackend = false;
    PgAssistant._emit();
  }

  /**
   * Drop the backend and the key, and clear the conversation with it.
   *
   * What the chat header's Forget key button does. If the key could not be
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
      createdAt: now(),
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
   */
  static get mcpServers(): readonly McpServerEntry[] {
    return [...PgAssistant._gatewayServers, ...PgAssistant._localServers];
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
    PgAssistant._localServers = servers;
    PgAssistant._emit();
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
      PgAssistant._gatewayServers = await listGatewayServers();
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
   * Tools discovered from browser-executed servers, by server id.
   *
   * Cached because discovery is a network round trip and `createTools()` is
   * synchronous — a server missing from here contributes no tools this turn
   * rather than blocking it.
   */
  static get mcpTools(): Readonly<Record<string, readonly McpTool[]>> {
    return PgAssistant._mcpTools;
  }

  static setMcpTools(serverId: string, tools: readonly McpTool[]) {
    PgAssistant._mcpTools = { ...PgAssistant._mcpTools, [serverId]: tools };
    PgAssistant._emit();
  }

  /**
   * Discover tools for every enabled browser-executed server.
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
      (server) =>
        server.executor === "browser" &&
        (force || !PgAssistant._mcpTools[server.id])
    );

    await Promise.all(
      servers.map(async (server) => {
        try {
          PgAssistant.setMcpTools(server.id, await listTools(server));
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

  static addUserMessage(text: string) {
    PgAssistant._items.push({
      kind: "user",
      id: makeId(),
      createdAt: now(),
      text,
    });
    PgAssistant._emit();
  }

  /**
   * Ask the panel to send a prompt on the user's behalf - e.g. "Fix with
   * assistant" on a build error card.
   *
   * The panel itself owns the actual send (its provider lives in a ref
   * inside `Chat`), so this only notifies; it does not append a message
   * itself.
   *
   * Observers subscribe too and never send: `Flow` reopens the panel when it
   * is collapsed, `Assistant` switches to the chat tab. `Chat` is the only
   * subscriber that can act on a request, so with none registered the request
   * is buffered in `_pendingPrompt` until one mounts a moment later and claims
   * it -- which is exactly the collapsed-panel and other-tab cases.
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
    // Stamped here because this is the only moment the panel knows what is
    // answering. A thread records the backend it was created with; a reply
    // records the one that wrote it, and the two differ as soon as the user
    // switches backends. Spread rather than assigned, so a reply written with
    // nothing connected has no `origin` key at all rather than an empty one.
    const origin = paramsOf(PgAssistant._connection);
    PgAssistant._items.push({
      kind: "assistant",
      id,
      createdAt: now(),
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

  /** Drop an assistant message that never received any text */
  static discardIfEmpty(id: string) {
    const index = PgAssistant._items.findIndex((i) => i.id === id);
    const item = PgAssistant._items[index];
    if (item?.kind === "assistant" && !item.text) {
      PgAssistant._items.splice(index, 1);
      PgAssistant._emit();
    }
  }

  static addToolCall(label: string) {
    PgAssistant._items.push({
      kind: "tool",
      id: makeId(),
      createdAt: now(),
      label,
    });
    PgAssistant._emit();
  }

  static addNotice(text: string) {
    PgAssistant._items.push({
      kind: "notice",
      id: makeId(),
      createdAt: now(),
      text,
    });
    PgAssistant._emit();
  }

  static addError(text: string) {
    PgAssistant._items.push({
      kind: "error",
      id: makeId(),
      createdAt: now(),
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
   * @param request what needs approving
   * @returns the card's id, and whether the user allowed it
   */
  static requestApproval(request: ApprovalRequest): Promise<ApprovalAnswer> {
    const id = makeId();
    PgAssistant._items.push({
      kind: "approval",
      id,
      createdAt: now(),
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
   */
  static clear() {
    PgAssistant._denyPending();
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();
  }

  /** Which thread is open, or `null` before one has been chosen */
  static get threadId() {
    return PgAssistant._threadId;
  }

  /**
   * Close the open thread without touching what is stored.
   *
   * For when there is no workspace to key a conversation on -- the panel still
   * renders and still works, it just has nowhere to persist to, so it must not
   * keep writing into whichever thread happened to be open last.
   */
  static closeThread() {
    // Nothing open is nothing to close. Clearing anyway would throw away
    // messages typed before the first thread finished resolving -- the ones
    // `loadThread` is about to adopt -- and the explorer announces a switch
    // late enough for that to be an ordinary sequence, not a rare one.
    if (PgAssistant._threadId === null) return;

    PgAssistant._denyPending();
    PgAssistant._threadId = null;
    PgAssistant._readOnly = false;
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();
  }

  /**
   * Open a thread, replacing whatever is rendered.
   *
   * Called when the workspace changes. Anything still awaiting approval
   * belongs to the thread being left, so it is denied rather than carried
   * across.
   *
   * The id is claimed before the read so a second switch landing mid-read can
   * be detected and its result discarded — otherwise a slow read for project A
   * would repaint the panel after the user has already moved to B.
   *
   * @param threadId the workspace whose conversation to open
   * A call for the thread that is already open does nothing -- but waits for
   * that thread's read when it is still out. Returning at once let a caller
   * act on the empty list standing in for it: `foldIn` merged the server's
   * copy into that list, and the read then landing appended the stored
   * thread to it as though every item had arrived mid-read, so each synced
   * message appeared twice.
   *
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
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();

    const items = await PgChatStorage.read(threadId);
    if (PgAssistant._threadId !== threadId) return;

    // A thread that could not be read renders as empty -- there is nothing
    // else the panel can show -- but it must not be *persisted* as empty. The
    // next `_persist()` would write this back over a file that may still be
    // recoverable, so the thread stays closed to writes until it reads
    // cleanly. `__pgChatStorage.lastFailure` says why. Set before the emit
    // below, which is where `_persist` reads it.
    PgAssistant._readOnly = items === null;

    // Whatever is in `_items` now arrived during the read, for this thread
    const adopted = [...orphans, ...PgAssistant._items];
    PgAssistant._items = [...(items ?? []), ...adopted];
    // `_emit` rather than `_emitOnly` when something was adopted: those
    // messages have never been written down under this thread. On a read-only
    // thread `_persist` declines regardless, so they stay on screen without
    // overwriting a file that may still be recoverable.
    if (adopted.length) PgAssistant._emit();
    else PgAssistant._emitOnly();
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
  // Set by `requestPrompt` when `Chat` is not around to receive it live;
  // claimed and cleared by the next `onDidRequestPrompt` subscriber.
  private static _pendingPrompt: PromptRequest | null = null;

  private static _threadId: string | null = null;
  /** Set when the open thread failed to read, cleared when one reads cleanly */
  private static _readOnly = false;
  private static _lastWrite: Promise<void> = Promise.resolve();
  /** The thread read `loadThread` has out, if any */
  private static _loading: { threadId: string; done: Promise<void> } | null =
    null;

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
    // The open thread could not be read, so what is in memory is not the
    // thread -- it is the empty list the panel fell back to. Writing it back
    // would replace a file that may still be recoverable by hand with
    // nothing, which is the same mistake as reporting it uploaded.
    if (PgAssistant._readOnly) return;

    // Chained rather than fired independently, so writes cannot land out of
    // order -- two quick messages must not race into the second overwriting
    // the first with a shorter list
    const threadId = PgAssistant._threadId;
    const items = [...PgAssistant._items];
    PgAssistant._lastWrite = PgAssistant._lastWrite
      .catch(() => {})
      .then(() => PgChatStorage.write(threadId, items));
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

// The default backend needs a session, and only the picker offers sign-in;
// the connection stays remembered so signing in again reconnects it
PgSession.onDidChange(() => {
  if (PgAssistant.needsSignIn) PgAssistant.pickBackend();
});

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
    let MIN_REDACTED_KEY_LENGTH: typeof import("./model/redact-key").MIN_REDACTED_KEY_LENGTH;
    let REDACTED_KEY: typeof import("./model/redact-key").REDACTED_KEY;
    let isDefaultBackendRemembered: typeof import("./model/remembered-backend").isDefaultBackendRemembered;
    let truncationNoticeId: typeof import("../../../features/persistence/model/chat-storage").truncationNoticeId;
    let PgFs: typeof import("@/utils/explorer/fs").PgFs;
    let storedValues: typeof import("../../../test-utils/stored-values").storedValues;
    beforeAll(async () => {
      ({ MIN_REDACTED_KEY_LENGTH, REDACTED_KEY } = await import(
        "./model/redact-key"
      ));
      ({ isDefaultBackendRemembered } = await import(
        "./model/remembered-backend"
      ));
      ({ truncationNoticeId } = await import(
        "../../../features/persistence/model/chat-storage"
      ));
      // Through `@/` on purpose: the alias is mapped in `tsconfig.json`'s `paths`, in
      // craco's webpack alias and in `vitest.config.ts`'s `resolve.alias`, and this
      // dynamic import is what fails when the vitest mapping drifts from the other two.
      ({ PgFs } = await import("@/utils/explorer/fs"));
      ({ storedValues } = await import("../../../test-utils/stored-values"));
    });

    /** Storage writes are fired and forgotten; this waits for them to land */
    const settled = () => PgAssistant.whenPersisted();

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

      // Not `PgSession.reset()`: it drops every listener, the store's included.
      // Disconnecting first, so ending the session here cannot reach the store.
      const signedOutAndDisconnected = async () => {
        PgAssistant.disconnect();
        localStorage.clear();
        sessionStorage.clear();
        await PgSession.refreshWith(null);
      };

      beforeEach(signedOutAndDisconnected);
      afterEach(signedOutAndDisconnected);

      it("returns a default-backend user to the picker when the session ends", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "default", apiKey: "" });

        await PgSession.refreshWith(null);

        expect(PgAssistant.isPickingBackend).toBe(true);
      });

      it("leaves a key-based backend alone when the session ends", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "openai", apiKey: "sk-test" });

        await PgSession.refreshWith(null);

        expect(PgAssistant.isPickingBackend).toBe(false);
      });

      it("stays in chat when a signed-in user's profile refreshes", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "default", apiKey: "" });

        // A changed field notifies listeners although the user is still signed in
        await signedIn("Ada");

        expect(PgAssistant.isPickingBackend).toBe(false);
      });

      it("keeps the picker open while the default backend has no session", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "default", apiKey: "" });
        await PgSession.refreshWith(null);

        PgAssistant.keepBackend();

        expect(PgAssistant.isPickingBackend).toBe(true);
      });

      it("closes the picker for the default backend once signed in again", async () => {
        await signedIn(null);
        PgAssistant.connect({ id: "default", apiKey: "" });
        await PgSession.refreshWith(null);
        await signedIn(null);

        PgAssistant.keepBackend();

        expect(PgAssistant.isPickingBackend).toBe(false);
      });

      it("closes the picker for a key-based backend with no session", async () => {
        PgAssistant.connect({ id: "openai", apiKey: "sk-test" });
        PgAssistant.pickBackend();

        PgAssistant.keepBackend();

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
  });
}
