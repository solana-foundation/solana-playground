import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/shared/ui/field";
import { Tag } from "@/shared/ui/tag";

interface BaseSettingRowProps {
  name: string;
  description?: string;
  /** A tag after the name, such as "Experimental" */
  tag?: string;
  control: ReactNode;
  /** The control's id, so the name labels it and a press on the name reaches it */
  controlId?: string;
  /** A control that fits beside the text at any width, such as a switch */
  small?: boolean;
  /** Below `LAYOUT_BREAKPOINTS.phone`: a wide control goes under the text */
  phone: boolean;
}

/**
 * One setting as the design system's setting row: its name and one help
 * line, and the control that sets it. The card around it draws the hairlines.
 */
const BaseSettingRow = ({
  name,
  description,
  tag,
  control,
  controlId,
  small = false,
  phone,
}: BaseSettingRowProps) => {
  const stacked = phone && !small;
  return (
    <Field
      orientation="horizontal"
      data-layout={stacked ? "stacked" : "inline"}
      className={cn(
        "min-h-14 gap-6 px-4 py-3",
        stacked && "flex-col items-stretch gap-2.5"
      )}
    >
      <FieldContent className="min-w-0">
        <FieldLabel
          htmlFor={controlId}
          className={cn(
            "text-caption font-act text-foreground",
            phone && "text-control"
          )}
        >
          {name}
          {tag && <Tag>{tag}</Tag>}
        </FieldLabel>
        {description && (
          <FieldDescription
            className={cn("text-xs", phone && "text-caption font-read")}
          >
            {description}
          </FieldDescription>
        )}
      </FieldContent>
      <div
        className={cn(
          "flex shrink-0",
          stacked ? "w-full" : "justify-end self-center",
          !stacked && !small && "w-46"
        )}
      >
        {control}
      </div>
    </Field>
  );
};

export default BaseSettingRow;
