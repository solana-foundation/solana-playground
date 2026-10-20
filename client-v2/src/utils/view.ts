import { createElement, FC } from "react";

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

/**
 * How many `setMainPrimary` calls were made; the last one is the newest. Only
 * "is this the newest call" matters, never the value, so tests must not reset it
 */
let mainPrimaryCalls = 0;

/**
 * Resolve once a primary main view is mounted: at once when the mounted one
 * answers `get`, or when one announces its mount
 * (`PgView.announceMainPrimaryMount`). One listener of each kind per call,
 * removed when it settles, so a long wait under Home piles nothing up.
 * Rejects when the mounted view's getter answers with an error, which a
 * mount would never cure.
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
    MODAL_SET: "viewmodalset",
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
   * never runs. Rejects when the mounted view answers with an error.
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
    await waitForMainPrimary();
    if (call !== mainPrimaryCalls) return;

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
    PgCommon.createAndDispatchCustomEvent(PgView.events.MAIN_PRIMARY_MOUNT);
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
   * Set the current modal and wait until close.
   *
   * @param elementable elementable to set as the modal
   * @param props component props
   * @returns the data from `close` method of the modal
   */
  static async setModal<R, P extends Record<string, any> = {}>(
    elementable: Elementable<P>,
    props?: P
  ): Promise<R | null> {
    return await PgCommon.sendAndReceiveCustomEvent(PgView.events.MODAL_SET, {
      elementable,
      props,
    });
  }

  /**
   * Run `cb` whenever a modal opens, a stacked one included; not on close.
   *
   * @param cb callback to run
   * @returns a disposable to stop listening
   */
  static onDidOpenModal(cb: () => void): Disposable {
    return PgCommon.onDidChange<{ elementable: unknown } | null>(
      PgCommon.getSendAndReceiveEventNames(PgView.events.MODAL_SET).send,
      (detail) => {
        if (detail?.elementable) cb();
      }
    );
  }

  /**
   * Close the current modal.
   *
   * @param data data to be resolved from the modal
   */
  static closeModal(data?: any) {
    PgCommon.createAndDispatchCustomEvent(
      PgCommon.getSendAndReceiveEventNames(PgView.events.MODAL_SET).receive,
      { data }
    );

    PgView.setModal(null);
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
