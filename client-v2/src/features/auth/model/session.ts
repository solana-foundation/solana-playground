import {
  AUTH_CHANNEL_NAME,
  AUTH_COMPLETE_ROUTE,
  AUTH_MESSAGE_TYPE,
  FLOW_MAX_AGE_SECONDS,
} from "../config.mjs";
import { openPopupChannel } from "../lib/popup-channel";
import type { PopupChannel } from "../lib/popup-channel";
import { authTelemetry } from "./telemetry";
import type { SignInFailure } from "./telemetry";
import { createLogger } from "../../../shared/lib/logger";
import type { Disposable } from "../../../utils/types";

/** A sign-in that ended at a known step; any other error counts as `request-failed` */
class SignInFailed extends Error {
  constructor(readonly reason: SignInFailure, message: string) {
    super(message);
  }
}

const reasonOf = (error: unknown): SignInFailure =>
  error instanceof SignInFailed ? error.reason : "request-failed";

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

/** Where a sign-in started, when its listeners must tell it apart from the header's */
export type SignInOrigin = "assistant";

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
  static async signIn({ from }: { from?: SignInOrigin } = {}) {
    authTelemetry.track("auth_sign_in_started", {});
    PgSession._signingInFrom = from ?? null;
    try {
      await PgSession._signInThroughPopup();
    } catch (error) {
      authTelemetry.track("auth_sign_in_failed", { reason: reasonOf(error) });
      throw error;
    } finally {
      PgSession._signingInFrom = null;
    }
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
    } catch (error) {
      // Unsynced local work may be lost: the team needs to hear of it
      log.error(error, { report: true, context: { step: "flush" } });
    }

    try {
      const res = await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
      // The server session survives a refused sign-out, and a reload signs
      // the user back in; say so rather than only on a network error
      if (!res.ok) {
        log.error(
          new Error(
            `sign-out request answered ${res.status}; the server session may survive`
          ),
          { report: true, context: { step: "request", status: res.status } }
        );
      }
    } catch (error) {
      // The cookie expires on its own; the local sign-out still stands
      log.warn("sign-out request failed; the cookie expires on its own", {
        context: { error: String(error) },
      });
    }

    PgSession._set(null);
    authTelemetry.track("auth_signed_out", {});
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
    PgSession._signingInFrom = null;
  }

  private static _user: SessionUser | null = null;
  private static _signingInFrom: SignInOrigin | null = null;
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

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, afterEach } = import.meta.vitest;
  type Mock = import("vitest").Mock;
  let initLogger: typeof import("../../../shared/lib/logger").initLogger;
  let memoryProvider: typeof import("../../../shared/lib/logger").memoryProvider;
  let resetLogger: typeof import("../../../shared/lib/logger").resetLogger;
  beforeAll(async () => {
    ({ initLogger, memoryProvider, resetLogger } = await import(
      "../../../shared/lib/logger"
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

    it("is signed out before any refresh", () => {
      expect(PgSession.get()).toBeNull();
    });

    it("reads the user from the session endpoint", async () => {
      global.fetch = signedIn({ id: "u1", name: "Ada", image: null });

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
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => null,
      }) as unknown as typeof fetch;

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
          request.mockResolvedValue({ ok: false, status: answer } as Response);
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
      global.fetch = signedIn({ id: "u1", name: null, image: null });
      const seen: unknown[] = [];
      const sub = PgSession.onDidChange(() => seen.push(PgSession.get()));

      await PgSession.refresh();
      sub.dispose();

      expect(seen).toEqual([
        { id: "u1", name: null, image: null, login: null },
      ]);
    });

    it("does not notify when the user is unchanged", async () => {
      global.fetch = signedIn({ id: "u1", name: "Ada", image: null });
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
      global.fetch = vi.fn().mockImplementation((url: string) =>
        url === "/api/auth/sign-in/social"
          ? Promise.resolve({
              ok: true,
              json: async () => ({ url: "https://github.com/login/oauth/x" }),
            })
          : Promise.resolve({
              ok: true,
              json: async () => ({
                user: { id: "u1", name: "Ada", image: null, login: "ada" },
              }),
            })
      ) as unknown as typeof fetch;

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
      global.fetch = vi
        .fn()
        .mockImplementation((url: string, init: RequestInit) => {
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
        }) as unknown as typeof fetch;
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
      global.fetch = vi
        .fn()
        .mockImplementation((url: string, init: RequestInit) =>
          url === "/api/auth/sign-in/social"
            ? Promise.resolve({
                ok: true,
                json: async () => ({ url: "https://x/" }),
              })
            : Promise.resolve({
                ok: true,
                json: async () => ({ user: { id: "u1" } }),
              })
        ) as unknown as typeof fetch;

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
      nonce = JSON.parse(originalFetch.mock.calls[0][1].body).callbackURL.split(
        "nonce="
      )[1];

      expect(accept({ type: "pg-auth-complete", nonce })).toBe(true);
      expect(accept({ type: "pg-auth-complete", nonce: "forged" })).toBe(false);
      expect(accept({ type: "something-else", nonce })).toBe(false);
    });

    it("says the session could not be read when the popup finished but no user is signed in", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) =>
          ({
            ok: true,
            json: async () =>
              input === "/api/auth/get-session" ? null : { url: "https://x/" },
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
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://x/" }),
      }) as unknown as typeof fetch;
      PgSession.setOpenChannel(() => undefined);

      await expect(PgSession.signIn()).rejects.toThrow(/allow popups/i);
    });

    it("surfaces a cancelled popup as a cancellation", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: "https://x/" }),
      }) as unknown as typeof fetch;
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
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Authentication is not configured" }),
      }) as unknown as typeof fetch;
      const open = vi.fn();
      PgSession.setOpenChannel(open as never);

      await expect(PgSession.signIn()).rejects.toThrow(/sign-in/i);
      expect(open).not.toHaveBeenCalled();
    });

    it("signs out and clears the user", async () => {
      global.fetch = signedIn({ id: "u1", name: "Ada", image: null });
      await PgSession.refresh();
      expect(PgSession.get()).not.toBeNull();

      await PgSession.signOut();

      expect(PgSession.get()).toBeNull();
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/sign-out",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("clears the user even when sign-out fails on the network", async () => {
      global.fetch = signedIn({ id: "u1", name: "Ada", image: null });
      await PgSession.refresh();

      global.fetch = vi
        .fn()
        .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
      await PgSession.signOut();

      expect(PgSession.get()).toBeNull();
    });

    it("says so when the server refuses the sign-out", async () => {
      global.fetch = signedIn({ id: "u1", name: "Ada", image: null });
      await PgSession.refresh();
      const logged = memoryProvider();
      initLogger({ providers: [logged] });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch;
      await PgSession.signOut();

      expect(PgSession.get()).toBeNull();
      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "auth:session",
          level: "error",
          report: true,
          context: { step: "request", status: 500 },
        }),
      ]);
    });
  });
}
