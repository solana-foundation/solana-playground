import { createElement, FC } from "react";

import { createLogger } from "@/shared/lib/logger";
import { uuid } from "@/shared/lib/ids";
import { PgCommon } from "./common";
import {
  createDerivable,
  declareDecorator,
  derivable,
  updatable,
} from "./decorators";
import type {
  SetState,
  Disposable,
  RequiredKey,
  SyncOrAsync,
  Elementable,
  Promisable,
} from "./types";

/** A dialog `PgView.openModal` opened that nothing has closed yet */
export type OpenModal = {
  /** What `PgView.closeModal` takes to close this dialog and no other */
  readonly id: string;
  readonly elementable: NonNullable<Elementable<any>>;
  readonly props?: Record<string, any>;
  /** What takes focus back when the modal closes, if it is still on the page */
  readonly opener: HTMLElement | null;
};

/**
 * The dialogs open now, bottom first. `ModalHost` draws exactly this list,
 * and each id's caller waits in `modalAnswers`, so a close answers the caller
 * of the dialog it removes and no other.
 */
let openModals: readonly OpenModal[] = [];
const modalAnswers = new Map<string, (data: unknown) => void>();

/**
 * How long, in milliseconds, a modal may wait for a `ModalHost` to show it.
 * One opened at start-up, before the layout has mounted its host, shows once
 * it does; one that no host ever shows is closed with `null`, so its caller
 * goes on, and reported, so the team hears of it.
 */
export const MODAL_HOST_WAIT = 5000;

const modalLog = createLogger("view:modal");

/** How many `ModalHost`s are mounted (`PgView.attachModalHost`) */
let modalHosts = 0;
/** Bumped by every host that mounts, so a wait that saw one come is over */
let hostAttaches = 0;

/** A modal's component name, for a report that says which one it was */
const nameOf = (elementable: OpenModal["elementable"]) => {
  const type =
    typeof elementable === "function" ? elementable : elementable.type;
  return typeof type === "string" ? type : type.displayName || type.name;
};

/** Close the modal `id` if no host has shown it by `MODAL_HOST_WAIT` */
const closeIfNoHost = (id: string) => {
  const attaches = hostAttaches;
  setTimeout(() => {
    // A host that came meanwhile starts a wait of its own when it goes
    if (modalHosts > 0 || hostAttaches !== attaches) return;
    const modal = openModals.find((modal) => modal.id === id);
    if (!modal) return;
    modalLog.error(
      new Error("No ModalHost showed a modal; it closed unanswered"),
      {
        report: true,
        context: { modal: nameOf(modal.elementable) },
      }
    );
    PgView.closeModal(null, id);
  }, MODAL_HOST_WAIT);
};

/**
 * Where a context menu was last opened: a right-click, or a long press, which
 * a touch screen fires no `contextmenu` for. Used once, by the next modal.
 */
let contextMenuTarget: Element | null = null;
if (typeof document !== "undefined") {
  const record = (ev: Event) => {
    contextMenuTarget = ev.target instanceof Element ? ev.target : null;
  };
  document.addEventListener("contextmenu", record, true);
  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.pointerType !== "mouse") record(ev);
    },
    true
  );
}

/**
 * Who opened a modal closed in this task: one opened as soon as it answers
 * (a confirm, then the next step) is opened from inside it, from an element
 * about to go, and returns focus to the first one's opener instead.
 */
let justClosedOpener: HTMLElement | null = null;

/** What can take focus */
const FOCUS_TARGET = "button, a[href], input, select, textarea, [tabindex]";

/**
 * What a modal opened now returns focus to: what has focus, or, for an item
 * of a menu, the trigger of the outermost menu, since menus close once an item
 * is picked and their items go with them. A context menu's trigger names no
 * menu: its item stands in for where the menu was opened, the editor tab or
 * the explorer row.
 */
const focusOpener = (): HTMLElement | null => {
  const target = contextMenuTarget;
  contextMenuTarget = null;
  const active = document.activeElement;
  // The dialog that just closed held focus, or already took it with it
  if (
    justClosedOpener &&
    (active === document.body || active?.closest('[role="dialog"]'))
  ) {
    return justClosedOpener;
  }
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  let opener = active;
  // A submenu's trigger is an item of the menu above it
  for (;;) {
    const menu: HTMLElement | null = opener.closest('[role="menu"]');
    const trigger: HTMLElement | null = menu?.id
      ? document.querySelector(`[aria-controls=${JSON.stringify(menu.id)}]`)
      : null;
    if (!trigger) {
      if (!menu || !target?.isConnected) return opener;
      return target.closest<HTMLElement>(FOCUS_TARGET) ?? opener;
    }
    opener = trigger;
  }
};

/** Replace the open modals and tell `PgView.onDidChangeModals` */
const setOpenModals = (modals: readonly OpenModal[]) => {
  openModals = modals;
  PgCommon.createAndDispatchCustomEvent(PgView.events.MODALS_CHANGE, modals);
};

/** How long a toast stays, in milliseconds, when its options give no duration */
export const DEFAULT_TOAST_DURATION = 5000;

/** A toast's id: what to reuse to replace it, or to close it */
export type ToastId = string | number;

/** How a toast behaves; `name` is its telemetry name, kebab-case */
export type ToastOptions = {
  name: string;
  /** Reuse to replace a toast; generated when absent */
  id?: ToastId;
  /** Milliseconds, or "persistent" to stay until closed; `DEFAULT_TOAST_DURATION` by default */
  duration?: number | "persistent";
};

/** Props a toast's component receives on top of its own */
export type ToastChildProps = { id: ToastId };

/**
 * What `PgView.setToast` sends and `ToastHost` receives. The event is a
 * plain DOM event, so a sender outside `setToast` may still omit `options`.
 */
export type ToastRequest = {
  elementable: Elementable<any>;
  props?: { componentProps?: Record<string, unknown>; options?: ToastOptions };
};

/** Sidebar page param */
export type SidebarPageParam<N extends string> = {
  /** Name of the page */
  name: N;
  /** `src` of the image */
  icon: string;
  /** Title of the page, defaults to `name` */
  title?: string;
  /** Keybind for the page */
  keybind?: string;
  /** Route to navigate to */
  route?: RoutePath;
  /** Handle the page logic */
  handle?: () => Disposable | void;
  /** Lazy loader for the element */
  importComponent?: () => Promise<{
    default: FC<React.PropsWithChildren<unknown>>;
  }>;
  /** Loading component to show until the page element is ready */
  LoadingComponent?: FC<React.PropsWithChildren<unknown>>;
};

/** Created sidebar page */
export type SidebarPage<N extends string = string> = RequiredKey<
  SidebarPageParam<N>,
  "title" | "importComponent"
>;

interface ViewState {
  sidebar: {
    name: SidebarPageName | null;
    props: Promisable<Record<string, unknown>>;
    loadingCount: number;
  };
}

const defaultState: ViewState = {
  sidebar: {
    name: null,
    props: {},
    loadingCount: 0,
  },
};

const recursive = true;

const log = createLogger("view:main-primary");

/**
 * How many `setMainPrimary` calls were made; the last one is the newest. A
 * reset while calls wait could let an older call match the counter and set
 * the view too, so tests must not reset it
 */
let mainPrimaryCalls = 0;

/** How many `setMainPrimary` calls are waiting for a main view to mount */
let mainPrimaryWaiting = 0;

/** How many main views are mounted (`announceMainPrimaryMount` / `Unmount`) */
let mainPrimaryMounted = 0;

/**
 * The content `setMainPrimary` last handed out, and whether no main view has
 * held it since: the one it went to unmounted, or had unmounted before the
 * content reached it. A route calls `setMainPrimary` once, so a view that
 * mounts again (the work, after the last project's delete unmounted it) would
 * stay empty without it. Strict mode's second mount in development gets it
 * once more, which only redraws the same view.
 */
let mainPrimaryDelivered:
  | { setEl: SetState<SyncOrAsync<Elementable>>; unmounted: boolean }
  | undefined;

/**
 * Resolve once a primary main view is mounted: at once when the mounted one
 * answers `get`, or when one announces its mount
 * (`PgView.announceMainPrimaryMount`). One listener of each kind per call,
 * removed when it settles. Rejects when the mounted view's getter answers
 * with an error, which a mount would never cure.
 */
const waitForMainPrimary = () => {
  const { send, receive } = PgCommon.getSendAndReceiveEventNames(
    PgCommon.getStaticStateEventNames(PgView.events.MAIN_PRIMARY_STATIC).get
  );
  const mount = PgView.events.MAIN_PRIMARY_MOUNT;

  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      document.removeEventListener(receive, onAnswer);
      document.removeEventListener(mount, onMount);
    };
    const onAnswer = (ev: Event) => {
      stop();
      const { error } = (ev as CustomEvent<{ error?: string }>).detail ?? {};
      if (error) {
        reject(new Error(`The main view could not be read: ${error}`));
      } else {
        resolve();
      }
    };
    const onMount = () => {
      stop();
      resolve();
    };

    document.addEventListener(receive, onAnswer);
    document.addEventListener(mount, onMount);
    PgCommon.createAndDispatchCustomEvent(send);
  });
};

const derive = () => ({
  /** Current sidebar page */
  currentSidebarPage: createDerivable({
    derive: (n) => _PgView.allSidebarPages.find((p) => p.name === n) ?? null,
    onChange: "sidebar.name",
    infallible: true,
  }),
});

@derivable(derive)
@updatable({ defaultState, recursive })
class _PgView {
  /** All sidebar pages */
  static allSidebarPages: SidebarPage<SidebarPageName>[];

  /** All view event names */
  static readonly events = {
    MAIN_PRIMARY_STATIC: "viewmainprimarystatic",
    MAIN_PRIMARY_MOUNT: "viewmainprimarymount",
    MAIN_SECONDARY_HEIGHT_SET: "viewmainsecondaryheightset",
    MAIN_SECONDARY_PROGRESS_SET: "viewmainsecondaryprogressset",
    MODALS_CHANGE: "viewmodalschange",
    TOAST_SET: "viewtoastset",
    TOAST_CLOSE: "viewtoastclose",
    NEW_ITEM_PORTAL_SET: "viewnewitemportalset",
  };

  /** DOM class names */
  static classNames = {
    ERROR: "error",
    SUCCESS: "success",
    OPEN: "open",
    HIDDEN: "hidden",
    TOUCHED: "touched",
    SELECTED: "selected",
    CTX_SELECTED: "ctx-selected",
    FILE: "file",
    FOLDER: "folder",
    FOLDER_INSIDE: "folder-inside",
    LOADING: "loading",
    DARKEN: "darken",
  };

  /** DOM ids */
  static ids = {
    ROOT: "root",
    ROOT_DIR: "root-dir",
    TABS: "tabs",
    WALLET_MAIN: "wallet-main",
    WALLET_RENAME_INPUT: "wallet-rename-input",
    HOME: "home",
  };

  /**
   * Set sidebar right component's loading state.
   *
   * **NOTE:** The boolean values are used to either increment or decrement the
   * ongoing process count. Setting the `loading` to `false` only decrements
   * the process count and the loading state is only disabled if there is no
   * other ongoing process.
   *
   * @param loading whether the sidebar should show loading state
   */
  static setSidebarLoading(loading: boolean) {
    // There could be multiple processes that change the loading state, and the
    // overall loading state should only be disabled when all processes complete
    if (loading) PgView.sidebar.loadingCount++;
    else if (PgView.sidebar.loadingCount) PgView.sidebar.loadingCount--;
  }

  /**
   * Set the primary main view (next to the sidebar and above the terminal).
   *
   * Waits until a main view is mounted (`waitForMainPrimary`), without
   * polling. A newer call supersedes one still waiting, whose setter then
   * never runs. A mounted view that answers with an error is reported and
   * left as it is: the routes call this without awaiting it, so a rejection
   * would reach no one.
   *
   * @param setEl element to set the main view to
   */
  static async setMainPrimary(setEl: SetState<SyncOrAsync<Elementable>>) {
    // Calls from routes left while Home kept the main view unmounted are all
    // released by the same mount. Their setters would run side by side in
    // `Primary`, and whichever finished last would show, so the "/" route's
    // view could land over the tutorial opened from Home. Only the newest
    // call may set the view.
    const call = ++mainPrimaryCalls;
    mainPrimaryWaiting++;
    try {
      await waitForMainPrimary();
    } catch (e) {
      log.error(e, { report: true });
      return;
    } finally {
      mainPrimaryWaiting--;
    }
    if (call !== mainPrimaryCalls) return;

    // The view that answered may have unmounted while this call resumed; the
    // content then reaches no one, and the next view to mount takes it
    mainPrimaryDelivered = { setEl, unmounted: mainPrimaryMounted === 0 };
    PgCommon.createAndDispatchCustomEvent(
      PgCommon.getStaticStateEventNames(PgView.events.MAIN_PRIMARY_STATIC).set,
      setEl
    );
  }

  /**
   * Announce that the primary main view has mounted and listens for `set`.
   * `Primary` calls it once its listeners are in place; every
   * `setMainPrimary` waiting for a mount goes on from here.
   */
  static announceMainPrimaryMount() {
    mainPrimaryMounted++;
    // Read before the event: a waiting call it releases is the content, and
    // it delivers its own
    const replay =
      mainPrimaryDelivered?.unmounted && !mainPrimaryWaiting
        ? mainPrimaryDelivered
        : undefined;
    if (mainPrimaryDelivered) mainPrimaryDelivered.unmounted = false;
    PgCommon.createAndDispatchCustomEvent(PgView.events.MAIN_PRIMARY_MOUNT);
    if (replay) {
      PgCommon.createAndDispatchCustomEvent(
        PgCommon.getStaticStateEventNames(PgView.events.MAIN_PRIMARY_STATIC)
          .set,
        replay.setEl
      );
    }
  }

  /**
   * Announce that the primary main view has unmounted. The next one to mount
   * gets the content this one had, unless a newer `setMainPrimary` waits for
   * it (`announceMainPrimaryMount`).
   */
  static announceMainPrimaryUnmount() {
    mainPrimaryMounted = Math.max(0, mainPrimaryMounted - 1);
    if (mainPrimaryDelivered && !mainPrimaryMounted) {
      mainPrimaryDelivered.unmounted = true;
    }
  }

  /**
   * Get the minimum height of the main secondary view.
   *
   * @deprecated Read only by the tutorials route, for
   * `setMainSecondaryHeight`, which nothing listens to.
   */
  static getMainSecondaryMinHeight() {
    return PgCommon.convertToPx("2.25rem");
  }

  /**
   * Set secondary main view progress bar percentage.
   *
   * Progress bar will be hidden if `progress` is set to 0.
   *
   * @deprecated Nothing listens since the classic layout went: Flow draws no
   * secondary view. Kept so the deploy and sugar commands, runtime modules
   * this change does not touch, still compile; a progress display for Flow
   * would listen here.
   *
   * @param progress progress percentage in 0-100
   */
  static setMainSecondaryProgress(progress: number) {
    PgCommon.createAndDispatchCustomEvent(
      PgView.events.MAIN_SECONDARY_PROGRESS_SET,
      progress
    );
  }

  /**
   * Set the secondary main view's height.
   *
   * @deprecated Nothing listens since the classic layout went: Flow has no
   * secondary view to resize. Called by `routes/common.tsx` (the
   * `minimizeSecondaryMainView` option) and `routes/tutorials/tutorials.tsx`;
   * removing it means removing those calls.
   *
   * @param height height to set in px
   */
  static setMainSecondaryHeight(height: SetState<number>) {
    PgCommon.createAndDispatchCustomEvent(
      PgView.events.MAIN_SECONDARY_HEIGHT_SET,
      height
    );
  }

  /**
   * Open a modal on top of any already open.
   *
   * `R` is what the caller expects back; nothing checks it against what the
   * modal's code passes to `closeModal`.
   *
   * @param elementable the dialog to open on top
   * @param props component props
   * @returns the modal's id, for `closeModal`, and the answer it closes with
   */
  static openModal<R, P extends Record<string, any> = {}>(
    elementable: NonNullable<Elementable<P>>,
    props?: P
  ): { id: string; answer: Promise<R | null> } {
    const id = uuid();
    const answer = new Promise<R | null>((resolve) => {
      modalAnswers.set(id, resolve as (data: unknown) => void);
    });
    setOpenModals([
      ...openModals,
      { id, elementable, props, opener: focusOpener() },
    ]);
    if (modalHosts === 0) closeIfNoHost(id);
    return { id, answer };
  }

  /**
   * Open a modal on top of any already open, and wait until it closes.
   *
   * @param elementable the dialog to open on top
   * @param props component props
   * @returns what `closeModal` was given when this modal closed
   */
  static async setModal<R, P extends Record<string, any> = {}>(
    elementable: NonNullable<Elementable<P>>,
    props?: P
  ): Promise<R | null> {
    return await PgView.openModal<R, P>(elementable, props).answer;
  }

  /**
   * Say that a `ModalHost` is mounted, so modals are shown. Without one, an
   * open modal is closed after `MODAL_HOST_WAIT`.
   *
   * @returns a disposable to call when the host unmounts
   */
  static attachModalHost(): Disposable {
    modalHosts++;
    hostAttaches++;
    let attached = true;
    return {
      dispose: () => {
        if (!attached) return;
        attached = false;
        modalHosts--;
        if (modalHosts === 0) {
          for (const { id } of openModals) closeIfNoHost(id);
        }
      },
    };
  }

  /** The modals open now, bottom first */
  static getOpenModals(): readonly OpenModal[] {
    return openModals;
  }

  /**
   * Run `cb` with the open modals whenever one opens or closes.
   *
   * @param cb callback to run
   * @returns a disposable to stop listening
   */
  static onDidChangeModals(
    cb: (modals: readonly OpenModal[]) => void
  ): Disposable {
    // The stack itself, not the event's detail: only `setOpenModals` may say
    // what is open
    return PgCommon.onDidChange(PgView.events.MODALS_CHANGE, () =>
      cb(openModals)
    );
  }

  /**
   * Run `cb` whenever a modal opens, a stacked one included; not on close.
   *
   * @param cb callback to run
   * @returns a disposable to stop listening
   */
  static onDidOpenModal(cb: () => void): Disposable {
    let count = openModals.length;
    return PgView.onDidChangeModals((modals) => {
      if (modals.length > count) cb();
      count = modals.length;
    });
  }

  /**
   * Close a modal, answering only the call that opened it. A modal that is
   * already closed is not closed again, and nobody else is answered.
   *
   * The id is required: code that closes "the top modal" closes another
   * dialog's whenever one has opened on its own.
   *
   * @param data the answer for that call
   * @param id the modal to close, from `openModal` or `useModalId`
   */
  static closeModal(data: unknown, id: string) {
    const answer = modalAnswers.get(id);
    if (!answer) return;

    modalAnswers.delete(id);
    justClosedOpener =
      openModals.find((modal) => modal.id === id)?.opener ?? null;
    setTimeout(() => (justClosedOpener = null));
    setOpenModals(openModals.filter((modal) => modal.id !== id));
    answer(data);
  }

  /**
   * Close whichever modal is on top: for a dismissal that is about what the
   * user sees (Escape, a press outside), never for a modal's own code.
   *
   * @param data the answer for the top modal's caller
   */
  static closeTopModal(data: unknown = null) {
    const top = openModals[openModals.length - 1];
    if (top) PgView.closeModal(data, top.id);
  }

  /**
   * Show a notification toast.
   *
   * @param elementable component to show
   * @param props component props and toast options
   */
  static setToast<P extends Record<string, unknown> = Record<string, never>>(
    elementable: Elementable<P & ToastChildProps>,
    props: { componentProps?: P; options: ToastOptions }
  ) {
    return PgCommon.createAndDispatchCustomEvent(PgView.events.TOAST_SET, {
      elementable,
      props,
    });
  }

  /**
   * Close either the given toast or, all toasts if `id` is not given.
   *
   * @param id toast id
   */
  static closeToast(id?: ToastId) {
    return PgCommon.createAndDispatchCustomEvent(PgView.events.TOAST_CLOSE, id);
  }

  /**
   * Set the new item portal container.
   *
   * New item input will be shown if an element is given.
   *
   * @param Element element to set the portal container to
   */
  static setNewItemPortal(Element: Element | null) {
    return PgCommon.createAndDispatchCustomEvent(
      PgView.events.NEW_ITEM_PORTAL_SET,
      Element
    );
  }

  /**
   * Normalize element i.e. convert components to elements and keep elements
   * the same.
   *
   * @param elementable element or component
   * @param props props to pass to the component (unused for elements)
   * @returns the normalized element
   */
  static normalizeElement<
    P extends Record<string, unknown> = Record<string, unknown>
  >(elementable: Elementable<P>, props?: P) {
    if (typeof elementable === "object") return elementable;
    return createElement(elementable, props);
  }
}

export const PgView = declareDecorator(_PgView, {
  derivable: derive,
  updatable: { defaultState, recursive },
});
