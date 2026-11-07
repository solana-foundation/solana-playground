import { createLogger } from "@/shared/lib/logger";
import { timeoutSignal } from "@/shared/lib/timeout-signal";

import type { Disposable } from "../../../utils/types";
import {
  AUTH_CHANNEL_NAME,
  AUTH_COMPLETE_ROUTE,
  AUTH_MESSAGE_TYPE,
  AUTH_NOT_CONFIGURED,
  FLOW_MAX_AGE_SECONDS,
  SIGN_OUT_TIMEOUT_MS,
} from "../config.mjs";
import type { PopupChannel } from "../lib/popup-channel";
import { openPopupChannel } from "../lib/popup-channel";
import type { SignInFailure } from "./telemetry";
import { authTelemetry } from "./telemetry";

/** A sign-in that ended at a known step; any other error counts as `request-failed` */
class SignInFailed extends Error {
  constructor(readonly reason: SignInFailure, message: string) {
    super(message);
  }
}

const signInCancelled = () =>
  new SignInFailed("cancelled", "Sign-in cancelled.");

const reasonOf = (error: unknown): SignInFailure =>
  error instanceof SignInFailed ? error.reason : "request-failed";

/**
 * Spec 02's words for a sign-in the server could not start, and for any
 * failure at no known step (`messageOf`), such as the request never leaving
 */
const UNAVAILABLE =
  "Sign-in isn't available. Your work is saved in this browser.";

/**
 * Spec 02's words for a popup that gave no answer in time or refused, and for
 * a session unreadable after GitHub answered
 */
const DID_NOT_FINISH = "Sign-in did not finish.";

/**
 * What the person reads for a failed sign-in: a known step's own words, and
 * for anything else the unavailable line, never the raw error
 */
const messageOf = (error: unknown) =>
  error instanceof SignInFailed ? error.message : UNAVAILABLE;

/**
 * Whether a rejected `PgSession.signIn` or `signInFor` ended at a known step
 * (cancelled, blocked, refused); anything else is an error the team should hear
 * of
 */
export const isSignInFailure = (error: unknown) =>
  error instanceof SignInFailed;

/** What a sign-in button says when it failed in a way `isSignInFailure` does not know */
export const SIGN_IN_FAILED_UNKNOWN = "Couldn't sign in. Try again.";

const log = createLogger("auth:session");

/** Distinguishes this flow's reply from anything else on the same-origin bus */
const randomNonce = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** Who is signed in, as far as our own backend is concerned */
export interface SessionUser {
  /** Our own row id, and the owner of every synced project and conversation */
  id: string;
  /** GitHub display name. Not the handle -- that is `login`. */
  name: string | undefined;
  /** Avatar URL, or `undefined` for an account without one */
  image: string | undefined;
  /** GitHub @handle, for display and the profile link. Never an identity key. */
  login: string | undefined;
}

/**
 * The task a sign-in is for: a prompt in the assistant panel, the deploy the
 * funding card runs next, or the files the share dialog posts. A sign-in that
 * carries one keeps the open project; a task can claim one it did not start
 * (`PgSession.claimPendingSignIn`).
 */
export type SignInOrigin = "assistant" | "deploy" | "share";

/** Local cleanup that runs only after the server has ended the session */
export type SignOutTeardown = () => Promise<void>;

/** Runs before the sign-out request; see `PgSession.setOnSignOut` */
export type SignOutHook = () => Promise<SignOutTeardown | undefined>;

/**
 * Where the last sign-in stands. Held here, not by the control that started
 * it: the session footer unmounts when the rail swaps it for its own and when
 * the window crosses `LAYOUT_BREAKPOINTS.phone`, and a sign-in outlives both.
 */
export type SignInState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failed"; reason: SignInFailure; message: string };

const IDLE: SignInState = { status: "idle" };

/**
 * The non-2xx statuses that are an answer: nobody is signed in (401), or this
 * host has no auth route (404). Any other 4xx (a firewall's 403, a 408, 429)
 * says nothing about who is signed in.
 */
const ANSWERS = new Set([401, 404]);

/**
 * How long a session read may hang before it counts as no answer: a read
 * that never settles would leave `readState` unread and Home with nothing
 * to lead with or retry
 */
const READ_TIMEOUT_MS = 10_000;

/**
 * How a session read can go: none settled yet, `failed` (no answer, a 5xx
 * other than the not-configured 503, a 4xx other than `ANSWERS`, or JSON
 * that does not parse), when `get()` says nothing new about who is signed
 * in, or `answered`
 */
export type ReadState = "unread" | "failed" | "answered";

/**
 * A 2xx that is an HTML page: a host with no auth route serves its app shell
 * there, which says nobody can be signed in. Any other body is read as JSON,
 * and one that does not parse (a cut-off answer, a portal's text) throws, so
 * the read fails. JSON `null` is not a page: it is the route saying nobody is
 * signed in, as it does for an expired session.
 */
const isPage = (response: Response) =>
  !!response.headers?.get("content-type")?.includes("text/html");

/**
 * The auth route's 503 for a deployment with no sign-in configured. Only a
 * JSON body can say so; any other 503, a body that does not parse included,
 * is an outage.
 */
const notConfigured = async (response: Response) => {
  if (response.status !== 503) return false;
  if (!response.headers?.get("content-type")?.includes("application/json")) {
    return false;
  }
  try {
    const body = await response.json();
    if (body?.error !== AUTH_NOT_CONFIGURED) return false;
    // A deployment that lost its sign-in variables answers the same; say so
    log.warn("sign-in is not configured here", {
      context: { missing: body.missing },
    });
    return true;
  } catch (e) {
    // The 5xx branch reports the 503 with its status; the parse error is detail
    log.debug("session read 503 body did not parse", { context: { e } });
    return false;
  }
};

/**
 * Who is signed in on this browser, kept until a sign-out the server accepted.
 * That is what tells a session that expired from one that was ended: a sign-out
 * in another tab forgets the user here, and a tab opened after the cookie
 * expired still finds them. It holds the account's id, which keys its sync
 * marks, and what the account row draws; nothing secret.
 */
const SIGNED_IN_USER_KEY = "auth.signed-in-user";

/** This tab's user could not be written, so an empty entry says nothing */
let isRememberedUserUnwritten = false;

const writeRememberedUser = (user: SessionUser) => {
  try {
    // `signedInAt` makes every sign-in a new value: rewriting the same account
    // unchanged fires no \`storage\` event, and a tab whose session ended would
    // never hear that another tab signed it back in (\`followOtherTabs\`)
    localStorage.setItem(
      SIGNED_IN_USER_KEY,
      JSON.stringify({
        id: user.id,
        name: user.name,
        image: user.image,
        login: user.login,
        signedInAt: Date.now(),
      })
    );
    isRememberedUserUnwritten = false;
  } catch (error) {
    // A full origin, most likely. An older account's entry must not stand in
    // for this one; `readRememberedUserOr` falls back to the tab's own user
    isRememberedUserUnwritten = true;
    removeRememberedUser();
    log.warn("could not remember the signed-in user", {
      report: true,
      context: { error },
    });
  }
};

const removeRememberedUser = () => {
  try {
    localStorage.removeItem(SIGNED_IN_USER_KEY);
  } catch (error) {
    log.warn("could not forget the signed-in user", { context: { error } });
  }
};

const stringOr = (value: unknown) =>
  typeof value === "string" ? value : undefined;

/** The remembered user, or `known` when the entry cannot speak for itself */
const readRememberedUserOr = (
  known: SessionUser | undefined
): SessionUser | undefined => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SIGNED_IN_USER_KEY);
  } catch (error) {
    log.warn("could not read the signed-in user", { context: { error } });
    return known;
  }
  if (raw === null) return isRememberedUserUnwritten ? known : undefined;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id !== "string") {
      log.warn("the remembered user has no id");
      return known;
    }
    return {
      id: parsed.id,
      name: stringOr(parsed.name),
      image: stringOr(parsed.image),
      login: stringOr(parsed.login),
    };
  } catch (error) {
    log.warn("the remembered user did not parse", { context: { error } });
    return known;
  }
};

/**
 * The signed-in user, from our backend rather than from GitHub.
 *
 * `GithubAuth` answers "which GitHub account is this", which is what the
 * airdrop gate wants, and is deliberately reload-scoped. This answers "which
 * row owns the synced data" -- a different question with a different lifetime,
 * because the Better Auth cookie is HttpOnly and does survive a reload.
 *
 * Imported from `../../../utils/types` rather than the `utils` barrel: the
 * barrel reaches most of the app, and the circular-dependency plugin fails the
 * build on a cycle.
 */
export class PgSession {
  static get(): SessionUser | undefined {
    return PgSession._user;
  }

  /**
   * Re-read the session cookie.
   *
   * Never throws. A read that fails (see `ReadState`) keeps the user it had,
   * signed out on a first read; no answer, a 5xx other than the
   * not-configured 503, or JSON that does not parse is reported, any other
   * failing status only logged. A 401, a 404 and an HTML page (no auth route
   * here) are answers -- nobody -- except while a user is known, when the
   * last two are a proxy's and fail. Only a 401 or JSON with no user can say a
   * session expired (`expiredUser`).
   */
  static refresh(): Promise<void> {
    const read = PgSession._read().finally(() => {
      if (PgSession._reading === read) PgSession._reading = undefined;
    });
    PgSession._reading = read;
    return read;
  }

  /**
   * How session reads have gone (`ReadState`). Once one has answered it stays
   * `answered`: a later failed read says nothing new about who is signed in.
   * A change in this value fires `onDidChange` even if the user is unchanged.
   */
  static get readState(): ReadState {
    return PgSession._readState;
  }

  /**
   * The user whose session ended without a sign-out, until a session is back
   * or a read finds the user forgotten by a sign-out elsewhere. `get` answers
   * `undefined` meanwhile, so nothing uploads; the account row keeps this
   * user's name, and `PgSyncMark` keeps this user's marks, so an edit made
   * meanwhile still reads as owed.
   */
  static get expiredUser(): SessionUser | undefined {
    return PgSession._expiredUser;
  }

  /**
   * Whether the user that just arrived is the one whose session had ended.
   * True only while `onDidChange` fires for that arrival: they pick up where
   * they stopped, whichever tab signed them in.
   */
  static get isResuming(): boolean {
    return PgSession._isResuming;
  }

  /**
   * A tab whose session ended makes no requests, so nothing else tells it that
   * another tab signed in or out. It reads the session when the remembered user
   * changes; a live session finds out from its next request.
   */
  static followOtherTabs(): Disposable {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SIGNED_IN_USER_KEY && event.key !== null) return;
      if (PgSession._expiredUser) void PgSession.refresh();
    };
    window.addEventListener("storage", onStorage);
    return { dispose: () => window.removeEventListener("storage", onStorage) };
  }

  /**
   * `fetch` for a route that needs the session. A 401 for a known user asks for
   * a session read, which decides: one route's answer signs nobody out. Not
   * during a sign-out, whose own flush may race the cookie. A read already out
   * may have left before the cookie died, so one more follows it.
   */
  static async fetchAuthed(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    if (response.status === 401 && PgSession._user && !PgSession._signingOut) {
      PgSession._readAfterCurrent();
    }
    return response;
  }

  private static _readAfterCurrent() {
    if (!PgSession._reading) {
      void PgSession.refresh();
      return;
    }
    if (PgSession._isReadQueued) return;
    PgSession._isReadQueued = true;
    void PgSession._reading.then(() => {
      PgSession._isReadQueued = false;
      if (PgSession._user && !PgSession._signingOut) void PgSession.refresh();
    });
  }

  /** Whether a session read has settled, failed or answered */
  static get hasRead(): boolean {
    return PgSession._readState !== "unread";
  }

  /**
   * Settles once the session has been read: at once after any read, on the
   * read in flight if there is one, or on a first read started here. It never
   * reads again, so a caller deciding on `get()` waits for the page's own read
   * without turning a later sign-in elsewhere into a change seen here, which
   * the session effect would take for a sign-in of its own. It never rejects:
   * a failed read settles too, as `readState` `failed`.
   */
  static whenRead(): Promise<void> {
    if (PgSession.hasRead) return Promise.resolve();
    return PgSession._reading ?? PgSession.refresh();
  }

  /**
   * Settles once a session read has settled, without starting one: for a
   * reader that only displays the session. `whenRead` starts the first read
   * when none is in flight, and a read that early would reach the session
   * effect as a sign-in, opening the account's latest project under the user.
   */
  static afterFirstRead(): Promise<void> {
    if (PgSession._readState !== "unread") return Promise.resolve();
    return new Promise((resolve) => PgSession._readWaiters.add(resolve));
  }

  private static async _read() {
    let next: SessionUser | undefined;
    let failed = false;
    // The route itself saying nobody: not a host without one, not a proxy
    let isNobody = false;

    try {
      const response = await fetch("/api/auth/get-session", {
        credentials: "include",
        cache: "no-store",
        signal: timeoutSignal(READ_TIMEOUT_MS),
      });
      if (response.ok) {
        if (isPage(response)) {
          log.warn("session read answered a page, not JSON", {
            context: { status: response.status },
          });
          // A page where this user's session came from is a proxy's, not this
          // host lacking the route: it says nothing about them
          if (PgSession._user) failed = true;
        } else {
          const body = await response.json();
          next = body?.user
            ? {
                id: String(body.user.id),
                name: body.user.name ?? undefined,
                image: body.user.image ?? undefined,
                login: body.user.login ?? undefined,
              }
            : undefined;
          isNobody = !next;
        }
      } else if (await notConfigured(response)) {
        // This deployment has no sign-in, so nobody is signed in: an answer
      } else if (response.status === 404 && PgSession._user) {
        // As with a page: a host that served this user a session has the route
        failed = true;
        log.warn(`session read answered 404 for a known user`, {
          context: { status: response.status },
        });
      } else if (ANSWERS.has(response.status)) {
        isNobody = response.status === 401;
        log.warn(`session read answered ${response.status}`, {
          context: { status: response.status },
        });
      } else if (response.status >= 500) {
        failed = true;
        log.error(new Error(`session read answered ${response.status}`), {
          report: true,
          context: { status: response.status },
        });
      } else {
        // Expected under load or behind a firewall: logged, not reported
        failed = true;
        log.warn(`session read answered ${response.status}`, {
          context: { status: response.status },
        });
      }
    } catch (error) {
      failed = true;
      log.error(error, { report: true, context: { step: "refresh" } });
    }

    // A failed read keeps the user it had: it says nothing new about them
    if (failed) {
      PgSession._setRead("failed", PgSession._user);
      return;
    }
    const before = PgSession._expiredUser;
    // A read that said nothing about nobody leaves it as it stood
    if (isNobody) {
      PgSession._expiredUser = readRememberedUserOr(PgSession._user ?? before);
    }
    const after = PgSession._expiredUser;
    PgSession._setRead("answered", next);
    if (after && !before) authTelemetry.track("auth_session_expired", {});
    // `_setRead` stays silent when the user and the read state stood still
    if (after?.id !== before?.id) PgSession._emit();
  }

  /**
   * Sign in with GitHub, in a popup.
   *
   * `sign-in/social` is POST-only and answers with the authorize URL rather
   * than redirecting to it -- pointing a browser straight at the endpoint
   * returns 404 -- which is what lets the caller choose a popup over a
   * navigation. A navigation would drop everything the page holds in memory;
   * a popup keeps the editor exactly where it was.
   *
   * Nothing secret crosses the channel. Better Auth sets an HttpOnly session
   * cookie on our origin during its callback, and cookies are per-origin
   * rather than per-window, so the reply only has to say "finished" and this
   * side re-reads the session. Rejects when that read finds nobody signed in.
   */
  static signIn(): Promise<void> {
    return PgSession._signInWith(undefined, []);
  }

  /**
   * `signIn` from a task under way, asking for `scopes` on top of sign-in's
   * own: a feature that needs more than identity (gist sharing asks for
   * `gist`) names them, Better Auth appends them to its defaults, and signing
   * the same user in again only refreshes the stored token, so no user change
   * fires. A sign-in already running is joined, and claimed for this origin
   * (`claimPendingSignIn`).
   */
  static signInFor(from: SignInOrigin) {
    return (scopes: string[]): Promise<void> =>
      PgSession._signInWith(from, scopes);
  }

  /**
   * Give the sign-in under way this origin if it has none, so the session
   * effect keeps the project the task is about. A task that got there first
   * keeps its origin, and with no sign-in under way this does nothing. Joining
   * through `signInFor` does this too; a task that only waits, as the share
   * prompt waits on the account menu's sign-in, calls it directly.
   */
  static claimPendingSignIn(from: SignInOrigin) {
    const isRunning = PgSession._signInState.status === "pending";
    if (isRunning && PgSession._signingInFrom === undefined) {
      PgSession._signingInFrom = from;
    }
  }

  private static _signInWith(
    from: SignInOrigin | undefined,
    scopes: string[]
  ): Promise<void> {
    // One popup and one nonce at a time: a second click while the first flow
    // waits joins it instead of racing it for the session cookie. A flow that
    // lacks scopes this caller needs cannot answer it, so the caller waits for
    // it to settle and asks again.
    const pending = PgSession._pending;
    if (pending) {
      if (from) PgSession.claimPendingSignIn(from);
      const isCovered = scopes.every((scope) =>
        PgSession._pendingScopes.includes(scope)
      );
      if (isCovered) return pending;
      return pending.then(
        () => PgSession._signInWith(from, scopes),
        () => PgSession._signInWith(from, scopes)
      );
    }
    PgSession._pendingScopes = scopes;
    PgSession._pending = PgSession._signIn(from, scopes).finally(() => {
      PgSession._pending = undefined;
      PgSession._pendingScopes = [];
    });
    return PgSession._pending;
  }

  /** Where the last sign-in stands; `onDidChange` fires when it moves */
  static signInState(): SignInState {
    return PgSession._signInState;
  }

  private static async _signIn(
    from: SignInOrigin | undefined,
    scopes: string[]
  ) {
    authTelemetry.track("auth_sign_in_started", {});
    PgSession._signingInFrom = from;
    PgSession._setSignIn({ status: "pending" });
    const cancel = new AbortController();
    PgSession._cancel = cancel;
    try {
      await PgSession._signInThroughPopup(scopes, cancel.signal);
    } catch (error) {
      authTelemetry.track("auth_sign_in_failed", { reason: reasonOf(error) });
      PgSession._setSignIn({
        status: "failed",
        reason: reasonOf(error),
        message: messageOf(error),
      });
      throw error;
    } finally {
      PgSession._signingInFrom = undefined;
      // Only this flow's own: after a `reset`, a newer one may hold them
      if (PgSession._cancel === cancel) {
        PgSession._cancel = undefined;
        PgSession._channel = undefined;
      }
    }
    PgSession._setSignIn(IDLE);
    authTelemetry.track("auth_signed_in", {});
  }

  /**
   * The origin of the sign-in in progress (`signInFor`, or a task that joined
   * it), or `undefined` when none runs or it came from plain `signIn`.
   * Still set when `onDidChange` fires for that sign-in; cleared once it settles.
   */
  static get signingInFrom(): SignInOrigin | undefined {
    return PgSession._signingInFrom;
  }

  private static async _signInThroughPopup(
    scopes: string[],
    cancelled: AbortSignal
  ) {
    const nonce = randomNonce();

    // The signal aborts the body read as well as the request, so both awaits
    // sit under one mapping: the abort is the user's Cancel, anything else a
    // failed request
    let url: unknown;
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          callbackURL: `${AUTH_COMPLETE_ROUTE}?nonce=${nonce}`,
          ...(scopes.length ? { scopes } : {}),
        }),
        signal: cancelled,
      });
      if (!response.ok) {
        // The person reads one line for every way the start fails; the team
        // gets the answer it was
        log.warn("sign-in could not start", {
          context: { status: response.status },
        });
        throw new SignInFailed("request-failed", UNAVAILABLE);
      }
      ({ url } = await response.json());
    } catch (error) {
      if (cancelled.aborted) throw signInCancelled();
      throw error;
    }
    // A body that finished reading as the Cancel landed resolves anyway, and
    // nothing after this point would stop the popup opening
    if (cancelled.aborted) throw signInCancelled();
    if (typeof url !== "string" || !url) {
      log.warn("sign-in start answered no authorize URL");
      throw new SignInFailed("request-failed", UNAVAILABLE);
    }

    const isOurs = (data: unknown) =>
      !!data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === AUTH_MESSAGE_TYPE;

    const channel = PgSession._openChannel({
      url,
      name: AUTH_CHANNEL_NAME,
      features: "width=720,height=820",
      // The nonce is what makes the broadcast path safe to accept: it reaches
      // every same-origin context, so the window alone cannot be the filter
      accept: (data) =>
        isOurs(data) && (data as { nonce?: unknown }).nonce === nonce,
      claims: isOurs,
      broadcastName: AUTH_CHANNEL_NAME,
      timeoutMs: FLOW_MAX_AGE_SECONDS * 1000,
    });
    if (!channel) {
      throw new SignInFailed(
        "popup-blocked",
        "Allow pop-ups for this site to sign in with GitHub."
      );
    }

    const receipt = await channel.receive();
    if (!receipt.delivered) {
      if (receipt.reason === "cancelled") throw signInCancelled();
      throw new SignInFailed(receipt.reason, DID_NOT_FINISH);
    }

    await PgSession.refresh();
    // `refresh` never throws, so a failed read would otherwise pass for a sign-in
    if (!PgSession.get()) {
      throw new SignInFailed("request-failed", DID_NOT_FINISH);
    }
  }

  /**
   * Stop the sign-in in progress, at whatever step it is: while the authorize
   * URL loads no popup opens, and once it is open the wait on it ends. `signIn`
   * then rejects as cancelled, unless the popup's reply won the race. A caller
   * queued behind it for wider scopes still starts its own sign-in afterwards.
   * Inert unless a sign-in is outstanding.
   */
  static cancelSignIn() {
    PgSession._cancel?.abort();
    PgSession._channel?.cancel();
  }

  /**
   * End the session.
   *
   * Signed out only once the server says so. A refused or unsent request
   * leaves the HttpOnly cookie in place, so clearing the UI anyway showed a
   * signed-out header that a reload undid -- on a shared browser, handing the
   * account to the next person while telling the user it had not. The user
   * stays signed in, nothing local is torn down, and this rejects with a
   * message for them.
   *
   * A call while one is running joins it rather than starting another: two
   * teardowns at once deleted the same workspaces twice.
   */
  static signOut(): Promise<void> {
    PgSession._signingOut ??= PgSession._signOut().finally(() => {
      PgSession._signingOut = undefined;
    });
    return PgSession._signingOut;
  }

  /**
   * Whether the server has ended the session and its local teardown is
   * running.
   *
   * `get` still answers the user then, because what the teardown removes is
   * keyed by their id. Nothing may go to the network on their behalf, though:
   * the cookie is gone, every request answers 401, and each one was reported
   * as a sync failure on an ordinary sign-out.
   */
  static get isEnding(): boolean {
    return PgSession._ending;
  }

  private static async _signOut() {
    // Before the cookie goes, so anything holding unsynced local state gets a
    // last chance at the network while the request is still authenticated.
    // Never allowed to block the sign-out itself -- but a hook that throws
    // returns no teardown either.
    let teardown: SignOutTeardown | undefined;
    try {
      teardown = await PgSession._onSignOut?.();
    } catch (error) {
      // Nothing local is forgotten: the account's conversations and projects
      // stay on this browser after it signs out
      log.error(error, { report: true, context: { step: "flush" } });
    }

    let res: Response;
    try {
      res = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        signal: timeoutSignal(SIGN_OUT_TIMEOUT_MS),
      });
    } catch (error) {
      // Offline, or timed out: the user's network, not a defect to report
      log.warn("sign-out request failed; still signed in", {
        context: {
          step: "request",
          error: String(error),
          name: (error as Error | undefined)?.name,
        },
      });
      throw new Error("Could not sign out. Check your connection.");
    }
    if (!res.ok) {
      log.error(new Error(`sign-out request answered ${res.status}`), {
        report: true,
        context: { step: "request", status: res.status },
      });
      throw new Error("Could not sign out. Try again.");
    }

    removeRememberedUser();
    PgSession._expiredUser = undefined;
    PgSession._ending = true;
    try {
      // While the user is still readable: what it removes is keyed by their id
      try {
        await teardown?.();
      } catch (error) {
        // The previous account's data may be left on this browser
        log.error(error, { report: true, context: { step: "teardown" } });
      }
      PgSession._set(undefined);
    } finally {
      PgSession._ending = false;
    }
    authTelemetry.track("auth_signed_out", {});
  }

  /**
   * Register what must happen around a sign-out.
   *
   * The hook runs before the request, while it is still authenticated, and
   * may return a teardown. The teardown runs only once the server has ended
   * the session: a sign-out that fails leaves the user signed in, and must
   * not leave them with their conversation closed and their projects gone.
   *
   * Inversion on purpose: the persistence slice needs to flush threads here,
   * but it already imports this module, and importing it back would make the
   * two slices circular. The session effect wires them together instead, so
   * the browser side of `features/auth` stays unaware that persistence exists
   * (its server module, `model/auth.mjs`, does import it).
   */
  static setOnSignOut(hook: SignOutHook | undefined) {
    PgSession._onSignOut = hook;
  }

  static onDidChange(cb: () => void): Disposable {
    PgSession._listeners.add(cb);
    return { dispose: () => PgSession._listeners.delete(cb) };
  }

  /** Test seam: set the user without a network round trip */
  static async refreshWith(user: SessionUser | undefined) {
    PgSession._setRead("answered", user);
  }

  /** Test seam: open a stub channel instead of a real popup */
  static setOpenChannel(open: typeof openPopupChannel) {
    PgSession._openChannelImpl = open;
  }

  /** Test seam: drop all state without touching the network */
  static reset() {
    PgSession._user = undefined;
    PgSession._expiredUser = undefined;
    PgSession._isResuming = false;
    PgSession._isReadQueued = false;
    isRememberedUserUnwritten = false;
    removeRememberedUser();
    PgSession._onSignOut = undefined;
    PgSession._listeners.clear();
    PgSession._cancel = undefined;
    PgSession._channel = undefined;
    PgSession._openChannelImpl = openPopupChannel;
    PgSession._signingInFrom = undefined;
    PgSession._signingOut = undefined;
    PgSession._ending = false;
    PgSession._pending = undefined;
    PgSession._pendingScopes = [];
    PgSession._signInState = IDLE;
    PgSession._readState = "unread";
    PgSession._readWaiters.clear();
    PgSession._reading = undefined;
  }

  private static _signingOut: Promise<void> | undefined;
  private static _ending = false;
  private static _user: SessionUser | undefined;
  private static _expiredUser: SessionUser | undefined;
  private static _isResuming = false;
  private static _isReadQueued = false;
  private static _signingInFrom: SignInOrigin | undefined;
  private static _onSignOut: SignOutHook | undefined;
  private static readonly _listeners = new Set<() => void>();

  private static _pending: Promise<void> | undefined;
  /** The scopes `_pending` asked GitHub for, on top of sign-in's own */
  private static _pendingScopes: string[] = [];
  /** Callers of `afterFirstRead` waiting for the first read to settle */
  private static readonly _readWaiters = new Set<() => void>();
  /** How session reads have gone, sticky once `answered`; see `readState` */
  private static _readState: ReadState = "unread";
  private static _reading: Promise<void> | undefined;
  private static _signInState: SignInState = IDLE;

  /** Aborts the sign-in in flight; set from its start, cleared when it settles */
  private static _cancel: AbortController | undefined;
  /** The popup of the sign-in in flight; set once it opens, cleared when it settles */
  private static _channel: PopupChannel | undefined;
  private static _openChannelImpl: typeof openPopupChannel = openPopupChannel;

  /** Opens and remembers the channel, so `cancelSignIn` can end the wait on an open popup */
  private static _openChannel(
    ...args: Parameters<typeof openPopupChannel>
  ): PopupChannel | undefined {
    PgSession._channel = PgSession._openChannelImpl(...args);
    return PgSession._channel;
  }

  private static _setSignIn(state: SignInState) {
    PgSession._signInState = state;
    PgSession._emit();
  }

  /** Settle a read: its state, then its user, with one change for both */
  private static _setRead(state: ReadState, user: SessionUser | undefined) {
    const next =
      state === "failed" && PgSession._readState === "answered"
        ? "answered"
        : state;
    const stateChanged = PgSession._readState !== next;
    PgSession._readState = next;
    const waiters = [...PgSession._readWaiters];
    PgSession._readWaiters.clear();
    waiters.forEach((resolve) => resolve());
    if (!PgSession._set(user) && stateChanged) PgSession._emit();
  }

  private static _emit() {
    for (const cb of PgSession._listeners) cb();
  }

  /** Set the user; whether it changed, and so whether listeners heard */
  private static _set(user: SessionUser | undefined): boolean {
    const unchanged =
      PgSession._user?.id === user?.id &&
      PgSession._user?.name === user?.name &&
      PgSession._user?.image === user?.image &&
      PgSession._user?.login === user?.login;
    if (unchanged) return false;

    PgSession._user = user;
    if (user) {
      writeRememberedUser(user);
      PgSession._isResuming = PgSession._expiredUser?.id === user.id;
      PgSession._expiredUser = undefined;
      // A failure from before this session says nothing about it, and would
      // speak over the line when this session ends
      if (PgSession._signInState.status === "failed") {
        PgSession._signInState = IDLE;
      }
    }
    PgSession._emit();
    PgSession._isResuming = false;
    return true;
  }
}

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, afterEach } = import.meta.vitest;
  type Mock = import("vitest").Mock;
  describe("features/auth/model/session", () => {
    let initLogger: typeof import("@/shared/lib/logger").initLogger;
    let memoryProvider: typeof import("@/shared/lib/logger").memoryProvider;
    let resetLogger: typeof import("@/shared/lib/logger").resetLogger;
    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "@/shared/lib/logger"
      ));
    });
    const signedIn = (user: {
      id: string;
      name: string | undefined;
      image?: string | undefined;
      login?: string | undefined;
    }) =>
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ user }),
      }) as unknown as typeof fetch;

    describe("PgSession", () => {
      afterEach(() => {
        (global.fetch as Mock | undefined)?.mockReset?.();
        vi.restoreAllMocks();
        PgSession.reset();
        resetLogger();
      });

      it.each<[string, () => Promise<unknown>]>([
        [
          "a read answers",
          () => {
            vi.spyOn(globalThis, "fetch").mockImplementation(
              signedIn({ id: "u1", name: "Ada", image: undefined })
            );
            return PgSession.refresh();
          },
        ],
        [
          "a read fails",
          () => {
            vi.spyOn(globalThis, "fetch").mockRejectedValue(
              new Error("offline")
            );
            return PgSession.refresh();
          },
        ],
        ["the test seam sets a user", () => PgSession.refreshWith(undefined)],
      ])("afterFirstRead waits until %s", async (_, settle) => {
        const request = vi.spyOn(globalThis, "fetch");
        let settled = false;
        const waited = PgSession.afterFirstRead().then(() => (settled = true));

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(request).not.toHaveBeenCalled();

        await settle();
        await waited;
        expect(settled).toBe(true);
        // Once settled, a later caller does not wait
        await PgSession.afterFirstRead();
      });

      it("waits on the read in flight instead of reading again", async () => {
        let answer!: (user: unknown) => void;
        const request = vi.spyOn(globalThis, "fetch").mockReturnValue(
          new Promise<Response>(
            (resolve) =>
              (answer = (user) =>
                resolve({
                  ok: true,
                  json: async () => ({ user }),
                } as Response))
          )
        );
        const read = PgSession.refresh();
        let settled = false;
        const waited = PgSession.whenRead().then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);

        answer({ id: "u1", name: undefined, image: undefined });
        await Promise.all([read, waited]);

        expect(PgSession.get()?.id).toBe("u1");
        expect(request).toHaveBeenCalledTimes(1);
      });

      it("reads once when nothing has read the session yet", async () => {
        const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: true,
          // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
          json: async () => ({ user: null }),
        } as Response);

        await PgSession.whenRead();
        await PgSession.whenRead();

        expect(request).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["no answer", () => Promise.reject(new Error("offline")), true],
        [
          "a 503",
          () =>
            Promise.resolve({
              ok: false,
              status: 503,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({ error: "upstream" }),
            }),
          true,
        ],
        ["a 401", () => Promise.resolve({ ok: false, status: 401 }), false],
        ["a 429", () => Promise.resolve({ ok: false, status: 429 }), true],
        ["a 408", () => Promise.resolve({ ok: false, status: 408 }), true],
        ["a 425", () => Promise.resolve({ ok: false, status: 425 }), true],
        ["a 403", () => Promise.resolve({ ok: false, status: 403 }), true],
        ["a 404", () => Promise.resolve({ ok: false, status: 404 }), false],
        ["a 502", () => Promise.resolve({ ok: false, status: 502 }), true],
        [
          "a 503 that is a page",
          () =>
            Promise.resolve({
              ok: false,
              status: 503,
              headers: new Headers({ "content-type": "text/html" }),
            }),
          true,
        ],
        [
          "a 200 that is a page (no auth route here)",
          () =>
            Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ "content-type": "text/html" }),
              json: async () => {
                throw new SyntaxError("Unexpected token '<'");
              },
            }),
          false,
        ],
        [
          "a 200 whose JSON is cut off",
          () =>
            Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => {
                throw new SyntaxError("Unexpected end of JSON input");
              },
            }),
          true,
        ],
        ["a 400", () => Promise.resolve({ ok: false, status: 400 }), true],
        [
          "a 503 whose JSON body does not parse",
          () =>
            Promise.resolve({
              ok: false,
              status: 503,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => {
                throw new SyntaxError("Unexpected end of JSON input");
              },
            }),
          true,
        ],
        [
          "a 503 saying sign-in is not configured",
          () =>
            Promise.resolve({
              ok: false,
              status: 503,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({ error: AUTH_NOT_CONFIGURED }),
            }),
          false,
        ],
        [
          "nobody",
          () =>
            // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
            Promise.resolve({ ok: true, json: async () => ({ user: null }) }),
          false,
        ],
      ])(
        "marks a read that got %s as failed: %s",
        async (_, answer, failed) => {
          initLogger({ providers: [memoryProvider()] });
          vi.spyOn(globalThis, "fetch").mockImplementation(
            answer as unknown as typeof fetch
          );

          await PgSession.whenRead();

          expect(PgSession.hasRead).toBe(true);
          expect(PgSession.readState).toBe(failed ? "failed" : "answered");
          expect(PgSession.get()).toBeUndefined();
        }
      );

      it("tells listeners when a failed read is answered, though nobody is signed in", async () => {
        initLogger({ providers: [memoryProvider()] });
        const request = vi
          .spyOn(globalThis, "fetch")
          .mockRejectedValueOnce(new Error("offline"));
        await PgSession.refresh();
        expect(PgSession.readState).toBe("failed");

        const heard = vi.fn();
        PgSession.onDidChange(heard);
        request.mockResolvedValueOnce({
          ok: true,
          // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
          json: async () => ({ user: null }),
        } as Response);
        await PgSession.refresh();

        expect(PgSession.readState).toBe("answered");
        expect(heard).toHaveBeenCalledTimes(1);
      });

      it("stays answered when a later read fails", async () => {
        initLogger({ providers: [memoryProvider()] });
        const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
          ok: true,
          // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
          json: async () => ({ user: null }),
        } as Response);
        await PgSession.refresh();
        request.mockRejectedValueOnce(new Error("offline"));
        await PgSession.refresh();

        expect(PgSession.readState).toBe("answered");
      });

      it.each([
        [502, true],
        [429, false],
        [403, false],
      ])("reports a read that answered %i: %s", async (status, reported) => {
        const logs = memoryProvider();
        initLogger({ providers: [logs] });
        vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: false,
          status,
        } as Response);

        await PgSession.refresh();

        expect(PgSession.readState).toBe("failed");
        expect(logs.entries.some((e) => e.report)).toBe(reported);
      });

      it("gives up on a read that hangs, as no answer", async () => {
        initLogger({ providers: [memoryProvider()] });
        const request = vi
          .spyOn(globalThis, "fetch")
          .mockRejectedValue(new DOMException("timed out", "TimeoutError"));

        await PgSession.refresh();

        expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
        expect(PgSession.readState).toBe("failed");
      });

      it("tells listeners when the first read fails, and not again when the next one does", async () => {
        initLogger({ providers: [memoryProvider()] });
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
        const heard = vi.fn();
        PgSession.onDidChange(heard);

        await PgSession.refresh();
        expect(heard).toHaveBeenCalledTimes(1);
        await PgSession.refresh();
        expect(heard).toHaveBeenCalledTimes(1);
      });

      it.each([
        [
          "a page",
          {
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "text/html" }),
          },
        ],
        ["a 404", { ok: false, status: 404 }],
      ])("keeps a known user through %s", async (_, answer) => {
        initLogger({ providers: [memoryProvider()] });
        const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            user: { id: "u1", name: undefined, image: undefined },
          }),
        } as Response);
        await PgSession.refresh();
        request.mockResolvedValueOnce(answer as Response);
        await PgSession.refresh();

        expect(PgSession.get()?.id).toBe("u1");
      });

      it("keeps a signed-in user through a read that fails", async () => {
        initLogger({ providers: [memoryProvider()] });
        const request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            user: { id: "u1", name: undefined, image: undefined },
          }),
        } as Response);
        await PgSession.refresh();
        request.mockRejectedValueOnce(new Error("offline"));
        await PgSession.refresh();

        expect(PgSession.get()?.id).toBe("u1");
      });

      it("is signed out before any refresh", () => {
        expect(PgSession.get()).toBeUndefined();
      });

      it("reads the profile fields the route answers `null` for as undefined", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({
            user: {
              id: "u1",
              // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for a missing field
              name: null,
              // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for a missing field
              image: null,
              // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for a missing field
              login: null,
            },
          }),
        } as Response);

        await PgSession.refresh();

        const user = PgSession.get();
        expect(user?.name).toBeUndefined();
        expect(user?.image).toBeUndefined();
        expect(user?.login).toBeUndefined();
      });

      it("reads the user from the session endpoint", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: "Ada", image: undefined })
        );

        await PgSession.refresh();

        expect(PgSession.get()).toEqual({
          id: "u1",
          name: "Ada",
          image: undefined,
          login: undefined,
        });
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/get-session",
          expect.objectContaining({ credentials: "include" })
        );
      });

      it("signs a known user out when the route answers JSON null, an expired session", async () => {
        await PgSession.refreshWith({
          id: "u1",
          name: "Ada",
          image: undefined,
          login: "ada",
        });
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
            json: async () => null,
          }) as unknown as typeof fetch
        );

        await PgSession.refresh();

        expect(PgSession.get()).toBeUndefined();
        expect(PgSession.readState).toBe("answered");
      });

      describe("a session that ended without a sign-out", () => {
        const ADA = {
          id: "u1",
          name: "Ada",
          image: undefined,
          login: "ada",
        };
        const REMEMBERED = JSON.stringify(ADA);
        const answers = (response: unknown) =>
          vi
            .spyOn(globalThis, "fetch")
            .mockImplementation(
              vi.fn().mockResolvedValue(response) as unknown as typeof fetch
            );
        // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
        const JSON_NULL = { ok: true, json: async () => null };

        it.each<{ label: string; response: unknown }>([
          { label: "JSON null", response: JSON_NULL },
          { label: "a 401", response: { ok: false, status: 401 } },
          {
            label: "a body with no user",
            response: { ok: true, json: async () => ({}) },
          },
        ])(
          "reads as expired on $label, keeping who it was",
          async ({ response }) => {
            await PgSession.refreshWith(ADA);
            answers(response);

            await PgSession.refresh();

            expect(PgSession.get()).toBeUndefined();
            expect(PgSession.expiredUser).toEqual(ADA);
          }
        );

        it.each<{ label: string; response: unknown }>([
          {
            label: "a page",
            response: {
              ok: true,
              headers: new Headers({ "content-type": "text/html" }),
              json: async () => ({}),
            },
          },
          { label: "a 404", response: { ok: false, status: 404 } },
          {
            label: "the not-configured 503",
            response: {
              ok: false,
              status: 503,
              headers: new Headers({ "content-type": "application/json" }),
              json: async () => ({ error: AUTH_NOT_CONFIGURED }),
            },
          },
          { label: "a 500", response: { ok: false, status: 500 } },
        ])("does not read as expired on $label", async ({ response }) => {
          await PgSession.refreshWith(ADA);
          answers(response);
          initLogger({ providers: [memoryProvider()] });

          await PgSession.refresh();

          expect(PgSession.expiredUser).toBeUndefined();
        });

        it("says nothing for a browser nobody signed in on", async () => {
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toBeUndefined();
        });

        it("reads as expired on a fresh load, from the remembered user", async () => {
          localStorage.setItem(SIGNED_IN_USER_KEY, REMEMBERED);
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toEqual(ADA);
        });

        it("ignores a remembered user it cannot parse", async () => {
          localStorage.setItem(SIGNED_IN_USER_KEY, "{not json");
          initLogger({ providers: [memoryProvider()] });
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toBeUndefined();
        });

        it("does not read as expired once another tab's sign-out forgot the user", async () => {
          await PgSession.refreshWith(ADA);
          localStorage.removeItem(SIGNED_IN_USER_KEY);
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.get()).toBeUndefined();
          expect(PgSession.expiredUser).toBeUndefined();
        });

        it("forgets the user on an accepted sign-out", async () => {
          await PgSession.refreshWith(ADA);
          answers({ ok: true });

          await PgSession.signOut();

          expect(localStorage.getItem(SIGNED_IN_USER_KEY)).toBeNull();
        });

        it("remembers the user through a refused sign-out", async () => {
          await PgSession.refreshWith(ADA);
          initLogger({ providers: [memoryProvider()] });
          answers({ ok: false, status: 500 });

          await expect(PgSession.signOut()).rejects.toThrow();

          const kept = localStorage.getItem(SIGNED_IN_USER_KEY);
          expect(kept && JSON.parse(kept).id).toBe(ADA.id);
        });

        it("falls back to the user in memory when storage throws", async () => {
          await PgSession.refreshWith(ADA);
          initLogger({ providers: [memoryProvider()] });
          vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
          });
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toEqual(ADA);
        });

        it("ends when a session comes back", async () => {
          await PgSession.refreshWith(ADA);
          answers(JSON_NULL);
          await PgSession.refresh();

          await PgSession.refreshWith(ADA);

          expect(PgSession.expiredUser).toBeUndefined();
        });

        it("tells listeners when a fresh load finds it, with no user to lose", async () => {
          await PgSession.refreshWith(undefined);
          localStorage.setItem(SIGNED_IN_USER_KEY, REMEMBERED);
          const heard = vi.fn();
          PgSession.onDidChange(heard);
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(heard).toHaveBeenCalled();
          expect(PgSession.expiredUser).toEqual(ADA);
        });

        /** Whether listeners read `isResuming` when `next` arrived */
        const resumingAs = async (next: typeof ADA) => {
          await PgSession.refreshWith(ADA);
          answers(JSON_NULL);
          await PgSession.refresh();
          let resuming: boolean | undefined;
          PgSession.onDidChange(() => {
            if (PgSession.get()) resuming = PgSession.isResuming;
          });
          await PgSession.refreshWith(next);
          return resuming;
        };

        it("is resuming when the same account comes back, only as it arrives", async () => {
          expect(await resumingAs(ADA)).toBe(true);
          expect(PgSession.isResuming).toBe(false);
        });

        it("is not resuming when another account signs in", async () => {
          expect(
            await resumingAs({
              id: "u2",
              name: ADA.name,
              image: ADA.image,
              login: ADA.login,
            })
          ).toBe(false);
        });

        it("clears once the remembered user is forgotten, telling listeners", async () => {
          await PgSession.refreshWith(ADA);
          answers(JSON_NULL);
          await PgSession.refresh();
          const heard = vi.fn();
          PgSession.onDidChange(heard);
          localStorage.removeItem(SIGNED_IN_USER_KEY);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toBeUndefined();
          expect(heard).toHaveBeenCalled();
        });

        it("reads when another tab changes who is remembered", async () => {
          await PgSession.refreshWith(ADA);
          answers(JSON_NULL);
          await PgSession.refresh();
          const watching = PgSession.followOtherTabs();
          localStorage.removeItem(SIGNED_IN_USER_KEY);

          window.dispatchEvent(
            new StorageEvent("storage", { key: SIGNED_IN_USER_KEY })
          );
          await vi.waitFor(() => expect(PgSession.expiredUser).toBeUndefined());
          watching.dispose();
        });

        it("rewrites the remembered entry when the same account signs in again", async () => {
          await PgSession.refreshWith(ADA);
          const first = localStorage.getItem(SIGNED_IN_USER_KEY);
          answers(JSON_NULL);
          await PgSession.refresh();
          vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);

          await PgSession.refreshWith(ADA);

          // An identical value fires no \`storage\` event, so the other tab
          // whose session ended would never hear of this sign-in
          expect(localStorage.getItem(SIGNED_IN_USER_KEY)).not.toBe(first);
        });

        it("ignores another tab's change while a session is live", async () => {
          await PgSession.refreshWith(ADA);
          const fetched = vi.spyOn(globalThis, "fetch");
          const watching = PgSession.followOtherTabs();

          window.dispatchEvent(
            new StorageEvent("storage", { key: SIGNED_IN_USER_KEY })
          );

          expect(fetched).not.toHaveBeenCalled();
          watching.dispose();
        });

        it("reads as expired when the write failed on a full storage", async () => {
          initLogger({ providers: [memoryProvider()] });
          const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
              throw new Error("quota");
            });
          await PgSession.refreshWith(ADA);
          setItem.mockRestore();
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toEqual(ADA);
        });

        it("does not keep an older account's entry over a failed write", async () => {
          initLogger({ providers: [memoryProvider()] });
          await PgSession.refreshWith(ADA);
          await PgSession.refreshWith(undefined);
          const bob = {
            id: "u2",
            name: ADA.name,
            image: ADA.image,
            login: ADA.login,
          };
          const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
              throw new Error("quota");
            });
          await PgSession.refreshWith(bob);
          setItem.mockRestore();
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toEqual(bob);
        });

        it("falls back to the user in memory on a corrupt entry", async () => {
          initLogger({ providers: [memoryProvider()] });
          await PgSession.refreshWith(ADA);
          localStorage.setItem(SIGNED_IN_USER_KEY, "{not json");
          answers(JSON_NULL);

          await PgSession.refresh();

          expect(PgSession.expiredUser).toEqual(ADA);
        });

        it("forgets a failed sign-in once a session arrives, so an expiry can say so", async () => {
          await PgSession.refreshWith(undefined);
          PgSession.setOpenChannel(() => undefined);
          answers({ ok: false, status: 500 });
          initLogger({ providers: [memoryProvider()] });
          await expect(PgSession.signIn()).rejects.toThrow();
          expect(PgSession.signInState().status).toBe("failed");

          await PgSession.refreshWith(ADA);

          expect(PgSession.signInState().status).toBe("idle");
        });
      });

      describe("fetchAuthed", () => {
        const ADA = {
          id: "u1",
          name: "Ada",
          image: undefined,
          login: "ada",
        };
        /** The route answers `status`; the session read finds nobody. Counts the reads. */
        const routeAnswers = (status: number) => {
          const counted = { reads: 0 };
          vi.spyOn(globalThis, "fetch").mockImplementation((async (
            url: string
          ) => {
            if (url !== "/api/auth/get-session") {
              return { ok: status < 400, status };
            }
            counted.reads += 1;
            return { ok: true, json: async () => ({}) };
          }) as unknown as typeof fetch);
          return counted;
        };

        it("reads the session on a 401 for a known user, and hands the answer back", async () => {
          await PgSession.refreshWith(ADA);
          routeAnswers(401);

          const response = await PgSession.fetchAuthed("/api/projects", {});
          await vi.waitFor(() => expect(PgSession.get()).toBeUndefined());

          expect(response.status).toBe(401);
          expect(PgSession.expiredUser).toEqual(ADA);
        });

        it.each([
          {
            label: "still finds the user",
            read: { ok: true, json: async () => ({ user: ADA }) },
          },
          { label: "fails", read: { ok: false, status: 500 } },
        ])(
          "does not end the session on a route's 401 when the read $label",
          async ({ read }) => {
            await PgSession.refreshWith(ADA);
            initLogger({ providers: [memoryProvider()] });
            const reads = vi.fn();
            vi.spyOn(globalThis, "fetch").mockImplementation((async (
              url: string
            ) => {
              if (url !== "/api/auth/get-session") {
                return { ok: false, status: 401 };
              }
              reads();
              return read;
            }) as unknown as typeof fetch);

            await PgSession.fetchAuthed("/api/projects", {});
            await vi.waitFor(() => expect(reads).toHaveBeenCalled());
            await PgSession.whenRead();

            expect(PgSession.get()?.id).toBe(ADA.id);
            expect(PgSession.expiredUser).toBeUndefined();
          }
        );

        it("reads again when a 401 lands during a read that found the user", async () => {
          await PgSession.refreshWith(ADA);
          let finish: (value: unknown) => void = () => undefined;
          const first = new Promise((resolve) => {
            finish = resolve;
          });
          let reads = 0;
          vi.spyOn(globalThis, "fetch").mockImplementation((async (
            url: string
          ) => {
            if (url !== "/api/auth/get-session") {
              return { ok: false, status: 401 };
            }
            reads += 1;
            return reads === 1 ? first : { ok: true, json: async () => ({}) };
          }) as unknown as typeof fetch);
          const reading = PgSession.refresh();

          await PgSession.fetchAuthed("/api/projects", {});
          finish({ ok: true, json: async () => ({ user: ADA }) });
          await reading;

          await vi.waitFor(() => expect(PgSession.expiredUser).toEqual(ADA));
        });

        it("reads nothing on any other answer", async () => {
          await PgSession.refreshWith(ADA);
          const counted = routeAnswers(500);

          await PgSession.fetchAuthed("/api/projects", {});

          expect(counted.reads).toBe(0);
        });

        it("reads nothing with nobody signed in", async () => {
          const counted = routeAnswers(401);

          await PgSession.fetchAuthed("/api/projects", {});

          expect(counted.reads).toBe(0);
        });

        it("reads once for several 401s at once", async () => {
          await PgSession.refreshWith(ADA);
          const counted = routeAnswers(401);

          await Promise.all([
            PgSession.fetchAuthed("/api/projects", {}),
            PgSession.fetchAuthed("/api/conversations", {}),
          ]);
          await vi.waitFor(() => expect(PgSession.get()).toBeUndefined());

          expect(counted.reads).toBe(1);
        });

        it("reads nothing during a sign-out, whose own flush may meet a 401", async () => {
          await PgSession.refreshWith(ADA);
          const counted = routeAnswers(401);
          PgSession.setOnSignOut(async () => {
            await PgSession.fetchAuthed("/api/projects", {});
            return undefined;
          });
          initLogger({ providers: [memoryProvider()] });

          await PgSession.signOut().catch(() => undefined);

          expect(counted.reads).toBe(0);
        });
      });

      it("treats an empty session body as signed out", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
            json: async () => null,
          }) as unknown as typeof fetch
        );

        await PgSession.refresh();

        expect(PgSession.get()).toBeUndefined();
      });

      it.each([
        ["a request that throws", new Error("offline"), "error", true],
        ["a 5xx", 503, "error", true],
        ["a 4xx", 404, "warn", false],
      ] as const)(
        "treats %s as signed out, and logs it",
        async (_label, answer, level, report) => {
          const request = vi.spyOn(globalThis, "fetch");
          if (answer instanceof Error) request.mockRejectedValue(answer);
          else
            request.mockResolvedValue({
              ok: false,
              status: answer,
            } as Response);
          const logged = memoryProvider();
          initLogger({ providers: [logged] });

          await PgSession.refresh();

          expect(PgSession.get()).toBeUndefined();
          expect(logged.entries).toEqual([
            expect.objectContaining({ ns: "auth:session", level, report }),
          ]);
        }
      );

      it("notifies subscribers when the user changes", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: undefined, image: undefined })
        );
        const seen: unknown[] = [];
        const sub = PgSession.onDidChange(() => seen.push(PgSession.get()));

        await PgSession.refresh();
        sub.dispose();

        expect(seen).toEqual([
          { id: "u1", name: undefined, image: undefined, login: undefined },
        ]);
      });

      it("does not notify when the user is unchanged", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: "Ada", image: undefined })
        );
        await PgSession.refresh();

        let calls = 0;
        const sub = PgSession.onDidChange(() => calls++);
        await PgSession.refresh();
        sub.dispose();

        expect(calls).toBe(0);
      });

      it("signs in through a popup, not a navigation, and re-reads the session", async () => {
        // `sign-in/social` is POST-only and answers with the authorize URL rather
        // than redirecting, which is what lets us open a popup instead of
        // navigating away and losing everything the page holds in memory
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string) =>
            url === "/api/auth/sign-in/social"
              ? Promise.resolve({
                  ok: true,
                  json: async () => ({
                    url: "https://github.com/login/oauth/x",
                  }),
                })
              : Promise.resolve({
                  ok: true,
                  json: async () => ({
                    user: {
                      id: "u1",
                      name: "Ada",
                      image: undefined,
                      login: "ada",
                    },
                  }),
                })
          ) as unknown as typeof fetch
        );

        let opened: { url: string; broadcastName?: string } | undefined;
        PgSession.setOpenChannel((opts) => {
          opened = opts;
          return {
            receive: async () => ({ delivered: true as const, data: {} }),
            cancel: () => {},
          };
        });

        await PgSession.signIn();

        expect(opened!.url).toBe("https://github.com/login/oauth/x");
        // The fallback path for when COOP severs window.opener
        expect(opened!.broadcastName).toBe("pg-auth-complete");
        // Cookie is set on our origin by the callback, so the session is readable
        expect(PgSession.get()).toEqual({
          id: "u1",
          name: "Ada",
          image: undefined,
          login: "ada",
        });
      });

      it("sends the popup to the completion route carrying a nonce", async () => {
        let body: string | undefined;
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string, init: RequestInit) => {
            if (url === "/api/auth/sign-in/social") {
              body = init.body as string;
              return Promise.resolve({
                ok: true,
                json: async () => ({ url: "https://x/" }),
              });
            }
            return Promise.resolve({
              ok: true,
              json: async () => ({ user: { id: "u1" } }),
            });
          }) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));

        await PgSession.signIn();

        const sent = JSON.parse(body!);
        expect(sent.provider).toBe("github");
        expect(sent.callbackURL).toMatch(
          /^\/api\/auth-complete\?nonce=[0-9a-f]{32}$/
        );
      });

      it("asks GitHub for extra scopes only when the caller names them", async () => {
        const bodies: Array<Record<string, unknown>> = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string, init: RequestInit) => {
            if (url === "/api/auth/sign-in/social") {
              bodies.push(JSON.parse(init.body as string));
              return Promise.resolve({
                ok: true,
                json: async () => ({ url: "https://x/" }),
              });
            }
            return Promise.resolve({
              ok: true,
              json: async () => ({ user: { id: "u1" } }),
            });
          }) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));

        await PgSession.signIn();
        await PgSession.signInFor("share")(["gist"]);

        expect("scopes" in bodies[0]).toBe(false);
        expect(bodies[1].scopes).toEqual(["gist"]);
      });

      it("fires no user change when a scope grant signs the same user in again", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string) =>
            Promise.resolve({
              ok: true,
              json: async () =>
                url === "/api/auth/sign-in/social"
                  ? { url: "https://x/" }
                  : {
                      user: {
                        id: "u1",
                        name: "Ada",
                        // eslint-disable-next-line unicorn/no-null -- a session answer says `null` for an account without an avatar
                        image: null,
                        login: "ada",
                      },
                    },
            })
          ) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));
        await PgSession.refreshWith({
          id: "u1",
          name: "Ada",
          image: undefined,
          login: "ada",
        });
        const users: Array<string | undefined> = [];
        PgSession.onDidChange(() => users.push(PgSession.get()?.id));

        await PgSession.signInFor("share")(["gist"]);

        // Only the sign-in state moved (pending, then idle); the user did not
        expect(PgSession.get()?.id).toBe("u1");
        expect(users).toEqual(["u1", "u1"]);
      });

      it("only accepts a reply carrying this flow's nonce", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string) =>
            url === "/api/auth/sign-in/social"
              ? Promise.resolve({
                  ok: true,
                  json: async () => ({ url: "https://x/" }),
                })
              : Promise.resolve({
                  ok: true,
                  json: async () => ({ user: { id: "u1" } }),
                })
          ) as unknown as typeof fetch
        );

        let accept!: (data: unknown) => boolean;
        let nonce!: string;
        PgSession.setOpenChannel((opts) => {
          accept = opts.accept;
          return {
            receive: async () => ({ delivered: true as const, data: {} }),
            cancel: () => {},
          };
        });
        const originalFetch = global.fetch as Mock;
        await PgSession.signIn();
        nonce = JSON.parse(
          originalFetch.mock.calls[0][1].body
        ).callbackURL.split("nonce=")[1];

        expect(accept({ type: "pg-auth-complete", nonce })).toBe(true);
        expect(accept({ type: "pg-auth-complete", nonce: "forged" })).toBe(
          false
        );
        expect(accept({ type: "something-else", nonce })).toBe(false);
      });

      it("says the session could not be read when the popup finished but no user is signed in", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          async (input) =>
            ({
              ok: true,
              json: async () =>
                input === "/api/auth/get-session"
                  ? // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
                    null
                  : { url: "https://x/" },
            } as Response)
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));

        await expect(PgSession.signIn()).rejects.toThrow(
          "Sign-in did not finish."
        );
      });

      it("reports a blocked popup distinctly from a failed sign-in", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ url: "https://x/" }),
          }) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => undefined);

        await expect(PgSession.signIn()).rejects.toThrow(
          "Allow pop-ups for this site to sign in with GitHub."
        );
      });

      it("surfaces a cancelled popup as a cancellation", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ url: "https://x/" }),
          }) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({
            delivered: false as const,
            reason: "cancelled" as const,
          }),
          cancel: () => {},
        }));

        await expect(PgSession.signIn()).rejects.toThrow(/cancelled/i);
        expect(PgSession.get()).toBeUndefined();
      });

      it("says a popup that never answered did not finish", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ url: "https://x/" }),
          }) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({
            delivered: false as const,
            reason: "expired" as const,
          }),
          cancel: () => {},
        }));

        await expect(PgSession.signIn()).rejects.toThrow(
          "Sign-in did not finish."
        );
      });

      it("says sign-in isn't available when the start answers no authorize URL", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
          }) as unknown as typeof fetch
        );
        const open = vi.fn();
        PgSession.setOpenChannel(open as never);

        await expect(PgSession.signIn()).rejects.toThrow(
          "Sign-in isn't available. Your work is saved in this browser."
        );
        expect(PgSession.signInState()).toMatchObject({
          reason: "request-failed",
        });
        expect(open).not.toHaveBeenCalled();
      });

      it("never shows a raw error as the reason a sign-in failed", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
          new TypeError("Failed to fetch")
        );

        await expect(PgSession.signIn()).rejects.toThrow("Failed to fetch");
        expect(PgSession.signInState()).toEqual({
          status: "failed",
          reason: "request-failed",
          message:
            "Sign-in isn't available. Your work is saved in this browser.",
        });
      });

      it("throws rather than opening a popup when sign-in cannot start", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: "Authentication is not configured" }),
          }) as unknown as typeof fetch
        );
        const open = vi.fn();
        PgSession.setOpenChannel(open as never);

        await expect(PgSession.signIn()).rejects.toThrow(
          "Sign-in isn't available. Your work is saved in this browser."
        );
        expect(open).not.toHaveBeenCalled();
      });

      it("opens no popup and reads no session when cancelled while the authorize URL loads", async () => {
        let answer!: (response: unknown) => void;
        const request = vi.fn(
          (_input: unknown, init?: RequestInit) =>
            new Promise((resolve, reject) => {
              answer = resolve;
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError"))
              );
            })
        );
        vi.spyOn(globalThis, "fetch").mockImplementation(
          request as unknown as typeof fetch
        );
        const open = vi.fn();
        PgSession.setOpenChannel(open as never);

        const pending = PgSession.signIn();
        await vi.waitFor(() => expect(request).toHaveBeenCalled());
        PgSession.cancelSignIn();
        answer({ ok: true, json: async () => ({ url: "https://x/" }) });

        await expect(pending).rejects.toThrow(/cancelled/i);
        expect(open).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(1);
        expect(PgSession.get()).toBeUndefined();
        expect(PgSession.signInState()).toEqual({
          status: "failed",
          reason: "cancelled",
          message: "Sign-in cancelled.",
        });
      });

      it("opens no popup when cancelled while the authorize URL's body is read", async () => {
        let reading = false;
        const request = vi.fn(async (_input: unknown, init?: RequestInit) => ({
          ok: true,
          // The browser's body read rejects once the request's signal aborts
          json: () =>
            new Promise((_resolve, reject) => {
              reading = true;
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("aborted", "AbortError"))
              );
            }),
        }));
        vi.spyOn(globalThis, "fetch").mockImplementation(
          request as unknown as typeof fetch
        );
        const open = vi.fn();
        PgSession.setOpenChannel(open as never);

        const pending = PgSession.signIn();
        await vi.waitFor(() => expect(reading).toBe(true));
        PgSession.cancelSignIn();

        const error = await pending.catch((e: unknown) => e);
        expect(isSignInFailure(error)).toBe(true);
        expect(String(error)).toMatch(/cancelled/i);
        expect(open).not.toHaveBeenCalled();
      });

      it("opens no popup when the body resolves as the Cancel lands", async () => {
        let readBody!: (body: unknown) => void;
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: () => new Promise((resolve) => (readBody = resolve)),
          }) as unknown as typeof fetch
        );
        const open = vi.fn();
        PgSession.setOpenChannel(open as never);

        const pending = PgSession.signIn();
        await vi.waitFor(() => expect(readBody).toBeDefined());
        PgSession.cancelSignIn();
        readBody({ url: "https://x/" });

        await expect(pending).rejects.toThrow(/cancelled/i);
        expect(open).not.toHaveBeenCalled();
      });

      it("still reports a failed authorize-URL request as a failure, not a cancel", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(
          new TypeError("Failed to fetch")
        );

        const error = await PgSession.signIn().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(TypeError);
        expect(isSignInFailure(error)).toBe(false);
        expect(PgSession.signInState()).toEqual({
          status: "failed",
          reason: "request-failed",
          message:
            "Sign-in isn't available. Your work is saved in this browser.",
        });
      });

      it("ends the wait on an open popup through cancelSignIn", async () => {
        const popup = heldPopup();
        const pending = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        const channel = popup.open.mock.results[0].value as {
          cancel: () => void;
        };
        const cancel = vi
          .spyOn(channel, "cancel")
          .mockImplementation(() => popup.cancel());

        PgSession.cancelSignIn();
        await expect(pending).rejects.toThrow(/cancelled/i);
        expect(cancel).toHaveBeenCalledTimes(1);
      });

      it("leaves a later sign-in alone when Cancel is pressed with none outstanding", async () => {
        PgSession.cancelSignIn();
        expect(PgSession.signInState()).toEqual({ status: "idle" });

        const popup = heldPopup();
        const pending = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        expect(PgSession.signInState()).toEqual({ status: "pending" });
        popup.cancel();
        await expect(pending).rejects.toThrow(/cancelled/i);
      });

      it("lets a sign-in after a cancelled one open its popup", async () => {
        let answer!: (response: unknown) => void;
        vi.spyOn(globalThis, "fetch").mockImplementationOnce(
          (() =>
            new Promise<unknown>(
              (resolve) => (answer = resolve)
            )) as unknown as typeof fetch
        );
        const open = vi.fn();
        PgSession.setOpenChannel(open as never);
        const first = PgSession.signIn();
        await vi.waitFor(() => expect(answer).toBeDefined());
        PgSession.cancelSignIn();
        answer({ ok: true, json: async () => ({ url: "https://x/" }) });
        await expect(first).rejects.toThrow(/cancelled/i);

        const popup = heldPopup();
        const second = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        await expect(second).rejects.toThrow(/cancelled/i);
      });

      /** A popup that answers only when the test says, and how many were opened */
      const heldPopup = () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ url: "https://x/" }),
          }) as unknown as typeof fetch
        );
        let answer!: (receipt: {
          delivered: false;
          reason: "cancelled";
        }) => void;
        const open = vi.fn(() => ({
          receive: () =>
            new Promise<{ delivered: false; reason: "cancelled" }>(
              (resolve) => (answer = resolve)
            ),
          cancel: () => {},
        }));
        PgSession.setOpenChannel(open as never);
        return {
          open,
          cancel: () => answer({ delivered: false, reason: "cancelled" }),
        };
      };

      it("holds a pending sign-in and its failure, so they outlive whatever rendered them", async () => {
        const popup = heldPopup();
        const changed = vi.fn();
        PgSession.onDidChange(changed);
        expect(PgSession.signInState()).toEqual({ status: "idle" });

        const pending = PgSession.signIn();
        expect(PgSession.signInState()).toEqual({ status: "pending" });
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        await expect(pending).rejects.toThrow(/cancelled/i);

        expect(PgSession.signInState()).toEqual({
          status: "failed",
          reason: "cancelled",
          message: "Sign-in cancelled.",
        });
        expect(changed).toHaveBeenCalledTimes(2);
      });

      it("tells a sign-in that ended at a known step from any other error", async () => {
        const popup = heldPopup();
        const pending = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        const known = await pending.catch((error: unknown) => error);

        expect(isSignInFailure(known)).toBe(true);
        expect(isSignInFailure(new TypeError("fetch failed"))).toBe(false);
      });

      it("names the origin of a sign-in under way, and nothing while idle or once it settles", async () => {
        const popup = heldPopup();
        expect(PgSession.signingInFrom).toBeUndefined();

        const pending = PgSession.signInFor("assistant")([]);
        expect(PgSession.signingInFrom).toBe("assistant");
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        await expect(pending).rejects.toThrow(/cancelled/i);

        expect(PgSession.signingInFrom).toBeUndefined();
      });

      it("names no origin for a sign-in that was given none", async () => {
        const popup = heldPopup();

        const pending = PgSession.signIn();
        expect(PgSession.signingInFrom).toBeUndefined();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        await expect(pending).rejects.toThrow(/cancelled/i);
      });

      it("does not start a second sign-in while one is pending", async () => {
        const popup = heldPopup();

        const first = PgSession.signIn();
        const second = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        await expect(first).rejects.toThrow(/cancelled/i);
        await expect(second).rejects.toThrow(/cancelled/i);

        expect(popup.open).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      it("asks for scopes after a pending sign-in that lacked them, not inside it", async () => {
        const popup = heldPopup();
        const bodies: Array<Record<string, unknown>> = [];
        (global.fetch as Mock).mockImplementation(
          async (url: string, init?: RequestInit) => {
            if (url === "/api/auth/sign-in/social") {
              bodies.push(JSON.parse(init?.body as string));
            }
            return { ok: true, json: async () => ({ url: "https://x/" }) };
          }
        );

        const plain = PgSession.signIn();
        const scoped = PgSession.signInFor("share")(["gist"]);
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalledTimes(1));
        popup.cancel();
        await expect(plain).rejects.toThrow(/cancelled/i);
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalledTimes(2));
        popup.cancel();
        await expect(scoped).rejects.toThrow(/cancelled/i);

        expect(bodies.map((body) => body.scopes)).toEqual([
          undefined,
          ["gist"],
        ]);
      });

      it("takes the origin of a task that joins a sign-in started without one", async () => {
        const popup = heldPopup();

        const plain = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        expect(PgSession.signingInFrom).toBeUndefined();
        const joined = PgSession.signInFor("share")([]);

        // The share dialog waits on this sign-in too, so its listeners must
        // keep the project the dialog is sharing
        expect(PgSession.signingInFrom).toBe("share");
        popup.cancel();
        await expect(plain).rejects.toThrow(/cancelled/i);
        await expect(joined).rejects.toThrow(/cancelled/i);
        expect(popup.open).toHaveBeenCalledTimes(1);
        // The next sign-in starts from nowhere
        expect(PgSession.signingInFrom).toBeUndefined();
      });

      it("takes the origin of a task that waits for wider scopes too", async () => {
        const popup = heldPopup();

        const plain = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        const scoped = PgSession.signInFor("share")(["gist"]);

        expect(PgSession.signingInFrom).toBe("share");
        popup.cancel();
        await expect(plain).rejects.toThrow(/cancelled/i);
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalledTimes(2));
        popup.cancel();
        await expect(scoped).rejects.toThrow(/cancelled/i);
      });

      it("claims no sign-in that has already ended", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string) =>
            Promise.resolve({
              ok: true,
              json: async () =>
                url === "/api/auth/sign-in/social"
                  ? { url: "https://x/" }
                  : { user: { id: "u1" } },
            })
          ) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));
        // Idle fires after the flow ended, while its promise is yet to settle
        const dispose = PgSession.onDidChange(() => {
          if (PgSession.signInState().status === "idle") {
            PgSession.claimPendingSignIn("share");
          }
        });

        await PgSession.signIn();
        dispose.dispose();

        expect(PgSession.signingInFrom).toBeUndefined();
      });

      it("claims no sign-in when none is running", () => {
        PgSession.claimPendingSignIn("share");

        expect(PgSession.signingInFrom).toBeUndefined();
      });

      it("keeps the first task's origin when another task joins", async () => {
        const popup = heldPopup();

        const assistant = PgSession.signInFor("assistant")([]);
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        const share = PgSession.signInFor("share")([]);

        expect(PgSession.signingInFrom).toBe("assistant");
        popup.cancel();
        await expect(assistant).rejects.toThrow(/cancelled/i);
        await expect(share).rejects.toThrow(/cancelled/i);
      });

      it("clears a failed sign-in when the next one starts, and settles idle on success", async () => {
        const popup = heldPopup();
        const failed = PgSession.signIn();
        await vi.waitFor(() => expect(popup.open).toHaveBeenCalled());
        popup.cancel();
        await expect(failed).rejects.toThrow();

        // The sign-in reads the session once the popup is done, and fails
        // without a user there
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn((input: unknown) =>
            Promise.resolve({
              ok: true,
              json: async () =>
                input === "/api/auth/get-session"
                  ? { user: { id: "u1" } }
                  : { url: "https://x/" },
            })
          ) as unknown as typeof fetch
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));
        const next = PgSession.signIn();
        expect(PgSession.signInState()).toEqual({ status: "pending" });
        await next;

        expect(PgSession.signInState()).toEqual({ status: "idle" });
      });

      it("signs out and clears the user", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: "Ada", image: undefined })
        );
        await PgSession.refresh();
        expect(PgSession.get()).toBeDefined();

        await PgSession.signOut();

        expect(PgSession.get()).toBeUndefined();
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/sign-out",
          expect.objectContaining({ method: "POST" })
        );
      });

      const ada = { id: "u1", name: "Ada", image: undefined, login: undefined };

      const signOutAnswers = (answer: Partial<Response>) =>
        vi.spyOn(globalThis, "fetch").mockResolvedValue(answer as Response);

      const signOutOffline = () =>
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

      it("stays signed in when sign-out fails on the network", async () => {
        await PgSession.refreshWith(ada);
        signOutOffline();

        await expect(PgSession.signOut()).rejects.toThrow(
          /could not sign out/i
        );
        expect(PgSession.get()?.id).toBe("u1");
      });

      it("stays signed in, and says so, when the server refuses the sign-out", async () => {
        // The cookie is HttpOnly and survives a refused sign-out, so a reload
        // signed the user straight back in after the header had said otherwise
        await PgSession.refreshWith(ada);
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        signOutAnswers({ ok: false, status: 500 });

        await expect(PgSession.signOut()).rejects.toThrow(
          /could not sign out/i
        );
        expect(PgSession.get()?.id).toBe("u1");
        expect(logged.entries).toEqual([
          expect.objectContaining({
            ns: "auth:session",
            level: "error",
            report: true,
            context: { step: "request", status: 500 },
          }),
        ]);
      });

      it("runs the teardown only once the server has ended the session", async () => {
        await PgSession.refreshWith(ada);
        const order: string[] = [];
        PgSession.setOnSignOut(async () => {
          order.push("hand over");
          return async () => {
            // Still readable: what the teardown removes is keyed by the user id.
            // Ending, so nothing goes to the network on a cookie that is gone.
            order.push(
              `teardown as ${PgSession.get()?.id}, ending ${PgSession.isEnding}`
            );
          };
        });
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
          order.push("request");
          return { ok: true } as Response;
        });

        await PgSession.signOut();

        expect(order).toEqual([
          "hand over",
          "request",
          "teardown as u1, ending true",
        ]);
        expect(PgSession.get()).toBeUndefined();
        expect(PgSession.isEnding).toBe(false);
      });

      it.each([
        ["is refused", () => signOutAnswers({ ok: false, status: 500 })],
        ["fails on the network", signOutOffline],
      ])("skips the teardown when the request %s", async (_, arrange) => {
        // The user is still signed in, so their conversation and projects stay
        await PgSession.refreshWith(ada);
        const teardown = vi.fn().mockResolvedValue(undefined);
        PgSession.setOnSignOut(async () => teardown);
        arrange();

        await expect(PgSession.signOut()).rejects.toThrow();

        expect(teardown).not.toHaveBeenCalled();
        expect(PgSession.isEnding).toBe(false);
      });

      it("joins a sign-out already running rather than starting another", async () => {
        // Two teardowns at once deleted the same workspaces twice
        await PgSession.refreshWith(ada);
        const hook = vi.fn(async () => undefined);
        PgSession.setOnSignOut(hook);
        const request = signOutAnswers({ ok: true });

        await Promise.all([PgSession.signOut(), PgSession.signOut()]);

        expect(hook).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(1);
      });

      it("can sign out again after a failed attempt", async () => {
        await PgSession.refreshWith(ada);
        const teardown = vi.fn().mockResolvedValue(undefined);
        PgSession.setOnSignOut(async () => teardown);
        signOutAnswers({ ok: false, status: 500 });
        await expect(PgSession.signOut()).rejects.toThrow();

        signOutAnswers({ ok: true });
        await PgSession.signOut();

        expect(teardown).toHaveBeenCalledTimes(1);
        expect(PgSession.get()).toBeUndefined();
      });

      it("still signs out when the teardown fails, and reports it", async () => {
        await PgSession.refreshWith(ada);
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        const failure = new Error("quota");
        PgSession.setOnSignOut(async () => async () => {
          throw failure;
        });
        signOutAnswers({ ok: true });

        await PgSession.signOut();

        expect(PgSession.get()).toBeUndefined();
        expect(logged.entries).toEqual([
          expect.objectContaining({
            ns: "auth:session",
            level: "error",
            error: failure,
            report: true,
            context: { step: "teardown" },
          }),
        ]);
      });
    });
  });
}
