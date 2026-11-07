import { keyOriginFor } from "./origin";
import {
  type DistributiveOmit,
  isKeyReady,
  isKeyReply,
  KEY_PROTOCOL_VERSION,
  type KeyHandshake,
  type KeyReply,
  type KeyRequest,
} from "./protocol";

/** Where the key page is served, under the key origin */
const KEY_PAGE_PATH = "/wallet-keys.html";

/** How long the key page has to load and announce itself */
const HANDSHAKE_TIMEOUT_MS = 10_000;

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

const frameOver = (port: MessagePort, frame: HTMLIFrameElement): KeyFrame => {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  port.onmessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (!isKeyReply(data)) return;
    const waiting = pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id);
    waiting.resolve(data);
  };
  return {
    request: <T>(body: DistributiveOmit<KeyRequest, "id">) =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {
          resolve: (reply) =>
            reply.ok
              ? resolve(reply.result as T)
              : reject(new Error(reply.error)),
          reject,
        });
        port.postMessage({ ...body, id });
      }),
    close: () => {
      port.close();
      frame.remove();
      for (const { reject } of pending.values()) {
        reject(new Error("The wallet's key page was closed."));
      }
      pending.clear();
    },
  };
};

/**
 * Opens the hidden key page on `origin` and a private channel to it. Only a
 * ready message from that frame's own window, at `origin`, counts; the page
 * answers with one port of a new `MessageChannel`, and everything after goes
 * over that port.
 *
 * @param origin the key origin
 * @param opts the time limit and the document to put the frame in
 * @returns the connection
 */
export const connectKeyFrame = (
  origin: string,
  opts: { timeoutMs?: number; doc?: Document } = {}
): Promise<KeyFrame> => {
  const { timeoutMs = HANDSHAKE_TIMEOUT_MS, doc = document } = opts;
  const host = doc.defaultView ?? window;
  const frame = hiddenFrame(doc, origin + KEY_PAGE_PATH);
  return new Promise<KeyFrame>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      host.removeEventListener("message", handleMessage);
    };
    const fail = (reason: "timeout" | "version") => {
      stop();
      frame.remove();
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
      resolve(frameOver(channel.port1, frame));
    };
    const timer = setTimeout(() => fail("timeout"), timeoutMs);
    host.addEventListener("message", handleMessage);
    doc.body.append(frame);
  });
};

let connection: Promise<KeyFrame> | undefined;

/**
 * @returns the page's one connection to the key page, made on first use; a
 * failed attempt is not kept, so the next call reconnects
 */
export const keyFrame = (): Promise<KeyFrame> => {
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
  const attempt = connectKeyFrame(origin).then((frame) => {
    return {
      request: frame.request,
      close: () => {
        if (connection === attempt) connection = undefined;
        frame.close();
      },
    };
  });
  connection = attempt;
  attempt.catch(() => {
    if (connection === attempt) connection = undefined;
  });
  return attempt;
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("utils/wallet/key-origin/client", () => {
    const ORIGIN = "http://127.0.0.1:3006";

    afterEach(() => {
      vi.useRealTimers();
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

    it("rejects on another protocol version", async () => {
      const { connected, target, handed } = start();
      ready(target, ORIGIN, 2);
      await expect(connected).rejects.toMatchObject({ reason: "version" });
      expect(handed).toHaveLength(0);
      expect(document.querySelector("iframe")).toBeNull();
    });
  });
}
