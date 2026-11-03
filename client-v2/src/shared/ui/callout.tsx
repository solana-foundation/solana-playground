import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

/* A note inside a page or a form: a tint and a hairline, calm enough to read
   past. Alert is for the page as a whole; a callout is for the place it sits. */
const calloutVariants = cva(
  "group/callout relative grid w-full gap-0.5 rounded-xl border px-3.5 py-3 text-left text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-border bg-surface-panel text-foreground *:[svg]:text-muted-foreground",
        info: "border-brand-purple/25 bg-brand-purple/[0.07] text-foreground *:[svg]:text-brand-purple",
        warning:
          "border-warning/20 bg-warning/[0.07] text-warning-ink *:[svg]:text-warning",
        success:
          "border-success/20 bg-success/[0.07] text-foreground *:[svg]:text-success",
        error:
          "border-error/25 bg-error/[0.07] text-foreground *:[svg]:text-error",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Callout({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof calloutVariants>) {
  return (
    <div
      data-slot="callout"
      data-variant={variant}
      role={variant === "error" || variant === "warning" ? "alert" : "note"}
      className={cn(calloutVariants({ variant }), className)}
      {...props}
    />
  );
}

function CalloutTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="callout-title"
      className={cn("font-act group-has-[>svg]/callout:col-start-2", className)}
      {...props}
    />
  );
}

function CalloutDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="callout-description"
      className={cn(
        "font-read text-pretty opacity-90 group-has-[>svg]/callout:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  );
}

/* What the callout asks you to do: its buttons under the text, the answer it
   expects filled. Under, not beside: a row that put them on the right broke
   them onto a line of their own at some widths and not others. On a phone
   they run the width, a finger's 44 tall. The buttons take the page's text
   colour, not the callout's: in a warning's yellow ink an outlined button
   read as a link */
function CalloutActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="callout-actions"
      className={cn(
        "mt-2 flex flex-wrap gap-2 text-foreground group-has-[>svg]/callout:col-start-2 max-md:flex-col max-md:*:h-11 max-md:*:w-full",
        className
      )}
      {...props}
    />
  );
}

export {
  Callout,
  CalloutActions,
  CalloutDescription,
  CalloutTitle,
  calloutVariants,
};
