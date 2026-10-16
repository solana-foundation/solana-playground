// A one-shot channel to a service that answers in a popup we opened.
//
// The service navigates the popup through its own pages and finally posts one
// message back. The channel owns only the transport: which window may speak,
// from which origin, and what it means when the wait ends unanswered.
// Deciding whether a payload is meaningful stays with the caller, via `accept`.
//
// What this deliberately does NOT do is watch `popup.closed`. Once the popup
// has committed a cross-origin document that sets COOP, the browser disowns
// the handle we hold: `closed` answers true while the window is still on
// screen and the user is still working in it. Reading that as a cancellation
// discarded sign-ins that went on to succeed - the reply arrived minutes later
// on the broadcast, by which time nothing was listening. The wait now ends
// only on an answer, on `cancel()`, or on `timeoutMs`.

/**
 * Why the channel stopped waiting with nothing delivered.
 *
 * `cancelled` is the caller calling `cancel()` - the only cancellation signal
 * left, for the reason above.
 * `rejected` means something claiming to be this flow's reply arrived and was
 * turned away. Collapsing it into the others would hide a forged or stale
 * message behind a timeout.
 * `expired` means nothing claiming to be the reply ever arrived.
 */
export type PopupChannelFailure = "cancelled" | "rejected" | "expired";

export type PopupReceipt =
  | { delivered: true; data: unknown }
  | { delivered: false; reason: PopupChannelFailure };

export interface PopupChannel {
  /** The first accepted message, or why waiting ended without one */
  receive: () => Promise<PopupReceipt>;
  /**
   * Stop waiting and report `cancelled`. Closes the popup when the handle is
   * still ours to close; after a COOP hop that call is a no-op, so the window
   * is the user's to dismiss. No effect before `receive` or after it settles.
   */
  cancel: () => void;
}

interface PopupChannelOptions {
  url: string;
  /** Window name; reusing it re-navigates the same popup rather than opening another */
  name: string;
  features: string;
  /** Payloads this caller considers meaningful; anything else is ignored */
  accept: (data: unknown) => boolean;
  /**
   * Payloads that claim to be this flow's reply, whether or not they pass
   * `accept`. Only these can count as a rejection.
   *
   * Without it every unrelated same-origin message counts - and the page has
   * plenty, the project iframe among them - so any failure would be reported
   * as a forgery. Defaults to accepting nothing as a claim.
   */
  claims?: (data: unknown) => boolean;
  /**
   * Also listen on a same-origin `BroadcastChannel` of this name. Preferred
   * over `window.opener`, which COOP can sever across a cross-origin hop.
   *
   * Note it is same-origin but NOT window-bound: any same-origin context can
   * post here, so `accept` is the only filter on this path.
   */
  broadcastName?: string;
  /** How long to wait for an answer before reporting `expired`, in ms */
  timeoutMs: number;
}

/**
 * Open `url` in a popup and return a channel to it.
 *
 * Returns `undefined` when the browser blocked the popup, which is a different
 * outcome from the user dismissing it and deserves different wording upstream.
 *
 * @example Awaiting a provider's answer
 * ```ts
 * const channel = openPopupChannel({
 *   url: "/api/example?action=start",
 *   name: "example-auth",
 *   features: "width=980,height=720",
 *   accept: (data) => isExampleMessage(data),
 *   timeoutMs: 600_000,
 * });
 * if (!channel) throw new Error("Allow popups for this site.");
 * const receipt = await channel.receive();
 * ```
 */
export const openPopupChannel = (
  opts: PopupChannelOptions
): PopupChannel | undefined => {
  const popup = window.open(opts.url, opts.name, opts.features);
  if (!popup) return undefined;

  // Set while a `receive()` is outstanding, so `cancel()` is inert before the
  // wait starts and after it settles rather than resolving a stale promise
  let abort: (() => void) | undefined;

  const receive = () =>
    new Promise<PopupReceipt>((resolve) => {
      let timeout: number;
      // Set when a message purporting to be this flow's reply was turned away,
      // so running out of time afterwards is reported as a rejection.
      let sawRejected = false;
      const broadcast =
        opts.broadcastName && typeof BroadcastChannel !== "undefined"
          ? new BroadcastChannel(opts.broadcastName)
          : undefined;

      const settle = (receipt: PopupReceipt) => {
        window.removeEventListener("message", onMessage);
        broadcast?.close();
        window.clearTimeout(timeout);
        abort = undefined;
        resolve(receipt);
      };

      const claims = (data: unknown) => opts.claims?.(data) ?? false;

      const reject = (why: string) => {
        sawRejected = true;
        console.warn(`popup-channel: ${why}`);
      };

      const onMessage = (ev: MessageEvent) => {
        // Origin alone is not enough: same-origin code elsewhere on the page
        // (the project iframe) could post too, so pin it to this window.
        // A foreign origin is ordinary page noise, so it is not a rejection.
        if (ev.origin !== window.location.origin) return;
        if (!claims(ev.data)) return;
        if (ev.source !== popup) {
          return reject("same-origin message from another window");
        }
        if (!opts.accept(ev.data)) {
          return reject("window message rejected by accept()");
        }
        settle({ delivered: true, data: ev.data });
      };

      window.addEventListener("message", onMessage);

      if (broadcast) {
        broadcast.onmessage = (ev: MessageEvent) => {
          if (!claims(ev.data)) return;
          if (!opts.accept(ev.data)) {
            return reject("broadcast rejected by accept()");
          }
          settle({ delivered: true, data: ev.data });
        };
      }

      abort = () => {
        // A disowned handle ignores this; a live one spares the user a click
        popup.close();
        settle({ delivered: false, reason: "cancelled" });
      };

      timeout = window.setTimeout(() => {
        settle({
          delivered: false,
          reason: sawRejected ? "rejected" : "expired",
        });
      }, opts.timeoutMs);
    });

  return { receive, cancel: () => abort?.() };
};
