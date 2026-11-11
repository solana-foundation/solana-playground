import { Share } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { Outlet } from "@/shared/lib/outlet";
import { pagerAttrs } from "@/shared/lib/pager";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";

import type { PhonePage, StagePage, WorkView } from "../model/phone-pages";
import { isWorkView, PHONE_PAGES } from "../model/phone-pages";
import { isCovered, isWorkInFrame, screenOf } from "../model/screen";
import { PHONE_ICONS } from "./phone-icons";

/** The folded console's bar on a phone: a finger's 44 px, not the wide 28 */
const PHONE_CONSOLE_BAR_PX = 44;

/** How long a scroll must rest before it counts as a swipe that settled */
export const SWIPE_SETTLE_MS = 120;

/** How far a finger may drift and still have tapped, not dragged */
const TAP_SLOP_PX = 10;

/** What the pager shows and the callbacks it reports through */
export interface PhonePagerState {
  page: PhonePage;
  /** A swipe settled on another page */
  onSwipe: (page: PhonePage) => void;
  /** A bar's button asked for a page */
  onGo: (page: PhonePage) => void;
  view: WorkView;
  onView: (view: WorkView) => void;
  /** The open project's name, in the work page's bar */
  title: string;
  /** The open file, for the picker; null with no file open */
  file: { dir: string; name: string } | null;
  filesOpen: boolean;
  onFilesOpenChange: (open: boolean) => void;
  /** The stage shows on the work page (Code) at `write`, else on the preview */
  stageOn: StagePage;
  /** The console on the preview: open as a sheet, or its folded bar */
  consoleOpen: boolean;
  /** Shares the open project as a gist; absent with no project open */
  onShare?: () => void;
  /** The sheet's scrim (a button) or Escape (a key) asked to fold the console */
  onConsoleClose: (via: "button" | "key") => void;
}

/** The content and the outlets' nodes the pager lays out */
export interface PhonePagerSlots {
  /** The navigation, which draws its own head and close on the menu page */
  menu: ReactNode;
  assistant: ReactNode;
  files: ReactNode;
  stageBar: ReactNode;
  stageNode: HTMLDivElement;
  consoleNode: HTMLDivElement;
  sheetFont?: CSSProperties;
  /** The status chip (`widgets/status`), after the title in the work page's bar */
  status?: ReactNode;
  /**
   * Home, in place of the work: the work page shows it under "Menu" and the
   * title, with no Chat | Code and no Preview, and there is no preview page
   * and no Files Sheet. The stage and the console are not placed. Given
   * means Home shows; `content` is null while the start is being decided.
   */
  home?: { content: ReactNode };
  /**
   * A page (Tutorials, Programs) on the work page, under "Menu" and the
   * title, with no Chat | Code and no Preview, and no preview page. Under
   * Home it takes Home's place; over the work, the work stays mounted and
   * hidden under it, so closing the page shows it as it was.
   */
  cover?: { content: ReactNode };
}

export type BasePhonePagerProps = PhonePagerState & PhonePagerSlots;

/**
 * A Chat or Code option, the prototype's `PaneOption`: filled when it shows.
 * 32 px drawn in a 40 px switch, as the stage tabs are, so the 60 px bar has
 * air above and below it; the invisible `before` keeps the tap 48 px.
 */
const PANE_OPTION =
  "relative h-8 rounded-lg px-3 text-control font-act data-[state=on]:bg-surface-hover before:absolute before:inset-x-0 before:-inset-y-2";

/** The pages under Home: `PHONE_PAGES` without the preview, indices kept */
const HOME_PAGES: readonly PhonePage[] = PHONE_PAGES.filter(
  (page) => page !== "preview"
);

/** Where a page of the pager starts, as `scrollLeft` */
const alignTo = (el: HTMLElement, index: number) => {
  el.scrollLeft = index * el.clientWidth;
};

/** `alignTo` at once, not by the container's smooth scroll */
const jumpTo = (el: HTMLElement, index: number) => {
  el.style.scrollBehavior = "auto";
  alignTo(el, index);
  el.style.removeProperty("scroll-behavior");
};

/** The bar across the top of a page, the prototype's `PhoneBar` */
const PhoneBar = ({
  children,
  isRuled = true,
}: {
  children: ReactNode;
  isRuled?: boolean;
}) => (
  <div
    data-testid="phone-bar"
    className={cn(
      "relative z-2 flex h-phone-bar shrink-0 items-center gap-1 pr-2 pl-1.5",
      isRuled && "frosted border-b border-border"
    )}
  >
    {children}
  </div>
);

/** The DS ghost button at a fingertip's size, as the prototype's bar buttons are */
const BAR_BUTTON = "size-12 rounded-xl [&_svg:not([class*='size-'])]:size-6";

const BarButton = ({
  label,
  onClick,
  children,
  ...attrs
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
} & Record<`data-${string}`, string>) => (
  <Button
    variant="ghost"
    size="icon"
    aria-label={label}
    onClick={onClick}
    className={BAR_BUTTON}
    {...attrs}
  >
    {children}
  </Button>
);

/** A control in the code's head: the DS ghost button, a fingertip tall */
const HEAD_BUTTON =
  "h-12 min-w-12 rounded-xl text-control font-act [&_svg:not([class*='size-'])]:size-5";

/**
 * Names the open file and opens Files: its folder quiet and cut short first,
 * its name cut short only when it alone is too long. The label names the
 * file whole
 */
const FilePicker = ({
  file,
  onOpen,
}: {
  file: BasePhonePagerProps["file"];
  onOpen: () => void;
}) => (
  <Button
    variant="ghost"
    aria-label={file ? `Files, ${file.name} open` : "Files"}
    onClick={onOpen}
    className={cn(
      HEAD_BUTTON,
      "mr-auto min-w-0 shrink pr-2.5 pl-3 text-foreground [&>svg:first-child]:mr-0.5 [&>svg:first-child]:text-muted-foreground [&>svg:last-child]:ml-0.5 [&>svg:last-child]:size-4 [&>svg:last-child]:text-muted-foreground"
    )}
  >
    {PHONE_ICONS.files}
    {file ? (
      <>
        {file.dir && (
          <span className="min-w-0 shrink-[999] truncate font-read text-muted-foreground">
            {file.dir}
          </span>
        )}
        <span className="min-w-0 truncate">{file.name}</span>
      </>
    ) : (
      <span className="shrink-0 whitespace-nowrap">Files</span>
    )}
    {PHONE_ICONS.down}
  </Button>
);

/**
 * The code's head: which file is open, and the docs. A phone has no tab row
 * (`Tabs`), so this is where the open file is named
 */
const CodeHead = ({ children }: { children: ReactNode }) => (
  <div
    className={cn(
      "flex h-13 shrink-0 items-center gap-2 border-b border-border pr-1 pl-1.5",
      "frosted"
    )}
  >
    {children}
  </div>
);

/**
 * Three pages side by side, swiped between: the navigation, the work (Chat or
 * Code) and the preview. Holds no page state: the page and the view are the caller's.
 * The stage and the console are the outlets' nodes, so they are not remounted
 * by moving between pages or by crossing `LAYOUT_BREAKPOINTS.phone`. With
 * `home` there are two pages, the navigation and Home.
 */
const BasePhonePager = (props: BasePhonePagerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const screen = screenOf(props.home, props.cover);
  // Home or a page holds the work page: no Chat | Code, no preview page
  const covered = isCovered(screen);
  // Under Home (or a page over Home) the work's views are not placed at all
  const workInFrame = isWorkInFrame(screen);
  const pageShown = screen.kind === "page";
  const pages = covered ? HOME_PAGES : PHONE_PAGES;
  // Covered (Home or a page), the preview has no section: Work shows
  const page = pages.includes(props.page) ? props.page : "work";
  const index = pages.indexOf(page);
  // The console's sheet is fixed to the window, so it rises only while the
  // preview, the page that holds it, is the one shown: a run or a funding
  // prompt can move to Work with the console still open, and the sheet would
  // cover Work over an inert preview that no tap reaches
  // TODO(intake: interface-2 carry review, PR 379): the sheet is hand-rolled, with no
  // dialog role, focus trap or return, and its Escape also folds it under a
  // dialog opened above it; the design system's Sheet (side="bottom") brings
  // all of that
  const sheetShown = props.consoleOpen && page === "preview";
  // Escape folds the console's sheet before anything under it hears the key
  // (Spec 08: Escape closes the log). The Files sheet opens over it and
  // takes its own Escape.
  const { filesOpen, onConsoleClose } = props;
  useEffect(() => {
    if (!sheetShown || filesOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onConsoleClose("key");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [sheetShown, filesOpen, onConsoleClose]);
  // Smooth by CSS (`motion-safe:scroll-smooth`: with reduced motion the page
  // changes at once, and the jump settles the same way). The scroll this
  // causes settles on the page given, so the settle finds the page already
  // current and `onSwipe` is not called for it.
  // The first alignment, on load, is instant: arriving is not a move
  const aligned = useRef(false);
  // A move the pager made itself and that has not settled yet. Something can
  // cut its smooth scroll short (a dialog opening as the page changes, as New
  // project's gallery does from the menu page), and the snap then pulls the
  // pages back where they were: that settle is finished, not read as a swipe.
  // Set only when the alignment has somewhere to go (a swipe's own report
  // re-renders on the page already shown), and cleared by the next settle or
  // by a drag, wheel or key on the pager, which hand the scroll to the user.
  // A click or a tap on a control in a page moves nothing: Chat chosen while
  // the pager scrolled back to Work once cleared it, the snap carried on to
  // Preview, and that settle was reported as a swipe.
  const moving = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (aligned.current) {
      moving.current = Math.abs(el.scrollLeft - index * el.clientWidth) >= 1;
      alignTo(el, index);
      return;
    }
    aligned.current = true;
    jumpTo(el, index);
  }, [index]);
  // A rotation changes the page width: put the page back, not between two
  useEffect(() => {
    const align = () => alignTo(ref.current!, index);
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [index]);
  // `scrollend` is missing on Safari before 26
  // (https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event#browser_compatibility),
  // so a rest of the scroll stands in for it
  const settle = useRef<number>(undefined);
  // A finger resting mid-drag fires no scroll events, so a rest is not a
  // settle while a touch is down; it is one when the finger lifts
  const touching = useRef(false);
  // Where a touch began, and whether the pager was moving then: a touch that
  // lifts where it began was a tap, and the move stays the pager's
  const touchStart = useRef({ x: 0, moving: false });
  const armSettle = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el || el.clientWidth === 0 || touching.current) return;
      // A scroll position read before the pages re-render (Home or a page
      // coming or going changes their number) may index past the list
      const at = pages[Math.round(el.scrollLeft / el.clientWidth)];
      if (moving.current) {
        moving.current = false;
        if (at !== page) jumpTo(el, index);
        return;
      }
      if (at && at !== page) props.onSwipe(at);
    }, SWIPE_SETTLE_MS);
  };
  // Native listeners, not React props: the stage and the console are portaled
  // outlets whose React parent is the shell, so a React `touchstart` that
  // begins inside them never bubbles to the pager. DOM bubbling counts them.
  const armSettleRef = useRef(armSettle);
  armSettleRef.current = armSettle;
  useEffect(() => {
    const el = ref.current!;
    const down = (e: TouchEvent) => {
      touching.current = true;
      touchStart.current = {
        x: e.touches[0]?.clientX ?? 0,
        moving: moving.current,
      };
      moving.current = false;
      window.clearTimeout(settle.current);
    };
    const userScroll = () => {
      moving.current = false;
    };
    const up = (e: TouchEvent) => {
      touching.current = false;
      const x = e.changedTouches[0]?.clientX;
      const tapped =
        x !== undefined && Math.abs(x - touchStart.current.x) < TAP_SLOP_PX;
      if (tapped) moving.current = touchStart.current.moving;
      armSettleRef.current();
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", up, { passive: true });
    el.addEventListener("wheel", userScroll, { passive: true });
    el.addEventListener("keydown", userScroll);
    return () => {
      el.removeEventListener("wheel", userScroll);
      el.removeEventListener("keydown", userScroll);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
    };
  }, []);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  return (
    <div
      ref={ref}
      data-testid="phone-pager"
      {...pagerAttrs}
      onScroll={armSettle}
      className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden motion-safe:scroll-smooth [scrollbar-width:none]"
    >
      <section
        aria-label="Navigation"
        inert={page !== "menu"}
        className="flex h-full w-full shrink-0 snap-start flex-col"
      >
        {/* The navigation draws its own head, the logo and its close */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {props.menu}
        </div>
      </section>
      <section
        aria-label="Work"
        inert={page !== "work"}
        className="flex h-full w-full shrink-0 snap-start flex-col"
      >
        {/* A page with its own large title (its `title` empty): no name and no
            rule, since the heading right below already starts the page */}
        <PhoneBar isRuled={screen.kind !== "page" || props.title !== ""}>
          <BarButton
            label="Menu"
            // The phone's way to the navigation, as the stock Sidebar's own
            // trigger is in the frame: where focus goes when the control it
            // left is gone (Flow's `fallbackFocus`)
            data-sidebar="trigger"
            onClick={() => props.onGo("menu")}
          >
            {PHONE_ICONS.menu}
          </BarButton>
          {/* The name keeps at least six characters, and the status chip
              gives way first, down to its dot. Ten pushed the bar 17px past a
              390 screen and Run off its edge: menu, chip, Chat and Code and
              Run leave the name about 80px there */}
          <span className="min-w-[6ch] flex-1 truncate pl-0.5 text-title font-act text-foreground">
            {props.title}
          </span>
          {props.status}
          {!covered && (
            <>
              {/* Two views of one session, one filled: the prototype's
                `PaneSwitch`, 40 tall in the bar at the control type */}
              <Segmented
                aria-label="Show"
                variant="boxed"
                className="shrink-0 gap-0.5 rounded-xl bg-surface-panel p-1"
                value={props.view}
                onValueChange={(v) => {
                  if (isWorkView(v)) props.onView(v);
                }}
              >
                <SegmentedItem value="chat" className={PANE_OPTION}>
                  Chat
                </SegmentedItem>
                <SegmentedItem value="code" className={PANE_OPTION}>
                  Code
                </SegmentedItem>
              </Segmented>
              <BarButton
                label="Preview the build"
                onClick={() => props.onGo("preview")}
              >
                {PHONE_ICONS.preview}
              </BarButton>
            </>
          )}
        </PhoneBar>
        {screen.kind === "page" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {screen.cover.content}
          </div>
        )}
        {screen.kind === "home" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {screen.home.content}
          </div>
        )}
        {workInFrame && (
          <>
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                (pageShown || props.view !== "chat") && "hidden"
              )}
            >
              {props.assistant}
            </div>
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                (pageShown || props.view !== "code") && "hidden"
              )}
            >
              <CodeHead>
                <FilePicker
                  file={props.file}
                  onOpen={() => props.onFilesOpenChange(true)}
                />
                {/* The two icons touch: their 48 px targets stay, and the
                    icons read as one pair, not two far apart */}
                <div className="flex items-center">
                  {props.onShare && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={HEAD_BUTTON}
                      aria-label="Share as a gist"
                      onClick={props.onShare}
                    >
                      <Share aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className={HEAD_BUTTON}
                  >
                    <a
                      href="https://solana.com/docs"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Documentation"
                    >
                      {PHONE_ICONS.help}
                    </a>
                  </Button>
                </div>
              </CodeHead>
              {props.stageOn === "work" && (
                <Outlet
                  node={props.stageNode}
                  className="flex min-h-0 flex-1 flex-col"
                />
              )}
            </div>
          </>
        )}
      </section>
      {workInFrame && (
        <>
          {/* Hidden, not unmounted, under a page: the stage and the console
            keep their outlets, so the terminal is not re-attached on the way
            back */}
          <section
            aria-label="Preview"
            inert={page !== "preview"}
            hidden={pageShown}
            className="flex h-full w-full shrink-0 snap-start flex-col"
          >
            <PhoneBar>
              <BarButton
                label="Back to the code"
                onClick={() => props.onGo("work")}
              >
                {PHONE_ICONS.back}
              </BarButton>
              {/* A horizontal scroller clips vertically too, at its padding
                  edge: 4 px over and under the 40 px pill keep the tabs'
                  invisible `before` whole, so each still taps at 48 px */}
              <div className="min-w-0 flex-1 overflow-x-auto py-1">
                {props.stageBar}
              </div>
            </PhoneBar>
            {props.stageOn === "preview" && (
              <Outlet
                node={props.stageNode}
                className="flex min-h-0 flex-1 flex-col"
              />
            )}
            {/* Closed, the console is its bar at the foot: the body stays
                mounted (the terminal keeps its buffer) and is clipped, as on
                wide. Open, the same outlet rises as a sheet over the stage
                (Spec 08, "Show full log" opens a sheet below 768 px), so the
                stage keeps its size under it; the slot keeps the bar's height
                so nothing below moves. */}
            <div className="shrink-0" style={{ height: PHONE_CONSOLE_BAR_PX }}>
              {/* The Sheet's motion; the scrim darker than the Sheet's 10%,
                  which does not read on the dark ground */}
              {sheetShown && (
                <div
                  aria-hidden
                  data-slot="console-sheet-scrim"
                  onClick={() => props.onConsoleClose("button")}
                  className="fixed inset-0 z-50 bg-black/60 duration-100 animate-in fade-in-0 supports-backdrop-filter:backdrop-blur-xs motion-reduce:animate-none"
                />
              )}
              <div
                data-slot="console-sheet"
                data-state={sheetShown ? "open" : "closed"}
                className={cn(
                  "flex h-full min-h-0 flex-col overflow-hidden",
                  sheetShown &&
                    "fixed inset-x-0 bottom-0 z-50 h-[85dvh] rounded-t-2xl border border-b-0 border-border shadow-lg duration-200 animate-in fade-in-0 slide-in-from-bottom-10 motion-reduce:animate-none"
                )}
              >
                <Outlet
                  node={props.consoleNode}
                  className="flex min-h-0 flex-1 flex-col"
                />
              </div>
            </div>
          </section>
          <Sheet open={props.filesOpen} onOpenChange={props.onFilesOpenChange}>
            <SheetContent
              side="left"
              aria-describedby={undefined}
              className="w-full p-0 data-[side=left]:w-full data-[side=left]:sm:max-w-full"
              style={props.sheetFont}
            >
              <SheetTitle className="px-4 pt-4">Files</SheetTitle>
              {props.files}
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
};

export default BasePhonePager;
