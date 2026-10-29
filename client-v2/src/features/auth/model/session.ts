import {
  AUTH_CHANNEL_NAME,
  AUTH_COMPLETE_ROUTE,
  AUTH_MESSAGE_TYPE,
  FLOW_MAX_AGE_SECONDS,
  SIGN_OUT_TIMEOUT_MS,
} from "../config.mjs";
import { openPopupChannel } from "../lib/popup-channel";
import type { PopupChannel } from "../lib/popup-channel";
import { authTelemetry } from "./telemetry";
import type { SignInFailure } from "./telemetry";
import { createLogger } from "@/shared/lib/logger";
import { timeoutSignal } from "@/shared/lib/timeout-signal";
import type { Disposable } from "../../../utils/types";

/** A sign-in that ended at a known step; any other error counts as `request-failed` */
class SignInFailed extends Error {
  constructor(readonly reason: SignInFailure, message: string) {
    super(message);
  }
}

const reasonOf = (error: unknown): SignInFailure =>
  error instanceof SignInFailed ? error.reason : "request-failed";

/**
 * Whether a rejected `PgSession.signIn` ended at a known step (cancelled,
 * blocked, refused); anything else is an error the team should hear of
 */
export const isSignInFailure = (error: unknown) =>
  error instanceof SignInFailed;

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
  name: string | null;
  /** Avatar URL, or `null` for an account without one */
  image: string | null;
  /** GitHub @handle, for display and the profile link. Never an identity key. */
  login: string | null;
}

/** Where a sign-in started, when its listeners must tell it apart from the account footer's */
export type SignInOrigin = "assistant";

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
   * Never throws: a failed read leaves the user signed out, since nobody can be
   * proved signed in, and is logged (reported when it threw or answered 5xx).
   */
  static refresh(): Promise<void> {
    const read = PgSession._read().finally(() => {
      if (PgSession._reading === read) PgSession._reading = undefined;
    });
    PgSession._reading = read;
    return read;
  }

  /**
   * Settles once the session has been read: at once after any read, on the
   * read in flight if there is one, or on a first read started here. It never
   * reads again, so a caller deciding on `get()` waits for the page's own read
   * without turning a later sign-in elsewhere into a change seen here, which
   * the session effect would take for a sign-in of its own.
   */
  static whenRead(): Promise<void> {
    if (PgSession._hasRead) return Promise.resolve();
    return PgSession._reading ?? PgSession.refresh();
  }

  /**
   * Settles once the session has been read, without ever reading it.
   *
   * For a view that only decides what to draw and may mount before the
   * session effect. `whenRead` would start the page's first read there, and
   * the effect, finding the user already signed in, would never adopt the
   * account -- which leaves every push held, and sign-out waiting on them.
   */
  static afterRead(): Promise<void> {
    if (PgSession._hasRead) return Promise.resolve();
    return new Promise((resolve) => PgSession._readWaiters.push(resolve));
  }

  /** A read has answered: `get()` is now what the server said */
  private static _markRead() {
    PgSession._hasRead = true;
    const waiters = PgSession._readWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private static async _read() {
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
      } else if (response.status >= 500) {
        log.error(new Error(`session read answered ${response.status}`), {
          report: true,
          context: { status: response.status },
        });
      } else {
        log.warn(`session read answered ${response.status}`, {
          context: { status: response.status },
        });
      }
    } catch (error) {
      log.error(error, { report: true, context: { step: "refresh" } });
    }

    PgSession._markRead();
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
   * side re-reads the session. Rejects when that read finds nobody signed in.
   */
  static signIn({ from }: { from?: SignInOrigin } = {}): Promise<void> {
    // One popup and one nonce at a time: a second click while the first flow
    // waits joins it instead of racing it for the session cookie, and keeps
    // the first one's origin
    PgSession._pending ??= PgSession._signIn(from).finally(() => {
      PgSession._pending = undefined;
    });
    return PgSession._pending;
  }

  /** Where the last sign-in stands; `onDidChange` fires when it moves */
  static signInState(): SignInState {
    return PgSession._signInState;
  }

  private static async _signIn(from: SignInOrigin | undefined) {
    authTelemetry.track("auth_sign_in_started", {});
    PgSession._signingInFrom = from ?? null;
    PgSession._setSignIn({ status: "pending" });
    try {
      await PgSession._signInThroughPopup();
    } catch (error) {
      authTelemetry.track("auth_sign_in_failed", { reason: reasonOf(error) });
      PgSession._setSignIn({
        status: "failed",
        reason: reasonOf(error),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      PgSession._signingInFrom = null;
    }
    PgSession._setSignIn(IDLE);
    authTelemetry.track("auth_signed_in", {});
  }

  /**
   * The origin passed to the `signIn` in progress, or `null` when none runs or it named none.
   * Still set when `onDidChange` fires for that sign-in; cleared once it settles.
   */
  static get signingInFrom(): SignInOrigin | null {
    return PgSession._signingInFrom;
  }

  private static async _signInThroughPopup() {
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
    if (!response.ok) {
      throw new SignInFailed("request-failed", "Could not start sign-in");
    }

    const { url } = await response.json();
    if (!url) {
      throw new SignInFailed(
        "request-failed",
        "Sign-in returned no authorize URL"
      );
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
        "Allow popups for this site to sign in."
      );
    }

    const receipt = await channel.receive();
    if (!receipt.delivered) {
      throw new SignInFailed(
        receipt.reason,
        receipt.reason === "cancelled"
          ? "Sign-in cancelled."
          : "Sign-in did not complete."
      );
    }

    await PgSession.refresh();
    // `refresh` never throws, so a failed read would otherwise pass for a sign-in
    if (!PgSession.get()) {
      throw new SignInFailed(
        "request-failed",
        "Signed in with GitHub, but the session could not be read. Try again."
      );
    }
  }

  /** Stop waiting on the popup. Inert unless a sign-in is outstanding. */
  static cancelSignIn() {
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

    PgSession._ending = true;
    try {
      // While the user is still readable: what it removes is keyed by their id
      try {
        await teardown?.();
      } catch (error) {
        // The previous account's data may be left on this browser
        log.error(error, { report: true, context: { step: "teardown" } });
      }
      PgSession._set(null);
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
  static setOnSignOut(hook: SignOutHook | null) {
    PgSession._onSignOut = hook;
  }

  static onDidChange(cb: () => void): Disposable {
    PgSession._listeners.add(cb);
    return { dispose: () => PgSession._listeners.delete(cb) };
  }

  /** Test seam: set the user without a network round trip */
  static async refreshWith(user: SessionUser | null) {
    PgSession._markRead();
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
    PgSession._signingInFrom = null;
    PgSession._signingOut = undefined;
    PgSession._ending = false;
    PgSession._pending = undefined;
    PgSession._signInState = IDLE;
    PgSession._hasRead = false;
    PgSession._reading = undefined;
    PgSession._readWaiters.length = 0;
  }

  private static _signingOut: Promise<void> | undefined;
  private static _ending = false;
  private static _user: SessionUser | null = null;
  private static _signingInFrom: SignInOrigin | null = null;
  private static _onSignOut: SignOutHook | null = null;
  private static readonly _listeners = new Set<() => void>();

  private static _pending: Promise<void> | undefined;
  /** A session read has answered, so `get()` is what the server said */
  private static _hasRead = false;
  private static _reading: Promise<void> | undefined;
  /** `afterRead` callers waiting for the first read */
  private static readonly _readWaiters: (() => void)[] = [];
  private static _signInState: SignInState = IDLE;

  private static _channel: PopupChannel | undefined;
  private static _openChannelImpl: typeof openPopupChannel = openPopupChannel;

  /** Opens and remembers the channel, so `cancelSignIn` has something to stop */
  private static _openChannel(
    ...args: Parameters<typeof openPopupChannel>
  ): PopupChannel | undefined {
    PgSession._channel = PgSession._openChannelImpl(...args);
    return PgSession._channel;
  }

  private static _setSignIn(state: SignInState) {
    PgSession._signInState = state;
    for (const cb of PgSession._listeners) cb();
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
      name: string | null;
      image?: string | null;
      login?: string | null;
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

        answer({ id: "u1", name: null, image: null });
        await Promise.all([read, waited]);

        expect(PgSession.get()?.id).toBe("u1");
        expect(request).toHaveBeenCalledTimes(1);
      });

      it("reads once when nothing has read the session yet", async () => {
        const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ user: null }),
        } as Response);

        await PgSession.whenRead();
        await PgSession.whenRead();

        expect(request).toHaveBeenCalledTimes(1);
      });

      it("waits for the page's read without starting one", async () => {
        const request = vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ user: null }),
        } as Response);
        let settled = false;
        const waited = PgSession.afterRead().then(() => (settled = true));
        await Promise.resolve();
        expect(request).not.toHaveBeenCalled();
        expect(settled).toBe(false);

        // A signed-out answer changes nothing, so no listener hears it
        await PgSession.refresh();
        await waited;

        expect(request).toHaveBeenCalledTimes(1);
      });

      it("settles at once after a read", async () => {
        await PgSession.refreshWith(null);
        let settled = false;
        await PgSession.afterRead().then(() => (settled = true));
        expect(settled).toBe(true);
      });

      it("is signed out before any refresh", () => {
        expect(PgSession.get()).toBeNull();
      });

      it("reads the user from the session endpoint", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: "Ada", image: null })
        );

        await PgSession.refresh();

        expect(PgSession.get()).toEqual({
          id: "u1",
          name: "Ada",
          image: null,
          login: null,
        });
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/get-session",
          expect.objectContaining({ credentials: "include" })
        );
      });

      it("treats an empty session body as signed out", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockResolvedValue({
            ok: true,
            json: async () => null,
          }) as unknown as typeof fetch
        );

        await PgSession.refresh();

        expect(PgSession.get()).toBeNull();
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

          expect(PgSession.get()).toBeNull();
          expect(logged.entries).toEqual([
            expect.objectContaining({ ns: "auth:session", level, report }),
          ]);
        }
      );

      it("notifies subscribers when the user changes", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: null, image: null })
        );
        const seen: unknown[] = [];
        const sub = PgSession.onDidChange(() => seen.push(PgSession.get()));

        await PgSession.refresh();
        sub.dispose();

        expect(seen).toEqual([
          { id: "u1", name: null, image: null, login: null },
        ]);
      });

      it("does not notify when the user is unchanged", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          signedIn({ id: "u1", name: "Ada", image: null })
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
                    user: { id: "u1", name: "Ada", image: null, login: "ada" },
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
          image: null,
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

      it("only accepts a reply carrying this flow's nonce", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(
          vi.fn().mockImplementation((url: string, init: RequestInit) =>
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
                  ? null
                  : { url: "https://x/" },
            } as Response)
        );
        PgSession.setOpenChannel(() => ({
          receive: async () => ({ delivered: true as const, data: {} }),
          cancel: () => {},
        }));

        await expect(PgSession.signIn()).rejects.toThrow(
          "Signed in with GitHub, but the session could not be read. Try again."
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

        await expect(PgSession.signIn()).rejects.toThrow(/allow popups/i);
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
        expect(PgSession.get()).toBeNull();
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

        await expect(PgSession.signIn()).rejects.toThrow(/sign-in/i);
        expect(open).not.toHaveBeenCalled();
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
          signedIn({ id: "u1", name: "Ada", image: null })
        );
        await PgSession.refresh();
        expect(PgSession.get()).not.toBeNull();

        await PgSession.signOut();

        expect(PgSession.get()).toBeNull();
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/auth/sign-out",
          expect.objectContaining({ method: "POST" })
        );
      });

      const ada = { id: "u1", name: "Ada", image: null, login: null };

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
        expect(PgSession.get()).toBeNull();
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
        expect(PgSession.get()).toBeNull();
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

        expect(PgSession.get()).toBeNull();
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
