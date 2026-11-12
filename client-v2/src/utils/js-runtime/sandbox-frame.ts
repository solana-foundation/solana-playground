import { HANDSHAKE, isHandshake } from "./protocol";

/** Where the sandbox's page is served (`craco.config.js`, second entry) */
export const SANDBOX_URL = "/runtime.html";

/** How long the sandbox has to load and announce itself */
export const LOAD_TIMEOUT_MS = 15_000;

/** The part of `window` the handshake listens on */
type MessageHost = Pick<Window, "addEventListener" | "removeEventListener">;

/** The error a run fails with when the sandbox does not announce itself */
export const loadTimeoutError = (timeoutMs: number) =>
  new Error(
    `The runtime did not load in ${Math.round(
      timeoutMs / 1000
    )} s. Check the network and run again.`
  );

/**
 * Opens the private channel with the sandbox.
 *
 * The sandbox's bundle posts the handshake on `window` once it has loaded.
 * Only a handshake whose `source` is the frame's own window counts; anything
 * else, from any window, is ignored. The page answers with one port of a new
 * `MessageChannel` and stops listening, so after the handshake no `window`
 * message reaches the runtime at all.
 *
 * @param host the page's window
 * @returns a function of the time limit, then of the frame's window
 */
export const connectWith =
  (host: MessageHost) =>
  (timeoutMs: number) =>
  (frameWindow: () => Window | null): Promise<MessagePort> =>
    new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        host.removeEventListener("message", handleMessage);
      };
      const handleMessage = (event: MessageEvent) => {
        const frame = frameWindow();
        if (!frame || event.source !== frame || !isHandshake(event.data)) {
          return;
        }
        stop();
        const channel = new MessageChannel();
        // The frame's origin is opaque, so `"*"` is the only target that
        // reaches it; the port is what keeps the rest of the talk private
        frame.postMessage(HANDSHAKE, "*", [channel.port2]);
        resolve(channel.port1);
      };
      const timer = setTimeout(() => {
        stop();
        reject(loadTimeoutError(timeoutMs));
      }, timeoutMs);
      host.addEventListener("message", handleMessage);
    });

/** What a run fails with when the sandbox's frame loads a new document */
export const RELOADED_ERROR =
  "The runtime reloaded or navigated away before the code finished, so the run ended.";

/** The part of the frame element whose `load` events are counted */
type LoadHost = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Watches the sandbox's frame for a document other than the one a run talks
 * to. Called just before the frame is pointed at the sandbox, so its first
 * `load` is that document's, whether it fires before or after the handshake;
 * any later `load` means the frame reloaded or navigated, and the sandbox the
 * run talks to is gone and will never post `end`.
 *
 * @param frame the sandbox's frame element
 * @returns `reloaded`, resolving at the second `load`, and `stop`, which
 * removes the listener
 */
export const watchReloadsOf = (frame: LoadHost) => {
  let loads = 0;
  let resolveReloaded = () => {};
  const reloaded = new Promise<void>((resolve) => {
    resolveReloaded = resolve;
  });
  const handleLoad = () => {
    loads += 1;
    if (loads < 2) return;
    stop();
    resolveReloaded();
  };
  const stop = () => frame.removeEventListener("load", handleLoad);
  frame.addEventListener("load", handleLoad);
  return { reloaded, stop };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, afterEach } = import.meta.vitest;

  describe("utils/js-runtime/sandbox-frame", () => {
    /** A host whose one listener the test calls with its own events */
    const hostFor = () => {
      let listener: ((event: MessageEvent) => void) | undefined;
      const host = {
        addEventListener: vi.fn((_type: string, cb: unknown) => {
          listener = cb as (event: MessageEvent) => void;
        }),
        removeEventListener: vi.fn(() => {
          listener = undefined;
        }),
      };
      const deliver = (event: { source: unknown; data: unknown }) =>
        listener?.(event as unknown as MessageEvent);
      return {
        host: host as unknown as MessageHost,
        deliver,
        isListening: () => listener !== undefined,
      };
    };
    const frameWindowFor = () =>
      ({ postMessage: vi.fn() } as unknown as Window & {
        postMessage: ReturnType<typeof vi.fn>;
      });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("hands the port only to the frame's handshake, ignoring foreign window messages", async () => {
      const { host, deliver, isListening } = hostFor();
      const frame = frameWindowFor();
      const foreign = frameWindowFor();
      const connected = connectWith(host)(LOAD_TIMEOUT_MS)(() => frame);

      deliver({ source: foreign, data: HANDSHAKE });
      deliver({ source: frame, data: { type: "sign", id: 1 } });
      expect(frame.postMessage).not.toHaveBeenCalled();
      expect(foreign.postMessage).not.toHaveBeenCalled();

      deliver({ source: frame, data: HANDSHAKE });
      const port = await connected;

      expect(port).toBeInstanceOf(MessagePort);
      expect(frame.postMessage).toHaveBeenCalledTimes(1);
      const [message, target, transfer] = frame.postMessage.mock.calls[0];
      expect(message).toEqual(HANDSHAKE);
      expect(target).toBe("*");
      expect(transfer).toHaveLength(1);
      // Nothing listens on `window` after the handshake
      expect(isListening()).toBe(false);
      port.close();
    });

    it("watchReloadsOf resolves at the frame's second load, never at its first", async () => {
      const frame = new EventTarget();
      const { reloaded, stop } = watchReloadsOf(frame);
      let isReloaded = false;
      void reloaded.then(() => {
        isReloaded = true;
      });

      frame.dispatchEvent(new Event("load"));
      await Promise.resolve();
      expect(isReloaded).toBe(false);

      frame.dispatchEvent(new Event("load"));
      await reloaded;
      expect(isReloaded).toBe(true);
      stop();
    });

    it("watchReloadsOf stops listening once stopped", async () => {
      const frame = new EventTarget();
      const removed = vi.spyOn(frame, "removeEventListener");
      const { stop } = watchReloadsOf(frame);
      stop();
      expect(removed).toHaveBeenCalledWith("load", expect.any(Function));
    });

    it("rejects when the frame does not announce itself in time", async () => {
      vi.useFakeTimers();
      const { host, isListening } = hostFor();
      const connected = connectWith(host)(LOAD_TIMEOUT_MS)(() =>
        frameWindowFor()
      );
      const outcome = expect(connected).rejects.toThrow(
        "The runtime did not load in 15 s"
      );

      vi.advanceTimersByTime(LOAD_TIMEOUT_MS);

      await outcome;
      expect(isListening()).toBe(false);
    });
  });
}
