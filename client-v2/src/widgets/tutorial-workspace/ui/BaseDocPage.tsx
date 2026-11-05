import { ExternalLink } from "lucide-react";
import type { FC } from "react";

import Markdown from "@/components/Markdown";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("tutorial-workspace:doc-page");

export interface BaseDocPageProps {
  title: string;
  /** The page on its own site, `https` */
  url: string;
  /** The page as the tutorial keeps it */
  markdown: string;
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

/**
 * A doc page in the editor's place (spec "Docs open as read-only tabs"):
 * the tutorial's own Markdown, read only, under a strip with its title and
 * a link to the page on its own site, which opens in a new tab. The sites
 * refuse to be framed, so the page is never theirs (design D10 of
 * `tutorial-flow-v2`).
 */
const BaseDocPage: FC<BaseDocPageProps> = ({ title, url, markdown }) => (
  <article
    aria-label={title}
    data-testid="tutorial-doc-page"
    className="flex min-h-0 flex-1 flex-col bg-surface"
  >
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-4 text-caption">
      <span className="min-w-0 truncate text-muted-foreground">
        {title} · read only
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[72ch] px-6 py-6">
        <Markdown>{markdown}</Markdown>
      </div>
    </div>
  </article>
);

export default BaseDocPage;
