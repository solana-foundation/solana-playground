import { ComponentPropsWithoutRef, CSSProperties, forwardRef } from "react";

import { cn } from "@/shared/lib/utils";

interface ThreeDotsProps extends ComponentPropsWithoutRef<"div"> {
  width?: string;
  height?: string;
  distance?: string;
}

/** Three dots that fade in turn: the middle one is the element, the others its pseudo-elements */
export const ThreeDots = forwardRef<HTMLDivElement, ThreeDotsProps>(
  (
    {
      width = "0.5rem",
      height = "0.5rem",
      distance = "1rem",
      className,
      style,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        "relative h-[var(--dot-height)] w-[var(--dot-width)] rounded-[12px] bg-[var(--bg)]",
        "[--bg-fade:color-mix(in_srgb,var(--primary)_9%,transparent)] [--bg:var(--primary)]",
        "[animation:pg-three-dots_1s_linear_0.5s_infinite_alternate]",
        "before:absolute before:top-0 before:inline-block before:h-[var(--dot-height)] before:w-[var(--dot-width)] before:rounded-[12px] before:bg-[var(--bg)] before:content-['']",
        "before:left-[calc(var(--distance)*-1)] before:[animation:pg-three-dots_1s_ease_0s_infinite_alternate]",
        "after:absolute after:top-0 after:inline-block after:h-[var(--dot-height)] after:w-[var(--dot-width)] after:rounded-[12px] after:bg-[var(--bg)] after:content-['']",
        "after:left-[var(--distance)] after:[animation:pg-three-dots_1s_ease_1s_infinite_alternate]",
        className
      )}
      style={
        {
          "--dot-width": width,
          "--dot-height": height,
          "--distance": distance,
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  )
);
