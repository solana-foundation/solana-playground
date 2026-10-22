import { cn } from "cn";
import { ChevronDown, ChevronLeft, Folder, Menu, Play, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Outlet } from "@/shared/lib/outlet";
import { BOTTOM_BAR_PX } from "@/views/flow/tokens";
import { Button } from "@/shared/ui/button";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";
import { isCovered, isWorkInFrame, screenOf } from "../model/screen";
import { PHONE_PAGES, isWorkView } from "../model/phone-pages";
import type { PhonePage, StagePage, WorkView } from "../model/phone-pages";

/** How long a scroll must rest before it counts as a swipe that settled */
export const SWIPE_SETTLE_MS = 120;

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
  /** The console's height on the preview: open, or its folded bar */
  consoleOpen: boolean;
}

/** The content and the outlets' nodes the pager lays out */
export interface PhonePagerSlots {
  menu: ReactNode;
  assistant: ReactNode;
  files: ReactNode;
  stageBar: ReactNode;
  stageNode: HTMLDivElement;
  consoleNode: HTMLDivElement;
  sheetFont?: CSSProperties;
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

/** The pages under Home: `PHONE_PAGES` without the preview, indices kept */
const HOME_PAGES: readonly PhonePage[] = PHONE_PAGES.filter(
  (page) => page !== "preview"
);

/** Where a page of the pager starts, as `scrollLeft` */
const alignTo = (el: HTMLElement, index: number) => {
  el.scrollLeft = index * el.clientWidth;
};

const PhoneBar = ({ children }: { children: ReactNode }) => (
  <div
    data-testid="phone-bar"
    className="flex h-phone-bar shrink-0 items-center gap-2 border-b border-border px-2"
  >
    {children}
  </div>
);

/** "src/ lib.rs": names the open file and opens Files */
const FilePicker = ({
  file,
  onOpen,
}: {
  file: BasePhonePagerProps["file"];
  onOpen: () => void;
}) => (
  <button
    type="button"
    aria-label={file ? `Files, ${file.name} open` : "Files"}
    onClick={onOpen}
    className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-4 text-sm"
  >
    <Folder className="size-4" aria-hidden />
    {file && <span className="text-muted-foreground">{file.dir}</span>}
    <span className="font-semibold">{file?.name ?? "Files"}</span>
    <ChevronDown className="size-4" aria-hidden />
  </button>
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
  // Smooth by CSS (`scroll-smooth`). The scroll this causes settles on the
  // page given, so the settle finds the page already current and `onSwipe`
  // is not called for it.
  // The first alignment, on load, is instant: arriving is not a move
  const aligned = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current!;
    if (aligned.current) {
      alignTo(el, index);
      return;
    }
    aligned.current = true;
    el.style.scrollBehavior = "auto";
    alignTo(el, index);
    el.style.removeProperty("scroll-behavior");
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
  const armSettle = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el || el.clientWidth === 0 || touching.current) return;
      // A scroll position read before the pages re-render (Home or a page
      // coming or going changes their number) may index past the list
      const at = pages[Math.round(el.scrollLeft / el.clientWidth)];
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
    const down = () => {
      touching.current = true;
      window.clearTimeout(settle.current);
    };
    const up = () => {
      touching.current = false;
      armSettleRef.current();
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchend", up, { passive: true });
    el.addEventListener("touchcancel", up, { passive: true });
    return () => {
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
      onScroll={armSettle}
      className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none]"
    >
      <section
        aria-label="Navigation"
        inert={page !== "menu"}
        className="flex h-full w-full shrink-0 snap-start flex-col"
      >
        <PhoneBar>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close the menu"
            onClick={() => props.onGo("work")}
          >
            <X />
          </Button>
        </PhoneBar>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {props.menu}
        </div>
      </section>
      <section
        aria-label="Work"
        inert={page !== "work"}
        className="flex h-full w-full shrink-0 snap-start flex-col"
      >
        <PhoneBar>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Menu"
            onClick={() => props.onGo("menu")}
          >
            <Menu />
          </Button>
          <span className="min-w-0 flex-1 truncate font-semibold">
            {props.title}
          </span>
          {!covered && (
            <>
              <Segmented
                aria-label="Show"
                value={props.view}
                onValueChange={(v) => {
                  if (isWorkView(v)) props.onView(v);
                }}
              >
                <SegmentedItem value="chat">Chat</SegmentedItem>
                <SegmentedItem value="code">Code</SegmentedItem>
              </Segmented>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Preview the build"
                onClick={() => props.onGo("preview")}
              >
                <Play />
              </Button>
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
              <FilePicker
                file={props.file}
                onOpen={() => props.onFilesOpenChange(true)}
              />
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
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to the code"
                onClick={() => props.onGo("work")}
              >
                <ChevronLeft />
              </Button>
              <div className="min-w-0 flex-1 overflow-x-auto">
                {props.stageBar}
              </div>
            </PhoneBar>
            {props.stageOn === "preview" && (
              <Outlet
                node={props.stageNode}
                className="flex min-h-0 flex-1 flex-col"
              />
            )}
            <Outlet
              node={props.consoleNode}
              // Closed, the console is its bar: the body stays mounted (the
              // terminal keeps its buffer) and is clipped, as on wide
              className={cn(
                "flex min-h-0 flex-col",
                props.consoleOpen ? "h-2/5" : "overflow-hidden"
              )}
              style={props.consoleOpen ? undefined : { height: BOTTOM_BAR_PX }}
            />
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
