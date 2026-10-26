import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { createLogger } from "@/shared/lib/logger";
import type { SettingsFocus } from "@/shared/lib/settings-request";
import { Button } from "@/shared/ui/button";

const log = createLogger("settings-page:frame");

export interface SettingsSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface BaseSettingsPageProps {
  sections: SettingsSection[];
  /** The section marked as current in the list */
  current: string;
  /** A click in the list; the page brings the section into view itself */
  onPick: (id: string) => void;
  /** The section being read changed as the user scrolled */
  onCurrentChange: (id: string) => void;
  onBack: () => void;
  /** Below `LAYOUT_BREAKPOINTS.phone`: a bar instead of the section list */
  phone: boolean;
  /** Where focus lands when the page opens */
  focus: SettingsFocus;
  /** Null while a modal opened from the page is up: Escape is the modal's */
  onEscape: (() => void) | null;
}

const headingId = (id: string) => `settings-section-${id}`;

/**
 * The settings as a page of their own (design.md, "Settings as a full page
 * (5.20)"): "Back to app" over the section list at the left, the sections one
 * after another at the right. Fixed over the whole window, so the app beneath
 * it can stay mounted.
 */
const BaseSettingsPage = ({
  sections,
  current,
  onPick,
  onCurrentChange,
  onBack,
  phone,
  focus,
  onEscape,
}: BaseSettingsPageProps) => {
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  // The section being read is the first, in page order, that crosses the
  // upper third of the scroller. An observer reports only the sections whose
  // crossing changed, so the ones crossing are kept here between reports.
  // Only on a wide window: a phone shows no list.
  //
  // A section picked in the list stays current until the user scrolls on
  // their own (`release`): one near the end cannot scroll to the top, so the
  // section before it would still cross the band and take the mark.
  const pinned = useRef(false);
  const release = () => {
    pinned.current = false;
  };
  const ids = sections.map((s) => s.id);
  const order = ids.join(" ");
  useEffect(() => {
    if (phone) return;
    if (typeof IntersectionObserver === "undefined") {
      log.debug("no IntersectionObserver: the list does not follow the scroll");
      return;
    }
    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section;
          if (!id) continue;
          if (entry.isIntersecting) crossing.add(id);
          else crossing.delete(id);
        }
        if (pinned.current) return;
        const first = ids.find((id) => crossing.has(id));
        if (first) onCurrentChange(first);
      },
      { root: scroller.current, rootMargin: "0px 0px -66% 0px" }
    );
    nodes.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
    // `onCurrentChange` and `ids` are fresh every render; `order` says when
    // the sections the observer watches changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, phone]);

  // On open only: the checked network for the cluster row, the rail's dot and
  // the account menu's cluster warning (the first one when the endpoint is one no chip lists, such as a custom
  // URL), the heading otherwise
  useEffect(() => {
    const group = root.current?.querySelector('[role="radiogroup"]');
    const chip =
      group?.querySelector<HTMLElement>(
        '[role="radio"][aria-checked="true"]'
      ) ?? group?.querySelector<HTMLElement>('[role="radio"]');
    const target = focus === "network" ? chip : null;
    (target ?? heading.current)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!onEscape) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      // A layer above the page (an open select or menu) takes its Escape and
      // prevents it; that press closes the layer, not the page
      if (ev.key === "Escape" && !ev.defaultPrevented) onEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onEscape]);

  const pick = (id: string) => {
    onPick(id);
    pinned.current = true;
    nodes.current.get(id)?.scrollIntoView({ block: "start" });
  };

  const title = (
    <h1
      ref={heading}
      tabIndex={-1}
      className={cn(
        "text-foreground outline-none",
        phone ? "text-base font-semibold" : "text-[1.375rem] font-medium"
      )}
    >
      Settings
    </h1>
  );

  return (
    <div
      ref={root}
      role="region"
      aria-label="Settings"
      // The text face throughout, as the prototype sets the page; the app
      // under it is in the code face
      className="fixed inset-0 z-40 flex bg-background font-sans text-foreground"
    >
      {!phone && (
        <aside className="flex w-58 shrink-0 flex-col border-r border-border">
          <div className="flex h-11 shrink-0 items-center border-b border-border px-2">
            <Button
              variant="ghost"
              size="sm"
              className="font-sans text-caption font-normal text-muted-foreground"
              onClick={onBack}
            >
              <ChevronLeft data-icon="inline-start" />
              Back to app
            </Button>
          </div>
          <nav
            aria-label="Settings sections"
            className="flex flex-col gap-0.5 overflow-y-auto p-2"
          >
            {sections.map((s) => (
              <Button
                key={s.id}
                variant="ghost"
                size="sm"
                aria-current={s.id === current ? "true" : undefined}
                className="justify-start font-sans text-caption font-normal text-muted-foreground aria-[current=true]:bg-accent aria-[current=true]:font-medium aria-[current=true]:text-accent-foreground"
                onClick={() => pick(s.id)}
              >
                {s.title}
              </Button>
            ))}
          </nav>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {phone && (
          <div
            data-testid="settings-bar"
            className="flex h-phone-bar shrink-0 items-center gap-2 border-b border-border px-2"
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label="Back to app"
              onClick={onBack}
            >
              <ChevronLeft />
            </Button>
            {title}
          </div>
        )}
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto"
          onWheel={release}
          onTouchMove={release}
          onPointerDown={release}
          onKeyDown={release}
        >
          <div
            className={cn(
              "mx-auto flex max-w-xl flex-col",
              phone ? "gap-8 px-5 py-6" : "gap-10 px-6 py-10"
            )}
          >
            {!phone && title}
            {sections.map((s) => (
              <section
                key={s.id}
                data-section={s.id}
                aria-labelledby={headingId(s.id)}
                className="flex scroll-mt-6 flex-col gap-3"
                ref={(node) => {
                  if (node) nodes.current.set(s.id, node);
                  else nodes.current.delete(s.id);
                }}
              >
                <h2
                  id={headingId(s.id)}
                  className={cn(
                    "border-b border-border pb-2 text-control font-medium text-foreground",
                    phone && "text-title font-act"
                  )}
                >
                  {s.title}
                </h2>
                {s.content}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BaseSettingsPage;
