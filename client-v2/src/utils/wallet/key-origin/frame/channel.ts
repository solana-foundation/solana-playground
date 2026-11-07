import {
  isKeyHandshake,
  isKeyRequest,
  KEY_PROTOCOL_VERSION,
  type KeyReady,
  type KeyReply,
  type KeyRequest,
} from "../protocol";

/**
 * Tells the app the key page is listening, then waits for the app's handshake
 * and the port it carries. Only a handshake from `parent`, at `appOrigin`, in
 * this protocol version, is taken; everything else is ignored, so another
 * page that frames this one gets no port and no answer.
 *
 * @param appOrigin the one origin the key page serves
 * @param parent the window that framed the key page
 * @returns for the key page's window, the port the app handed over
 */
export const awaitPortFor =
  (appOrigin: string, parent: Window) =>
  (self: Window): Promise<MessagePort> =>
    new Promise((resolve) => {
      const handleMessage = (event: MessageEvent) => {
        const [port] = event.ports;
        if (
          event.source !== parent ||
          event.origin !== appOrigin ||
          !isKeyHandshake(event.data) ||
          event.data.version !== KEY_PROTOCOL_VERSION ||
          !port
        ) {
          return;
        }
        self.removeEventListener("message", handleMessage);
        resolve(port);
      };
      self.addEventListener("message", handleMessage);
      const ready: KeyReady = {
        type: "pg-wallet-keys:ready",
        version: KEY_PROTOCOL_VERSION,
      };
      parent.postMessage(ready, appOrigin);
    });

/**
 * Answers each well-formed request on `port` with `handle`; anything else on
 * the port is ignored.
 *
 * @param handle the key page's request handler
 * @returns for the port the app handed over, a server of its requests
 */
export const serveWith =
  (handle: (request: KeyRequest) => Promise<KeyReply>) =>
  (port: MessagePort) => {
    port.onmessage = async (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isKeyRequest(data)) return;
      port.postMessage(await handle(data));
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/wallet/key-origin/frame/channel", () => {
    const APP = "http://localhost:3006";

    /** A parent that records what it was sent, and a frame window */
    const windows = () => {
      const posted: { message: unknown; target: string }[] = [];
      const parent = {
        postMessage: (message: unknown, target: string) => {
          posted.push({ message, target });
        },
      } as unknown as Window;
      const self = new EventTarget() as unknown as Window;
      return { posted, parent, self };
    };

    const handshake = (
      self: Window,
      init: { source: unknown; origin: string; data: unknown; port?: boolean }
    ) => {
      const port = new MessageChannel().port1;
      const event = new MessageEvent("message", {
        data: init.data,
        origin: init.origin,
        ports: init.port === false ? [] : [port],
      });
      // jsdom's MessageEvent takes no plain object as `source`
      Object.defineProperty(event, "source", { value: init.source });
      self.dispatchEvent(event);
      return port;
    };

    const CONNECT = {
      type: "pg-wallet-keys:connect",
      version: KEY_PROTOCOL_VERSION,
    };

    it("posts ready to the app origin only", () => {
      const { posted, parent, self } = windows();
      void awaitPortFor(APP, parent)(self);
      expect(posted).toEqual([
        {
          message: {
            type: "pg-wallet-keys:ready",
            version: KEY_PROTOCOL_VERSION,
          },
          target: APP,
        },
      ]);
    });

    it("takes the port of the app's handshake and ignores the rest", async () => {
      const { parent, self } = windows();
      const connected = awaitPortFor(APP, parent)(self);
      let settled = false;
      void connected.then(() => (settled = true));

      const stranger = {} as Window;
      handshake(self, { source: stranger, origin: APP, data: CONNECT });
      handshake(self, {
        source: parent,
        origin: "https://evil.example",
        data: CONNECT,
      });
      handshake(self, {
        source: parent,
        origin: APP,
        data: { type: "pg-wallet-keys:connect", version: 999 },
      });
      handshake(self, { source: parent, origin: APP, data: { type: "x" } });
      handshake(self, {
        source: parent,
        origin: APP,
        data: CONNECT,
        port: false,
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      const port = handshake(self, {
        source: parent,
        origin: APP,
        data: CONNECT,
      });
      expect(await connected).toBe(port);
    });

    it("answers well-formed requests and drops the rest", async () => {
      const channel = new MessageChannel();
      const seen: KeyRequest[] = [];
      serveWith(async (request) => {
        seen.push(request);
        return { id: request.id, ok: true, result: "pk" };
      })(channel.port1);
      const replies: unknown[] = [];
      const replied = new Promise<void>((resolve) => {
        channel.port2.onmessage = (event) => {
          replies.push(event.data);
          resolve();
        };
      });
      channel.port2.postMessage({ type: "nope" });
      channel.port2.postMessage({ id: 7, type: "accounts" });
      await replied;
      expect(seen).toEqual([{ id: 7, type: "accounts" }]);
      expect(replies).toEqual([{ id: 7, ok: true, result: "pk" }]);
      channel.port1.close();
      channel.port2.close();
    });
  });
}
