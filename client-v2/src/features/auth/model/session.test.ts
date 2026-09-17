import { PgSession } from "./session";

const signedIn = (user: {
  id: string;
  name: string | null;
  image?: string | null;
  login?: string | null;
}) =>
  jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ user }),
  }) as unknown as typeof fetch;

describe("PgSession", () => {
  afterEach(() => {
    (global.fetch as jest.Mock | undefined)?.mockReset?.();
    PgSession.reset();
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    }) as unknown as typeof fetch;

    await PgSession.refresh();

    expect(PgSession.get()).toBeNull();
  });

  it("treats a failed request as signed out rather than throwing", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    await PgSession.refresh();

    expect(PgSession.get()).toBeNull();
  });

  it("notifies subscribers when the user changes", async () => {
    global.fetch = signedIn({ id: "u1", name: null, image: null });
    const seen: unknown[] = [];
    const sub = PgSession.onDidChange(() => seen.push(PgSession.get()));

    await PgSession.refresh();
    sub.dispose();

    expect(seen).toEqual([{ id: "u1", name: null, image: null, login: null }]);
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
    global.fetch = jest.fn().mockImplementation((url: string) =>
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
    global.fetch = jest
      .fn()
      .mockImplementation((url: string, init: RequestInit) => {
        if (url === "/api/auth/sign-in/social") {
          body = init.body as string;
          return Promise.resolve({
            ok: true,
            json: async () => ({ url: "https://x/" }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => null });
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
    global.fetch = jest
      .fn()
      .mockImplementation((url: string, init: RequestInit) =>
        url === "/api/auth/sign-in/social"
          ? Promise.resolve({
              ok: true,
              json: async () => ({ url: "https://x/" }),
            })
          : Promise.resolve({ ok: true, json: async () => null })
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
    const originalFetch = global.fetch as jest.Mock;
    await PgSession.signIn();
    nonce = JSON.parse(originalFetch.mock.calls[0][1].body).callbackURL.split(
      "nonce="
    )[1];

    expect(accept({ type: "pg-auth-complete", nonce })).toBe(true);
    expect(accept({ type: "pg-auth-complete", nonce: "forged" })).toBe(false);
    expect(accept({ type: "something-else", nonce })).toBe(false);
  });

  it("reports a blocked popup distinctly from a failed sign-in", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "https://x/" }),
    }) as unknown as typeof fetch;
    PgSession.setOpenChannel(() => undefined);

    await expect(PgSession.signIn()).rejects.toThrow(/allow popups/i);
  });

  it("surfaces a cancelled popup as a cancellation", async () => {
    global.fetch = jest.fn().mockResolvedValue({
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Authentication is not configured" }),
    }) as unknown as typeof fetch;
    const open = jest.fn();
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

    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await PgSession.signOut();

    expect(PgSession.get()).toBeNull();
  });
});
