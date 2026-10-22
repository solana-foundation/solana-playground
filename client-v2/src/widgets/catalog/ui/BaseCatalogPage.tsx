import { Search } from "lucide-react";
import type { VariantProps } from "class-variance-authority";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  ActionCard,
  ActionCardAction,
  ActionCardContent,
  ActionCardDescription,
  ActionCardEyebrow,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
} from "@/shared/ui/action-card";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Empty, EmptyDescription } from "@/shared/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/ui/input-group";
import { Tag } from "@/shared/ui/tag";
import type { tagVariants } from "@/shared/ui/tag";

export interface CatalogTag {
  label: string;
  variant?: VariantProps<typeof tagVariants>["variant"];
}

/** One card: a tutorial or a program, as the page draws it */
export interface CatalogCard {
  /** What `onOpen` gets back: a tutorial's name, a program's repo */
  id: string;
  title: string;
  description: string;
  /** The thumbnail or icon */
  media: string;
  tags: CatalogTag[];
  /** This card's Open, while it runs or once it failed; none otherwise */
  open?: CardOpen;
}

/** A card's Open: running, with what it is doing, or failed, with why */
export type CardOpen =
  | { state: "running"; text?: string }
  | { state: "failed"; message: string };

/** The list behind the cards: still loading, read, or not readable */
export type CatalogList =
  | { state: "loading" }
  | { state: "ready"; cards: CatalogCard[] }
  | { state: "failed"; message: string; onRetry: () => void };

export interface BaseCatalogPageProps {
  /** The page's things, plural and lowercase: "tutorials", "programs" */
  label: string;
  query: string;
  onQuery: (query: string) => void;
  /** The cards matching `query`, once the list is read */
  list: CatalogList;
  /** An Open runs: every card's Open and title wait for it */
  busy: boolean;
  /**
   * Open the card's item. Settles when the Open is over; a failure comes
   * back as the card's `open`, so this never rejects for one
   */
  onOpen: (id: string) => Promise<void>;
}

/**
 * A page of cards with a search field over them, as the prototype draws
 * Tutorials and Programs: two columns from 720 px, one below. Below 768 px
 * the card's own Open is hidden (`ActionCardAction`) and the whole card opens
 * through its title. One Open at a time: while one runs (`busy`) every
 * card's Open and title are disabled.
 */
const BaseCatalogPage = ({
  label,
  query,
  onQuery,
  list,
  busy,
  onOpen,
}: BaseCatalogPageProps) => {
  let body;
  if (list.state === "failed") {
    body = (
      <div role="alert" className="flex items-center gap-3 text-control">
        <span className="text-error">{list.message}</span>
        <Button variant="outline" onClick={list.onRetry}>
          Retry
        </Button>
      </div>
    );
  } else if (list.state === "loading") {
    body = (
      <p className="text-control text-muted-foreground">{`Loading ${label}…`}</p>
    );
  } else if (list.cards.length === 0) {
    body = (
      <Empty className="p-0">
        <EmptyDescription>{`No ${label} match “${query}”.`}</EmptyDescription>
      </Empty>
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2">
        {list.cards.map((c) => (
          <ActionCard key={c.id}>
            <ActionCardMedia variant="image">
              <img src={c.media} alt="" />
            </ActionCardMedia>
            <ActionCardContent>
              <ActionCardEyebrow className="flex flex-wrap items-center gap-1.5">
                {c.tags.map((t, i) => (
                  // A framework and a category can share a label
                  // eslint-disable-next-line react/no-array-index-key
                  <Tag key={i} variant={t.variant}>
                    {t.label}
                  </Tag>
                ))}
              </ActionCardEyebrow>
              <ActionCardTitle>
                <ActionCardLink asChild>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onOpen(c.id)}
                  >
                    {c.title}
                  </button>
                </ActionCardLink>
              </ActionCardTitle>
              <ActionCardDescription>{c.description}</ActionCardDescription>
              {c.open?.state === "running" && c.open.text ? (
                <p className="text-caption text-muted-foreground">
                  {c.open.text}
                </p>
              ) : null}
              {c.open?.state === "failed" ? (
                <p role="alert" className="text-caption text-error">
                  {c.open.message}
                </p>
              ) : null}
            </ActionCardContent>
            <ActionCardAction>
              <AsyncButton
                type="button"
                variant="outline"
                aria-label={`Open ${c.title}`}
                disabled={busy}
                onClick={() => onOpen(c.id)}
                onError={reportButtonFailure(`open ${c.title}`)}
              >
                Open
              </AsyncButton>
            </ActionCardAction>
          </ActionCard>
        ))}
      </div>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-8">
      <InputGroup className="max-w-80">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder={`Search ${label}`}
          aria-label={`Search ${label}`}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </InputGroup>
      {body}
    </section>
  );
};

export default BaseCatalogPage;
