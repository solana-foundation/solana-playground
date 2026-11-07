/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import { byLevel, LEVEL_FIRST } from "../lib/levels";
import { groupedEyebrow } from "../lib/tutorial-eyebrow";
import type { TutorialItem } from "../model/use-tutorial-list";
import BaseTutorialCard from "./BaseTutorialCard";

export interface BaseTutorialLevelsProps {
  items: readonly TutorialItem[];
  /** A search shows every match, with no Show all */
  searching: boolean;
  /** An Open runs: every card waits for it */
  busy: boolean;
  onOpen: (id: string) => Promise<void>;
}

/**
 * The cards by level, as the tutorial-v2 prototype lays them out
 * (`TutorialLevels`): each level an `h2` with its count, its first four
 * cards, and Show all for the rest, opened in place. A level with four or
 * fewer, like each of the start's today, draws no Show all.
 */
const BaseTutorialLevels = ({
  items,
  searching,
  busy,
  onOpen,
}: BaseTutorialLevelsProps) => {
  const [opened, setOpened] = useState<string[]>([]);
  return (
    <div className="flex flex-col gap-12">
      {byLevel(items).map((g) => {
        const more = !searching && g.items.length > LEVEL_FIRST;
        const open = opened.includes(g.level);
        const shown = more && !open ? g.items.slice(0, LEVEL_FIRST) : g.items;
        const id = `level-${g.level.toLowerCase()}`;
        return (
          <section key={g.level} aria-labelledby={id}>
            <div className="mb-2.5 flex min-h-9 items-baseline gap-2">
              <h2
                id={id}
                className="font-heading text-[1.25rem] leading-[1.5rem] font-medium text-foreground"
              >
                {g.level}
              </h2>
              <span className="text-[1rem] text-subtle tabular-nums">
                {g.items.length}
              </span>
              {more ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={open}
                  onClick={() =>
                    setOpened((o) =>
                      open ? o.filter((l) => l !== g.level) : [...o, g.level]
                    )
                  }
                  className="-mr-2 ml-auto text-[0.8125rem] text-muted-foreground"
                >
                  {open ? "Show less" : "Show all"}
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
                      open ? "-rotate-90" : "rotate-90"
                    )}
                  />
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3">
              {shown.map((t) => (
                <BaseTutorialCard
                  key={t.id}
                  title={t.title}
                  description={t.description}
                  eyebrow={groupedEyebrow(t)}
                  framework={t.framework}
                  progress={t.progress}
                  open={t.open}
                  busy={busy}
                  onOpen={() => onOpen(t.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default BaseTutorialLevels;
