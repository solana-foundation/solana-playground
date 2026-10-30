import { ComponentPropsWithoutRef, forwardRef } from "react";

import { cn } from "@/shared/lib/utils";

const Topbar = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "sticky top-0 flex w-full items-center justify-between border-b border-border bg-surface-base font-sans shadow-none",
        className
      )}
      {...props}
    />
  )
);

export default Topbar;
