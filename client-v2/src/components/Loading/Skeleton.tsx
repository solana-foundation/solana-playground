import { ComponentPropsWithoutRef, forwardRef } from "react";

import { cn } from "@/shared/lib/utils";

interface SkeletonProps extends ComponentPropsWithoutRef<"div"> {
  height?: string;
  width?: string;
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ height = "1rem", width = "100%", className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative z-[1] overflow-hidden rounded-[12px] bg-surface-raised",
        // The highlight that sweeps across
        "after:absolute after:top-0 after:right-0 after:left-0 after:block after:h-full after:bg-no-repeat after:content-['']",
        "after:bg-[linear-gradient(90deg,var(--surface-raised),var(--surface-hover),var(--surface-raised))]",
        "after:[transform:translateX(-100%)] after:[animation:pg-skeleton_1.25s_ease-in-out_infinite]",
        className
      )}
      style={{ height, width, ...style }}
      {...props}
    />
  )
);
