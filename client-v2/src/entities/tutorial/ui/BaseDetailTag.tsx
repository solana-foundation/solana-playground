import type { ReactNode } from "react";

import { levelVariant, Tag } from "@/shared/ui/tag";

type BaseDetailTagProps = {
  /** `level` takes its colour from the label; every other kind is neutral */
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
    <Tag variant="neutral" className={className}>
      {icon}
      {label}
    </Tag>
  );
}

export { BaseDetailTag };
export type { BaseDetailTagProps };
