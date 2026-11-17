import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef } from "react";

import Markdown from "@/components/Markdown";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("tutorial-workspace:doc-page");

/** A section a link asked for; a second press of the same link is a new request and scrolls again */
export interface DocSectionRequest {
  /** The heading's id on the page */
  id: string;
  /** Counted up by the workspace per request; the scroll effect keys on it */
  seq: number;
}

export interface BaseDocPageProps {
  title: string;
  /** The page on its own site, `https` */
  url: string;
  /** The page as the tutorial keeps it */
  markdown: string;
  /**
   * The heading to bring to the top of the page's scroll area; the page
   * stays where it is when it has no such heading. A request for another
   * page never reaches this one: the workspace passes only its own
   */
  section?: DocSectionRequest;
  /**
   * On the phone the strip reads "Read only" alone: the head's picker above
   * already names the page, and at 390 px the title cut off the words that
   * matter
   */
  phone?: boolean;
}

/** The site's name as a link reads it: `anchor-lang.com` */
const siteOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    // The check admits `https` addresses only, so this is a page it did not
    // check; the full address still reads
    log.warn("a doc page's address is not a URL", { context: { url } });
    return url;
  }
};

/** The headings inside the page's scroll area */
const headingsIn = (scroller: HTMLElement) =>
  Array.from(scroller.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));

/** The heading with this id inside the page's scroll area, by the ids `headingIds` gave them */
const headingIn = (scroller: HTMLElement, id: string) =>
  headingsIn(scroller).find((heading) => heading.id === id);

/** The ids the page's headings carry, for the log when a link names another */
const headingIdsIn = (scroller: HTMLElement) =>
  headingsIn(scroller).map((heading) => heading.id);

/**
 * A doc page in the editor's place (spec "Docs open as read-only tabs"):
 * the tutorial's own Markdown, read only, under a strip with its title and
 * a link to the page on its own site, which opens in a new tab. The sites
 * refuse to be framed, so the page is never theirs (design D10 of
 * `tutorial-flow-v2`). A `section` scrolls the page's own area to that
 * heading (spec "A doc link's section opens the page at that heading"); the
 * area scrolls itself, never its ancestors, so the chat beside it stays
 */
const BaseDocPage: FC<BaseDocPageProps> = ({
  title,
  url,
  markdown,
  section,
  phone = false,
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  // The request's fields, so a stable or memoised object still scrolls again
  // when its `seq` moves
  const sectionId = section?.id;
  const sectionSeq = section?.seq;
  useEffect(() => {
    const area = scroller.current;
    if (!area || sectionId === undefined) return;
    const heading = headingIn(area, sectionId);
    if (!heading) {
      // The link named a section the page lacks: the page stays where it is,
      // at its top when it has just opened. Warned, since production drops
      // debug and this is how an assistant that invents sections shows; the
      // page's own ids tell an invented id from a scan that disagreed
      log.warn("a doc link named a section the page lacks", {
        context: {
          title,
          url,
          section: sectionId,
          headings: headingIdsIn(area),
        },
      });
      return;
    }
    // The area is the headings' offset parent (`relative`), so this is the
    // heading's distance from the area's top
    area.scrollTop = heading.offsetTop;
  }, [sectionId, sectionSeq, title, url]);

  return (
    <article
      aria-label={title}
      data-testid="tutorial-doc-page"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4 text-caption">
        <span className="min-w-0 truncate text-muted-foreground">
          {phone ? "Read only" : `${title} · read only`}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open on {siteOf(url)}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[72ch] px-6 py-6">
          <Markdown headingIds>{markdown}</Markdown>
        </div>
      </div>
    </article>
  );
};

export default BaseDocPage;
