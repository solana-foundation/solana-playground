import { keyOriginFor } from "./origin";
import {
  type DistributiveOmit,
  isKeyReady,
  isKeyReply,
  KEY_PROTOCOL_VERSION,
  type KeyHandshake,
  type KeyReply,
  type KeyRequest,
  type ThemeTokens,
} from "./protocol";

/** Where the key page is served, under the key origin */
const KEY_PAGE_PATH = "/wallet-keys.html";

/** How long the key page has to load and announce itself */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/** How long a request may wait for its reply before the key page counts as gone */
const REQUEST_TIMEOUT_MS = 30_000;

const CLOSED = "The wallet's key page was closed.";

/** The key page could not be reached: it never answered, or speaks another protocol */
export class KeyFrameUnavailable extends Error {
  constructor(readonly reason: "timeout" | "version") {
    super(
      reason === "timeout"
        ? "The wallet's key page did not answer. Check the network and try again."
        : "The wallet's key page speaks a different version. Reload the page and try again."
    );
    this.name = "KeyFrameUnavailable";
  }
}

/** The page's end of its channel to the key page */
export interface KeyFrame {
  /** Asks the key page for something; rejects with its `error` text */
  request<T>(body: DistributiveOmit<KeyRequest, "id">): Promise<T>;
  /** Drops the connection and removes the frame; pending requests reject */
  close(): void;
}

type Pending = {
  resolve: (reply: KeyReply) => void;
  reject: (error: Error) => void;
};

const hiddenFrame = (doc: Document, src: string) => {
  const frame = doc.createElement("iframe");
  frame.src = src;
  frame.width = "0";
  frame.height = "0";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:absolute;border:0;left:-9999px";
  return frame;
};

/** What a frame does past the handshake */
type FrameOptions = {
  /** How long a request may wait for its reply; 30 s when not given */
  requestTimeoutMs?: number;
  /** Told when a request times out: the key page may be gone */
  onDead?: () => void;
};

const frameOverWith =
  ({ requestTimeoutMs, onDead }: FrameOptions) =>
  (port: MessagePort, frame: HTMLIFrameElement): KeyFrame => {
    let nextId = 1;
    let isClosed = false;
    const pending = new Map<number, Pending>();
    const rejectAll = (error: Error) => {
      for (const { reject } of pending.values()) reject(error);
      pending.clear();
    };
    port.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isKeyReply(data)) return;
      const waiting = pending.get(data.id);
      if (!waiting) return;
      pending.delete(data.id);
      waiting.resolve(data);
    };
    // A reply that could not be deserialized names no request, so every
    // waiting one fails rather than waits for its time limit
    port.addEventListener("messageerror", () =>
      rejectAll(
        new Error("The wallet's key page sent a reply that could not be read.")
      )
    );
    return {
      request: <T>(body: DistributiveOmit<KeyRequest, "id">) =>
        new Promise<T>((resolve, reject) => {
          if (isClosed) {
            reject(new Error(CLOSED));
            return;
          }
          const id = nextId++;
          const timer = setTimeout(() => {
            if (!pending.delete(id)) return;
            reject(new KeyFrameUnavailable("timeout"));
            onDead?.();
          }, requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
          pending.set(id, {
            resolve: (reply) => {
              clearTimeout(timer);
              if (reply.ok) resolve(reply.result as T);
              else reject(new Error(reply.error));
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          });
          port.postMessage({ ...body, id });
        }),
      close: () => {
        if (isClosed) return;
        isClosed = true;
        port.close();
        frame.remove();
        rejectAll(new Error(CLOSED));
      },
    };
  };

/**
 * Waits for the key page in `frame` to announce itself and hands it one port
 * of a new `MessageChannel`. Only a ready message from that frame's own
 * window, at `origin`, counts. Listens from the call on, so call it before the
 * frame starts loading.
 *
 * @param wait.origin the key origin
 * @param wait.host the window the frame is in
 * @param wait.timeoutMs how long the key page has to announce itself
 * @param wait.signal stops the wait: a frame pointed elsewhere must not take a
 * later load's ready for its own
 * @returns for the frame, the page's end of the channel
 * @throws {KeyFrameUnavailable} when the key page does not announce itself in
 * time, or speaks another protocol version; the signal's reason once aborted
 */
const handshakeWith =
  ({
    origin,
    host,
    timeoutMs,
    signal,
  }: {
    origin: string;
    host: Window;
    timeoutMs: number;
    signal: AbortSignal;
  }) =>
  (frame: HTMLIFrameElement): Promise<MessagePort> =>
    new Promise<MessagePort>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        host.removeEventListener("message", handleMessage);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        stop();
        reject(signal.reason);
      };
      const fail = (reason: "timeout" | "version") => {
        stop();
        reject(new KeyFrameUnavailable(reason));
      };
      const handleMessage = (event: MessageEvent) => {
        const target = frame.contentWindow;
        if (
          !target ||
          event.source !== target ||
          event.origin !== origin ||
          !isKeyReady(event.data)
        ) {
          return;
        }
        if (event.data.version !== KEY_PROTOCOL_VERSION) {
          fail("version");
          return;
        }
        stop();
        const channel = new MessageChannel();
        const handshake: KeyHandshake = {
          type: "pg-wallet-keys:connect",
          version: KEY_PROTOCOL_VERSION,
        };
        target.postMessage(handshake, origin, [channel.port2]);
        resolve(channel.port1);
      };
      const timer = setTimeout(() => fail("timeout"), timeoutMs);
      host.addEventListener("message", handleMessage);
      signal.addEventListener("abort", abort);
    });

/**
 * Opens the hidden key page on `origin` and a private channel to it
 * (`handshakeWith`); everything after the handshake goes over that port.
 *
 * @param origin the key origin
 * @param opts the handshake's time limit, the document to put the frame in,
 * and what the connection does past the handshake
 * @returns the connection
 */
export const connectKeyFrame = (
  origin: string,
  opts: { timeoutMs?: number; doc?: Document } & FrameOptions = {}
): Promise<KeyFrame> => {
  const {
    timeoutMs = HANDSHAKE_TIMEOUT_MS,
    doc = document,
    ...frameOptions
  } = opts;
  const host = doc.defaultView ?? window;
  const frame = hiddenFrame(doc, origin + KEY_PAGE_PATH);
  // Never stopped: a failed handshake removes the frame instead
  const connected = handshakeWith({
    origin,
    host,
    timeoutMs,
    signal: new AbortController().signal,
  })(frame);
  doc.body.append(frame);
  return connected.then(
    (port) => frameOverWith(frameOptions)(port, frame),
    (error: unknown) => {
      frame.remove();
      throw error;
    }
  );
};

/** The visible panel a dialog shows: import a key file, or save one */
export type KeyPanelRoute =
  | { mode: "import" }
  | { mode: "export"; publicKey: string; name: string };

/**
 * @param value what to encode
 * @returns base64url of its JSON, as the key page's `decodeTheme` reads it
 */
const base64UrlJson = (value: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/**
 * @param origin the key origin
 * @returns for the panel to show and the tokens it is drawn with, the URL of
 * the key page showing that panel
 */
export const keyPanelUrl =
  (origin: string) => (route: KeyPanelRoute, theme: ThemeTokens) => {
    const query = new URLSearchParams();
    if (route.mode === "export") query.set("name", route.name);
    query.set("theme", base64UrlJson(theme));
    const path =
      route.mode === "import"
        ? "panel/import"
        : `panel/export/${route.publicKey}`;
    return `${origin}${KEY_PAGE_PATH}#${path}?${query}`;
  };

/**
 * Connects to the key page's visible panel in `frame`, a frame the caller
 * renders and owns: it is never removed here. The handshake is the hidden
 * frame's (`handshakeWith`); the port then carries `PanelMessage`s.
 *
 * @param origin the key origin
 * @param timeoutMs how long the panel has to answer (`HANDSHAKE_TIMEOUT_MS`)
 * @returns for the frame and a signal that stops the wait (the frame is about
 * to be pointed elsewhere), a function that points it at `src` and resolves
 * with the panel's port once the panel answers
 * @throws {KeyFrameUnavailable} when the panel does not answer in time
 */
export const connectKeyPanel =
  (origin: string, timeoutMs: number) =>
  (frame: HTMLIFrameElement, signal: AbortSignal) =>
  (src: string): Promise<MessagePort> => {
    const host = frame.ownerDocument.defaultView ?? window;
    const connected = handshakeWith({ origin, host, timeoutMs, signal })(frame);
    frame.src = src;
    return connected;
  };

/**
 * @param requestTimeoutMs how long a request may wait for its reply
 * @returns a function giving one connection to the key page, made on first
 * use; a failed attempt is not kept, and neither is a connection whose request
 * timed out, so the next call reconnects
 */
export const keyFrameWith = (requestTimeoutMs: number) => {
  let connection: Promise<KeyFrame> | undefined;
  return (): Promise<KeyFrame> => {
    if (connection) return connection;
    const origin = keyOriginFor(
      process.env.REACT_APP_WALLET_KEY_ORIGIN,
      window.location
    );
    if (!origin) {
      return Promise.reject(
        new Error("No key origin is configured for the wallet.")
      );
    }
    const drop = () => {
      if (connection === attempt) connection = undefined;
    };
    const attempt: Promise<KeyFrame> = connectKeyFrame(origin, {
      requestTimeoutMs,
      onDead: () => {
        drop();
        void attempt.then((frame) => frame.close());
      },
    }).then((frame) => ({
      request: frame.request,
      close: () => {
        drop();
        frame.close();
      },
    }));
    connection = attempt;
    attempt.catch(drop);
    return attempt;
  };
};

/** The page's one connection to the key page (`keyFrameWith`) */
export const keyFrame = keyFrameWith(REQUEST_TIMEOUT_MS);

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("utils/wallet/key-origin/client", () => {
    const ORIGIN = "http://127.0.0.1:3006";

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      document.body.innerHTML = "";
    });

    /** Starts a connection and returns the frame it appended */
    const start = (timeoutMs?: number) => {
      const connected = connectKeyFrame(ORIGIN, { timeoutMs });
      const frame = document.querySelector("iframe") as HTMLIFrameElement;
      const target = frame.contentWindow as Window;
      const handed: {
        message: unknown;
        target: string;
        ports: MessagePort[];
      }[] = [];
      vi.spyOn(target, "postMessage").mockImplementation(((
        message: unknown,
        to: string,
        ports: MessagePort[]
      ) => {
        handed.push({ message, target: to, ports });
      }) as never);
      return { connected, frame, target, handed };
    };

    const ready = (source: unknown, origin: string, version = 1) => {
      const event = new MessageEvent("message", {
        data: { type: "pg-wallet-keys:ready", version },
        origin,
      });
      Object.defineProperty(event, "source", { value: source });
      window.dispatchEvent(event);
    };

    it("appends a hidden frame on the key page", () => {
      const { frame } = start();
      expect(frame.src).toBe(ORIGIN + "/wallet-keys.html");
      expect(frame.getAttribute("width")).toBe("0");
      expect(frame.getAttribute("height")).toBe("0");
      expect(frame.tabIndex).toBe(-1);
      expect(frame.getAttribute("aria-hidden")).toBe("true");
      expect(frame.style.cssText).toContain("left: -9999px");
    });

    it("answers ready with a port and round-trips requests by id", async () => {
      const { connected, target, handed } = start();
      ready(target, ORIGIN);
      const link = await connected;
      expect(handed).toHaveLength(1);
      expect(handed[0].message).toEqual({
        type: "pg-wallet-keys:connect",
        version: KEY_PROTOCOL_VERSION,
      });
      expect(handed[0].target).toBe(ORIGIN);

      const server = handed[0].ports[0];
      const seen: KeyRequest[] = [];
      server.onmessage = (event) => seen.push(event.data);
      const first = link.request<string[]>({ type: "accounts" });
      const second = link.request<string>({ type: "create" });
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      expect(seen.map((r) => r.type)).toEqual(["accounts", "create"]);
      // out of order
      server.postMessage({ id: seen[1].id, ok: true, result: "pk" });
      server.postMessage({ id: seen[0].id, ok: true, result: ["a"] });
      expect(await second).toBe("pk");
      expect(await first).toEqual(["a"]);

      const failing = link.request({ type: "forget", publicKey: "x" });
      await vi.waitFor(() => expect(seen).toHaveLength(3));
      server.postMessage({ id: seen[2].id, ok: false, error: "nope" });
      await expect(failing).rejects.toThrow("nope");

      const orphan = link.request({ type: "accounts" });
      link.close();
      await expect(orphan).rejects.toThrow("closed");
      expect(document.querySelector("iframe")).toBeNull();
      server.close();
    });

    it("ignores ready from another window or origin, then times out", async () => {
      vi.useFakeTimers();
      const { connected, handed } = start(1000);
      const outcome = expect(connected).rejects.toMatchObject({
        reason: "timeout",
      });
      ready({}, ORIGIN);
      ready(undefined, ORIGIN);
      const target = (document.querySelector("iframe") as HTMLIFrameElement)
        .contentWindow;
      ready(target, "https://evil.example");
      expect(handed).toHaveLength(0);
      vi.advanceTimersByTime(1000);
      await outcome;
      expect(document.querySelector("iframe")).toBeNull();
    });

    /** A connected frame, the key page's port, and the requests it saw */
    const linked = async (opts: Parameters<typeof connectKeyFrame>[1]) => {
      const pending = connectKeyFrame(ORIGIN, opts);
      const frame = document.querySelector("iframe") as HTMLIFrameElement;
      const target = frame.contentWindow as Window;
      const ports: MessagePort[] = [];
      // postMessage(message, targetOrigin, transfer): keep the ports handed over
      vi.spyOn(target, "postMessage").mockImplementation(((
        ...args: [unknown, string, MessagePort[]]
      ) => {
        ports.push(...args[2]);
      }) as never);
      ready(target, ORIGIN);
      const link = await pending;
      const server = ports[0];
      const seen: KeyRequest[] = [];
      server.onmessage = (event) => seen.push(event.data);
      return { link, server, seen };
    };

    it("rejects a request made after close, without sending it", async () => {
      const { link, server, seen } = await linked({});
      link.close();
      await expect(link.request({ type: "accounts" })).rejects.toThrow(
        "closed"
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(seen).toHaveLength(0);
      server.close();
    });

    it("rejects a request the key page never answers, as a timeout", async () => {
      const { link, server, seen } = await linked({ requestTimeoutMs: 50 });
      const unanswered = link.request({ type: "accounts" });
      await expect(unanswered).rejects.toBeInstanceOf(KeyFrameUnavailable);
      await expect(unanswered).rejects.toMatchObject({ reason: "timeout" });
      // A late answer to it is dropped, not an error
      server.postMessage({ id: seen[0].id, ok: true, result: [] });
      server.close();
    });

    it("rejects pending requests when a reply cannot be read", async () => {
      // The listeners the page's port gets, so a test can fire what the
      // browser fires there (jsdom's events do not reach Node's ports)
      const listeners: Array<[string, () => void]> = [];
      const Real = MessageChannel;
      vi.stubGlobal(
        "MessageChannel",
        class extends Real {
          constructor() {
            super();
            this.port1.addEventListener = ((...args: [string, () => void]) =>
              listeners.push(args)) as never;
          }
        }
      );
      const { link, server } = await linked({});
      const first = link.request({ type: "accounts" });
      const second = link.request({ type: "create" });
      for (const [type, listener] of listeners) {
        if (type === "messageerror") listener();
      }
      await expect(first).rejects.toThrow("could not be read");
      await expect(second).rejects.toThrow("could not be read");
      server.close();
    });

    it("keyFrameWith drops a connection whose request timed out", async () => {
      vi.stubEnv("REACT_APP_WALLET_KEY_ORIGIN", ORIGIN);
      const answer = () => {
        const frames = document.querySelectorAll("iframe");
        const target = frames[frames.length - 1].contentWindow as Window;
        vi.spyOn(target, "postMessage").mockImplementation((() => {}) as never);
        ready(target, ORIGIN);
      };
      const frameFor = keyFrameWith(20);
      const first = frameFor();
      answer();
      const link = await first;
      expect(frameFor()).toBe(first);

      await expect(link.request({ type: "accounts" })).rejects.toMatchObject({
        reason: "timeout",
      });

      const second = frameFor();
      expect(second).not.toBe(first);
      answer();
      await second;
      second.then((frame) => frame.close());
    });

    it("points a panel frame at its panel, theme in the fragment", async () => {
      const { decodeTheme, panelRouteOf } = await import("./frame/panel");
      const theme = {
        bg: "oklch(0.2 0 0)",
        font: '"Stack Sans Text", sans-serif',
      };
      const exportUrl = new URL(
        keyPanelUrl(ORIGIN)(
          {
            mode: "export",
            publicKey: "11111111111111111111111111111111",
            name: "My wallet",
          },
          theme
        )
      );
      expect(exportUrl.origin + exportUrl.pathname).toBe(
        ORIGIN + "/wallet-keys.html"
      );
      expect(panelRouteOf(exportUrl.hash)).toEqual({
        mode: "export",
        publicKey: "11111111111111111111111111111111",
        name: "My wallet",
        theme,
      });
      const importUrl = new URL(keyPanelUrl(ORIGIN)({ mode: "import" }, {}));
      expect(panelRouteOf(importUrl.hash)).toEqual({
        mode: "import",
        theme: {},
      });
      expect(
        decodeTheme(
          new URLSearchParams(importUrl.hash.split("?")[1]).get("theme")
        )
      ).toEqual({});
    });

    it("connects a panel frame the caller owns, and leaves it on a timeout", async () => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const connected = connectKeyPanel(ORIGIN, 1000)(
        frame,
        new AbortController().signal
      )(ORIGIN + "/wallet-keys.html#panel/import");
      expect(frame.src).toBe(ORIGIN + "/wallet-keys.html#panel/import");
      // The window the frame shows once pointed at the panel
      const target = frame.contentWindow as Window;
      const handed: unknown[][] = [];
      vi.spyOn(target, "postMessage").mockImplementation(((
        ...args: unknown[]
      ) => {
        handed.push(args);
      }) as never);
      ready({}, ORIGIN);
      ready(target, "https://evil.example");
      ready(target, ORIGIN);
      const port = await connected;
      expect(handed).toHaveLength(1);
      expect(port).toBeInstanceOf(MessagePort);
      port.close();

      vi.useFakeTimers();
      const silent = document.createElement("iframe");
      document.body.append(silent);
      const timedOut = expect(
        connectKeyPanel(ORIGIN, 1000)(silent, new AbortController().signal)(
          ORIGIN + "/wallet-keys.html"
        )
      ).rejects.toBeInstanceOf(KeyFrameUnavailable);
      vi.advanceTimersByTime(1000);
      await timedOut;
      expect(silent.isConnected).toBe(true);
    });

    it("stops a panel's handshake when told, so a later load is not taken for it", async () => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const controller = new AbortController();
      const stopped = connectKeyPanel(ORIGIN, 1000)(frame, controller.signal)(
        ORIGIN + "/wallet-keys.html#panel/import"
      );
      const target = frame.contentWindow as Window;
      const post = vi
        .spyOn(target, "postMessage")
        .mockImplementation((() => {}) as never);
      controller.abort(new Error("moved on"));
      await expect(stopped).rejects.toThrow("moved on");
      ready(target, ORIGIN);
      expect(post).not.toHaveBeenCalled();
    });

    it("rejects on another protocol version", async () => {
      const { connected, target, handed } = start();
      ready(target, ORIGIN, 2);
      await expect(connected).rejects.toMatchObject({ reason: "version" });
      expect(handed).toHaveLength(0);
      expect(document.querySelector("iframe")).toBeNull();
    });
  });
}
