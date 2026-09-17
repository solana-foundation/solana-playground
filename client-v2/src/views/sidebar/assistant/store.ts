import {
  DEFAULT_SKILL_IDS,
  listGatewayServers,
  listTools,
  LOCAL_MCP_SERVERS,
} from "./grounding";
import { forgetBackend, rememberBackend } from "./model/remembered-backend";
import { PgChatStorage } from "../../../features/persistence/model/chat-storage";
import { uuid } from "../../../features/persistence/model/ids";
import type { Disposable } from "../../../utils";
import type { McpServerEntry, McpTool } from "./grounding";
import type { Effort, ProviderId } from "./model/types";

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

export type ApprovalStatus = "pending" | "allowed" | "denied";

/** What every rendered item carries, whatever its kind */
interface ChatItemBase {
  /**
   * Minted on the client, so appending the same item twice -- a re-sync, or a
   * second device -- collapses on the primary key instead of duplicating.
   */
  id: string;
  /** ISO 8601. Orders a restored thread; `id` breaks ties. */
  createdAt: string;
}

export type ChatItem =
  | (ChatItemBase & { kind: "user"; text: string })
  | (ChatItemBase & { kind: "assistant"; text: string })
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
 * The API key is deliberately in memory only — see `docs/decisions.md` -> D3
 * for why it is not in storage. Conversation items are not: the open thread is
 * mirrored to IndexedDB on every change, keyed by workspace, so a reload and a
 * project switch both come back to the right conversation. See
 * `docs/persistent-conversations-spec.md`.
 */
export class PgAssistant {
  static get items(): readonly ChatItem[] {
    return PgAssistant._items;
  }

  static get status() {
    return PgAssistant._status;
  }

  /** Which backend is selected, and its key. Never written anywhere. */
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
   * anything. The connection is in memory only, so it is null after every
   * reload -- and by the time the user picks a backend, `chat-thread` has
   * already restored this workspace's conversation from storage. Treating that
   * as a switch cleared the restored thread on every single reload.
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
    // So the next load can reconnect without asking again. Only the keyless
    // default is actually written down; see `remembered-backend`.
    rememberBackend(next.id);

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

  /** Close the picker without changing anything */
  static keepBackend() {
    PgAssistant._pickingBackend = false;
    PgAssistant._emit();
  }

  /** Drop the backend and the key, and clear the conversation with it */
  static disconnect() {
    PgAssistant._connection = null;
    PgAssistant._pickingBackend = false;
    // Disconnecting is the user saying *not* to reconnect; without this the
    // next load would quietly undo it
    forgetBackend();
    PgAssistant.clear();
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
    } catch {}
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
        } catch {}
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
    PgAssistant._items.push({
      kind: "assistant",
      id,
      createdAt: now(),
      text: "",
    });
    PgAssistant._emit();
    return id;
  }

  static appendToAssistantMessage(id: string, delta: string) {
    const item = PgAssistant._items.find((i) => i.id === id);
    if (item?.kind === "assistant") {
      item.text += delta;
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
      text,
    });
    PgAssistant._emit();
  }

  /**
   * Ask the user to approve something.
   *
   * The promise settles when they click, which is what holds the agent loop
   * open — the tool's `run` does not return until then.
   *
   * @param request what needs approving
   * @returns whether the user allowed it
   */
  static requestApproval(request: ApprovalRequest) {
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

    return new Promise<boolean>((resolve) => {
      PgAssistant._pending.set(id, resolve);
    });
  }

  /** Resolve a pending approval */
  static resolveApproval(id: string, allowed: boolean) {
    const item = PgAssistant._items.find((i) => i.id === id);
    if (item?.kind !== "approval" || item.status !== "pending") return;

    item.status = allowed ? "allowed" : "denied";
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
      PgAssistant._emit();
    }
  }

  /** The id of the approval added most recently, for recording its outcome */
  static get lastApprovalId() {
    for (let i = PgAssistant._items.length - 1; i >= 0; i--) {
      const item = PgAssistant._items[i];
      if (item.kind === "approval") return item.id;
    }
    return null;
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
   * no fixing either — the codec writes a pending approval as denied, because
   * nothing could ever resolve it after a reload.
   */
  private static _denyPending() {
    for (const [id, resolve] of PgAssistant._pending) {
      const item = PgAssistant._items.find((i) => i.id === id);
      if (item?.kind === "approval") item.status = "denied";
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
    PgAssistant._denyPending();
    PgAssistant._threadId = null;
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
   * @param force re-read even if this thread is already open, for when sync
   * has just rewritten it underneath
   */
  static async loadThread(threadId: string, force = false) {
    if (!force && PgAssistant._threadId === threadId) return;

    PgAssistant._denyPending();
    PgAssistant._threadId = threadId;
    PgAssistant._items = [];
    PgAssistant._status = "idle";
    PgAssistant._emitOnly();

    const items = await PgChatStorage.read(threadId);
    if (PgAssistant._threadId !== threadId) return;

    PgAssistant._items = items;
    PgAssistant._emitOnly();
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
  private static _lastWrite: Promise<void> = Promise.resolve();

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
