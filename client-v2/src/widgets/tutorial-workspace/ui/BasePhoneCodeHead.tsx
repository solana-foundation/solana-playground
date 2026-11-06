/* eslint-disable unicorn/no-null -- the explorer names no open file with null */
import { ChevronDown } from "lucide-react";
import type { FC, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export interface BasePhoneCodeHeadProps {
  /** The open file, from the project root (`src/lib.rs`); none yet */
  file: string | null;
  /** The doc page in front, by its title; it names the switcher while shown */
  doc?: string;
  /** The switcher pressed: the Files sheet opens */
  onFiles: () => void;
  /** The Call button, which draws itself only once there is a program */
  call: ReactNode;
}

/**
 * The phone's Code head over the stage (prototype `StepScreen`, the Code
 * section): the name of what is in front, which opens the Files sheet, and
 * Call at the far end. No tabs: one file shows at a time, and the sheet is
 * the way back from `client.ts` to `lib.rs`.
 */
const BasePhoneCodeHead: FC<BasePhoneCodeHeadProps> = ({
  file,
  doc,
  onFiles,
  call,
}) => (
  <div
    data-testid="tutorial-phone-code-head"
    className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface-base pr-4 pl-2"
  >
    <button
      type="button"
      aria-label="Files"
      aria-haspopup="dialog"
      onClick={onFiles}
      className="flex h-11 min-w-0 items-center gap-1.5 rounded-lg px-2 outline-none focus-visible:outline-2 focus-visible:outline-brand-purple active:bg-surface-hover"
    >
      {/* A file reads as code; a page by its title */}
      <span
        className={cn(
          "truncate text-foreground",
          doc === undefined ? "font-mono text-code" : "text-[0.9375rem]"
        )}
      >
        {doc ?? file?.split("/").pop() ?? ""}
      </span>
      <span
        aria-hidden="true"
        className="grid size-[1.375rem] shrink-0 place-items-center rounded-md bg-surface-hover text-muted-foreground"
      >
        <ChevronDown className="size-3.5" />
      </span>
    </button>
    {/* The desktop head's rule after Call divides it from Terminal; here
        nothing follows it */}
    <div className="ml-auto flex shrink-0 items-center [&>[aria-hidden]:last-child]:hidden">
      {call}
    </div>
  </div>
);

export default BasePhoneCodeHead;
