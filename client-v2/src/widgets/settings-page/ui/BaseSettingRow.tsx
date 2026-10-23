import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

interface BaseSettingRowProps {
  name: string;
  description?: string;
  control: ReactNode;
  /** A control that fits beside the text at any width, such as a switch */
  small?: boolean;
  /** Below `LAYOUT_BREAKPOINTS.phone`: a wide control goes under the text */
  phone: boolean;
}

/** One setting: its name and description, and the control that sets it */
const BaseSettingRow = ({
  name,
  description,
  control,
  small = false,
  phone,
}: BaseSettingRowProps) => {
  const stacked = phone && !small;
  return (
    <div
      data-layout={stacked ? "stacked" : "inline"}
      className={cn(
        "flex gap-3 border-b border-border py-3",
        stacked ? "flex-col" : "items-center justify-between"
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{name}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      <div
        className={cn(
          "flex shrink-0",
          stacked ? "w-full" : "justify-end",
          !stacked && !small && "w-46"
        )}
      >
        {control}
      </div>
    </div>
  );
};

export default BaseSettingRow;
