import type { ReactNode } from "react";

import { levelVariant, Tag } from "@/shared/ui/tag";
import { cn } from "@/shared/lib/utils";

type BaseDetailTagProps = {
  /**
   * `level` is a tag coloured by the label; every other kind is its icon and
   * name in a soft box, in the label's own case, as the stand draws it
   */
  kind: "level" | "framework" | "languages" | (string & {});
  label: string;
  /** Shown before the label */
  icon?: ReactNode;
  className?: string;
};

function BaseDetailTag({ kind, label, icon, className }: BaseDetailTagProps) {
  if (kind === "level") {
    return (
      <Tag variant={levelVariant(label)} className={className}>
        {label}
      </Tag>
    );
  }
  return (
    <span
      data-slot="detail"
      className={cn(
        "inline-flex w-fit items-center gap-2 rounded-md bg-surface-raised px-3 py-2 font-act text-control text-muted-foreground [&>img]:size-4 [&>svg]:size-4",
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export { BaseDetailTag };
export type { BaseDetailTagProps };
