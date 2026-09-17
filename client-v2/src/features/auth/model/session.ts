import {
  AUTH_CHANNEL_NAME,
  AUTH_COMPLETE_ROUTE,
  AUTH_MESSAGE_TYPE,
  FLOW_MAX_AGE_SECONDS,
} from "../config.mjs";
import { openPopupChannel } from "../lib/popup-channel";
import type { PopupChannel } from "../lib/popup-channel";
import type { Disposable } from "../../../utils/types";

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
  name: string | null;
  /** Avatar URL, or `null` for an account without one */
  image: string | null;
  /** GitHub @handle, for display and the profile link. Never an identity key. */
  login: string | null;
}

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
  static get(): SessionUser | null {
    return PgSession._user;
  }

  /**
   * Re-read the session cookie.
   *
   * Never throws: a network failure means we cannot prove anyone is signed in,
   * which is the same state as signed out, and the panel must keep working
   * either way.
   */
  static async refresh() {
    let next: SessionUser | null = null;

    try {
      const response = await fetch("/api/auth/get-session", {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const body = await response.json();
        next = body?.user
          ? {
              id: String(body.user.id),
              name: body.user.name ?? null,
              image: body.user.image ?? null,
              login: body.user.login ?? null,
            }
          : null;
      }
    } catch {
      next = null;
    }

    PgSession._set(next);
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
   * side re-reads the session.
   */
  static async signIn() {
    const nonce = randomNonce();

    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: `${AUTH_COMPLETE_ROUTE}?nonce=${nonce}`,
      }),
    });
    if (!response.ok) throw new Error("Could not start sign-in");

    const { url } = await response.json();
    if (!url) throw new Error("Sign-in returned no authorize URL");

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
    if (!channel) throw new Error("Allow popups for this site to sign in.");

    const receipt = await channel.receive();
    if (!receipt.delivered) {
      throw new Error(
        receipt.reason === "cancelled"
          ? "Sign-in cancelled."
          : "Sign-in did not complete."
      );
    }

    await PgSession.refresh();
  }

  /** Stop waiting on the popup. Inert unless a sign-in is outstanding. */
  static cancelSignIn() {
    PgSession._channel?.cancel();
  }

  /**
   * End the session.
   *
   * Clears locally even when the request fails: the user asked to be signed
   * out, and leaving the UI claiming otherwise is worse than a cookie that
   * outlives it and expires on its own.
   */
  static async signOut() {
    // Before the cookie goes, so anything holding unsynced local state gets a
    // last chance at the network while the request is still authenticated.
    // Never allowed to block the sign-out itself.
    try {
      await PgSession._onSignOut?.();
    } catch {}

    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
    } catch {}

    PgSession._set(null);
  }

  /**
   * Register what must happen before a sign-out completes.
   *
   * Inversion on purpose: the persistence slice needs to flush threads here,
   * but it already imports this module, and importing it back would make the
   * two slices circular. The session effect wires them together instead, so
   * `features/auth` stays unaware that persistence exists.
   */
  static setOnSignOut(hook: (() => Promise<void>) | null) {
    PgSession._onSignOut = hook;
  }

  static onDidChange(cb: () => void): Disposable {
    PgSession._listeners.add(cb);
    return { dispose: () => PgSession._listeners.delete(cb) };
  }

  /** Test seam: set the user without a network round trip */
  static async refreshWith(user: SessionUser | null) {
    PgSession._set(user);
  }

  /** Test seam: open a stub channel instead of a real popup */
  static setOpenChannel(open: typeof openPopupChannel) {
    PgSession._openChannelImpl = open;
  }

  /** Test seam: drop all state without touching the network */
  static reset() {
    PgSession._user = null;
    PgSession._onSignOut = null;
    PgSession._listeners.clear();
    PgSession._channel = undefined;
    PgSession._openChannelImpl = openPopupChannel;
  }

  private static _user: SessionUser | null = null;
  private static _onSignOut: (() => Promise<void>) | null = null;
  private static readonly _listeners = new Set<() => void>();

  private static _channel: PopupChannel | undefined;
  private static _openChannelImpl: typeof openPopupChannel = openPopupChannel;

  /** Opens and remembers the channel, so `cancelSignIn` has something to stop */
  private static _openChannel(
    ...args: Parameters<typeof openPopupChannel>
  ): PopupChannel | undefined {
    PgSession._channel = PgSession._openChannelImpl(...args);
    return PgSession._channel;
  }

  private static _set(user: SessionUser | null) {
    const unchanged =
      PgSession._user?.id === user?.id &&
      PgSession._user?.name === user?.name &&
      PgSession._user?.image === user?.image &&
      PgSession._user?.login === user?.login;
    if (unchanged) return;

    PgSession._user = user;
    for (const cb of PgSession._listeners) cb();
  }
}
