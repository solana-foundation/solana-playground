import { ChevronRight, GraduationCap, Play, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Logo, LogoMark } from "@/shared/ui/logo";
import type { HomeQuickstart } from "../model/telemetry";
import HomeComposer from "./HomeComposer";

/** What a quick start opens, with what it needs to open it */
export type QuickstartTarget =
  | { id: "continue"; workspace: string }
  | { id: "new"; framework: FrameworkName }
  | { id: "tutorial"; name: string };

export type PhoneQuickstart = QuickstartTarget & {
  title: string;
  description: string;
};

export interface BasePhoneHomeProps {
  /** At most three, in order; `continue` first when there is one */
  quickstarts: readonly PhoneQuickstart[];
  tutorialCount: number;
  /** `null` while loading */
  programCount: number | null;
  /** A rejection is the connected component's to report */
  onQuickstart: (quickstart: PhoneQuickstart) => Promise<void>;
  onBrowse: () => void;
  onAsk: () => void;
}

const ICONS: Record<HomeQuickstart, ReactNode> = {
  continue: <Play aria-hidden="true" />,
  new: <Plus aria-hidden="true" />,
  tutorial: <GraduationCap aria-hidden="true" />,
};

const TILE_TINTS: Record<HomeQuickstart, string> = {
  continue: "bg-brand-purple/15 text-brand-purple",
  new: "bg-brand-green/15 text-brand-green",
  tutorial: "bg-brand-purple/15 text-brand-purple",
};

const BasePhoneHome = ({
  quickstarts,
  tutorialCount,
  programCount,
  onQuickstart,
  onBrowse,
  onAsk,
}: BasePhoneHomeProps) => (
  <section
    aria-label="Home"
    className="flex min-h-0 w-full flex-1 flex-col gap-3 px-4 pt-0 pb-4"
  >
    <div className="flex flex-1 flex-col items-center justify-center gap-5">
      <Logo>
        <LogoMark className="size-12 text-brand-purple" />
      </Logo>
      <h1 className="text-center font-heading text-display font-headline text-foreground">
        Where should we begin?
      </h1>
    </div>

    <nav aria-label="Quick start" className="flex flex-col gap-2">
      {quickstarts.map((q) => (
        <AsyncButton
          key={q.id}
          type="button"
          variant="outline"
          onClick={() => onQuickstart(q)}
          onError={reportButtonFailure}
          className="h-auto min-h-16 w-full justify-start gap-3 rounded-2xl bg-surface-panel px-3 py-2 text-left"
        >
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
              TILE_TINTS[q.id]
            }`}
          >
            {ICONS[q.id]}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {q.title}
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {q.description}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="text-muted-foreground" />
        </AsyncButton>
      ))}
    </nav>

    <HomeComposer
      onAsk={onAsk}
      banner={
        <>
          <span className="flex-1">
            {`${tutorialCount} tutorials, ${programCount ?? "…"} programs`}
          </span>
          <Button variant="secondary" size="sm" onClick={onBrowse}>
            Browse
          </Button>
        </>
      }
    />
  </section>
);

export default BasePhoneHome;
