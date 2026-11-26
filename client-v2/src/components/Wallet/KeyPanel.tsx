import { useEffect, useReducer, useRef, useState } from "react";

import { walletOriginEnv } from "@/shared/config/client-env";
import { createLogger } from "@/shared/lib/logger";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { CalloutAction } from "@/shared/ui/callout";

import {
  connectKeyPanelFor,
  HANDSHAKE_TIMEOUT_MS,
  type KeyPanelRoute,
  keyPanelUrlFor,
} from "../../utils/wallet/key-origin/client";
import { keyOriginFor } from "../../utils/wallet/key-origin/origin";
import {
  isKeyReady,
  isPanelMessage,
  PANEL_LABEL,
  type PanelMessage,
  type ThemeTokens,
} from "../../utils/wallet/key-origin/protocol";

const log = createLogger("wallet:key-panel");

/** What the dialog shows in place of the panel when the key page did not load */
export const KEY_PANEL_UNAVAILABLE =
  "Key storage didn't load. Reload the page and try again.";

/**
 * The muted line a dialog shows in place of a key panel whose key page did not
 * load, or a key it could not make
 */
export const KeyPanelUnavailable = ({ className }: { className?: string }) => (
  <p
    className={cn(
      "flex min-h-8 items-center text-sm text-muted-foreground",
      className
    )}
  >
    {KEY_PANEL_UNAVAILABLE}
  </p>
);

/**
 * How far the focus ring reaches past the button (`ring-3`); the frame is that
 * much larger on each side and the key page's body is padded by it
 */
const RING_PX = 3;

/**
 * How long the key page may stay busy. Its tasks are one file read or one
 * IndexedDB request; a page that hangs or crashes mid-task would otherwise
 * keep the dialog closed to Escape and its submit held until a reload.
 */
const BUSY_LIMIT_MS = 60_000;

/** The elements the panel's look is read from */
export type ThemeProbes = {
  /** A hidden button of the panel's look (outline, primary or callout action) with its label */
  button: HTMLElement;
  /** Coloured as that button is on hover */
  hover: HTMLElement;
  /** Coloured as its focus ring: border as the ring's edge, background as the ring */
  ring: HTMLElement;
};

/**
 * @param probes the elements to read
 * @returns the tokens the key page draws its button with, as the current theme
 * computes them, so the panel looks like the button beside it
 */
export const readThemeTokens = ({
  button,
  hover,
  ring,
}: ThemeProbes): ThemeTokens => {
  const style = getComputedStyle(button);
  const hoverStyle = getComputedStyle(hover);
  const ringStyle = getComputedStyle(ring);
  return {
    bg: style.backgroundColor,
    fg: style.color,
    // A button with no edge (a callout's action) has a colour on its border
    // all the same; the key page draws a 1px border from it, so none is sent
    border:
      style.borderTopWidth === "0px" ? "transparent" : style.borderTopColor,
    radius: style.borderTopLeftRadius,
    font: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    height: style.height,
    padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
    hoverBg: hoverStyle.backgroundColor,
    hoverFg: hoverStyle.color,
    focus: ringStyle.borderTopColor,
    ring: ringStyle.backgroundColor,
  };
};

type PanelResults = {
  /**
   * The panel started or finished a task (a file read, a save). Called on
   * each change only, and with `false` when the panel goes mid-task, so
   * calls pair up (`useBusyPanels`)
   */
  onBusy?: (busy: boolean) => void;
  /** What went wrong, in words the dialog can show; never key bytes */
  onError: (message: string) => void;
};

/**
 * Which button of ours the key page's button looks like: the outline button
 * by default, a dialog's one action (`primary`), or a callout's action
 * (`callout`). The callout's action takes its tone from the `Callout` around
 * it, so place that look inside one: outside, it has the neutral tone only
 */
export type KeyPanelLook = "outline" | "primary" | "callout";

/** The `Button` each look but the callout's copies, and that button's hover */
const BUTTON_LOOK: Record<
  Exclude<KeyPanelLook, "callout">,
  { variant: "outline" | "default"; hover: string }
> = {
  outline: {
    variant: "outline",
    hover: "bg-muted text-foreground dark:bg-input/50",
  },
  primary: {
    variant: "default",
    hover: "bg-primary/80 text-primary-foreground",
  },
};

/**
 * What the panel does, with the result that ends it. An import's result is
 * what every caller acts on, so it is required. A save's is optional: a
 * dialog with a way on of its own (Remove's, a new wallet's) needs none, while
 * a caller whose one action is this button (the Export dialog, the deploy
 * card) closes or answers on it
 */
type PanelAction =
  | {
      action: "import";
      /**
       * The panel stored the key in this file, by its public key; `isNew` is
       * `false` when the key page already held it
       */
      onImported: (publicKey: string, isNew: boolean) => void;
    }
  | {
      action: "export";
      publicKey: string;
      name: string;
      /** The browser was handed the key file */
      onExported?: () => void;
    };

export type KeyPanelProps = PanelResults &
  PanelAction & { className?: string; look?: KeyPanelLook };

export type BaseKeyPanelProps = KeyPanelProps & {
  /** The key origin; `null` when the build names none */
  origin: string | null;
  /** Points the frame at the panel and resolves with its port */
  connect: (
    origin: string
  ) => (
    frame: HTMLIFrameElement,
    signal: AbortSignal
  ) => (src: string) => Promise<MessagePort>;
  /** The tokens the current theme gives the button */
  readTokens: (probes: ThemeProbes) => ThemeTokens;
};

/**
 * The key page's import or export panel, in place of the button it replaces:
 * a hidden design-system button holds the layout, and the key page's frame
 * lies over it, drawn from that button's computed look (`look`: an outline
 * or primary button, or a callout's action) and told again when the theme or
 * the window's width changes it. Results go to the caller, a dialog or the
 * deploy card, through the callbacks.
 */
export const BaseKeyPanel = (props: BaseKeyPanelProps) => {
  const {
    action,
    origin,
    connect,
    readTokens,
    className,
    look = "outline",
  } = props;
  const publicKey = props.action === "export" ? props.publicKey : undefined;
  const name = props.action === "export" ? props.name : undefined;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hoverRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const portRef = useRef<MessagePort | undefined>(undefined);
  const resultsRef = useRef<KeyPanelProps>(props);
  resultsRef.current = props;
  const nameRef = useRef(name);
  nameRef.current = name;
  const [isUnavailable, setIsUnavailable] = useState(!origin);
  // Counts the key page's restarts, each of which needs a connection of its own
  const [connection, reconnect] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const frame = frameRef.current;
    const button = buttonRef.current;
    const hover = hoverRef.current;
    const ring = ringRef.current;
    if (!origin || !frame || !button || !hover || !ring) return;

    const probes = { button, hover, ring };
    let tokens = readTokens(probes);
    const route: KeyPanelRoute =
      action === "import"
        ? { mode: "import" }
        : {
            mode: "export",
            publicKey: publicKey ?? "",
            name: nameRef.current ?? "",
          };
    let isLive = true;
    let isBusy = false;
    let busyLimit: number | undefined;
    const setBusy = (busy: boolean) => {
      if (busy === isBusy) return;
      isBusy = busy;
      clearTimeout(busyLimit);
      if (busy) {
        busyLimit = window.setTimeout(() => {
          log.warn("key panel stayed busy", {
            report: true,
            context: { action },
          });
          resultsRef.current.onError(
            "The key page stopped answering. Try again."
          );
          setBusy(false);
        }, BUSY_LIMIT_MS);
      }
      resultsRef.current.onBusy?.(busy);
    };
    let port: MessagePort | undefined;
    const stopped = new AbortController();
    const handleRestart = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.origin !== origin ||
        !isKeyReady(event.data)
      ) {
        return;
      }
      // A task under way died with the page it ran in; its result never comes
      if (isBusy) {
        resultsRef.current.onError(
          "The key page restarted before it finished. Try again."
        );
      }
      reconnect();
    };

    const send = (message: PanelMessage) => port?.postMessage(message);
    const resendTokens = () => {
      const next = readTokens(probes);
      if (JSON.stringify(next) === JSON.stringify(tokens)) return;
      tokens = next;
      send({ type: "theme", tokens });
    };
    const observer = new MutationObserver(resendTokens);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    // A callout's action is taller on a phone, so a width that crosses the
    // breakpoint changes the look too
    window.addEventListener("resize", resendTokens);

    connect(origin)(
      frame,
      stopped.signal
    )(keyPanelUrlFor(origin)(route, tokens)).then(
      (connected) => {
        if (!isLive) {
          connected.close();
          return;
        }
        port = connected;
        portRef.current = connected;
        // A frame whose element moves in the document (a layout that puts
        // the panel elsewhere at another width) reloads: the key page starts
        // again and says it is ready, while the port reaches its old document
        // only, and the button would stay disabled
        window.addEventListener("message", handleRestart);
        // The theme may have changed while the panel loaded
        send({ type: "theme", tokens });
        // So may the name, typed meanwhile
        if (
          route.mode === "export" &&
          nameRef.current !== undefined &&
          nameRef.current !== route.name
        ) {
          send({ type: "name", name: nameRef.current });
        }
        connected.onmessage = (event: MessageEvent) => {
          const data: unknown = event.data;
          if (!isPanelMessage(data)) return;
          const results = resultsRef.current;
          switch (data.type) {
            case "imported":
              if (results.action === "import") {
                results.onImported(data.publicKey, data.isNew);
              }
              break;
            case "exported":
              if (results.action === "export") results.onExported?.();
              break;
            case "error":
              results.onError(data.message);
              break;
            case "busy":
              setBusy(data.busy);
              break;
            case "escape":
              // As if pressed here: the dialog's own Escape handling (Radix
              // listens on the document) closes it, or not while it may not
              frame.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                })
              );
              break;
          }
        };
      },
      (error: unknown) => {
        if (!isLive) return;
        // The reason only: nothing here carries key bytes, and naming it keeps
        // it so. Reported: a misconfigured key origin reads this way
        log.warn("key panel did not load", {
          report: true,
          context: {
            reason:
              error instanceof Error && "reason" in error
                ? String(error.reason)
                : String(error),
          },
        });
        setIsUnavailable(true);
      }
    );

    return () => {
      isLive = false;
      stopped.abort();
      observer.disconnect();
      window.removeEventListener("resize", resendTokens);
      window.removeEventListener("message", handleRestart);
      port?.close();
      portRef.current = undefined;
      // Its "not busy" can no longer arrive
      setBusy(false);
      // Away from the panel, so pointing the frame at it again is a fresh
      // load (the same URL again would be a fragment navigation, no load)
      frame.src = "about:blank";
    };
  }, [origin, action, publicKey, connect, readTokens, connection]);

  useEffect(() => {
    if (name !== undefined)
      portRef.current?.postMessage({ type: "name", name });
  }, [name]);

  if (isUnavailable) return <KeyPanelUnavailable className={className} />;

  return (
    <span
      data-slot="key-panel"
      className={cn("relative inline-flex w-fit", className)}
    >
      {/* Holds the button's place and gives the panel its look; never seen.
          Without the button's transition, its computed colours are the
          theme's at once, not the first frame of a fade */}
      {look === "callout" ? (
        <>
          <CalloutAction
            ref={buttonRef}
            tabIndex={-1}
            aria-hidden
            className="invisible transition-none"
          >
            {PANEL_LABEL[action]}
          </CalloutAction>
          {/* The class goes through CalloutAction's `cn`, so the hover fill
              replaces the rest fill; Slot only joins a child's class */}
          <CalloutAction
            asChild
            className="pointer-events-none invisible absolute size-0 bg-(--action-hover)"
          >
            <span ref={hoverRef} aria-hidden />
          </CalloutAction>
        </>
      ) : (
        <>
          <Button
            ref={buttonRef}
            type="button"
            variant={BUTTON_LOOK[look].variant}
            tabIndex={-1}
            aria-hidden
            className="invisible transition-none"
          >
            {PANEL_LABEL[action]}
          </Button>
          <span
            ref={hoverRef}
            aria-hidden
            className={cn(
              "pointer-events-none invisible absolute size-0",
              BUTTON_LOOK[look].hover
            )}
          />
        </>
      )}
      <span
        ref={ringRef}
        aria-hidden
        className="pointer-events-none invisible absolute size-0 border border-ring bg-ring/50"
      />
      <iframe
        ref={frameRef}
        title={PANEL_LABEL[action]}
        sandbox="allow-scripts allow-same-origin allow-downloads"
        scrolling="no"
        className="absolute border-0 bg-transparent"
        style={{
          inset: -RING_PX,
          width: `calc(100% + ${2 * RING_PX}px)`,
          height: `calc(100% + ${2 * RING_PX}px)`,
          colorScheme: "normal",
        }}
      />
    </span>
  );
};

const connectPanelFor = (origin: string) =>
  connectKeyPanelFor(origin)(HANDSHAKE_TIMEOUT_MS);

/** The key page's panel on the build's key origin (`BaseKeyPanel`) */
export const KeyPanel = (props: KeyPanelProps) => (
  <BaseKeyPanel
    {...props}
    origin={keyOriginFor(walletOriginEnv().KEY_ORIGIN)(window.location)}
    connect={connectPanelFor}
    readTokens={readThemeTokens}
  />
);
