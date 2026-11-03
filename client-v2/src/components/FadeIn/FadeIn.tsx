import { ComponentPropsWithoutRef, forwardRef } from "react";

import { cn } from "@/shared/lib/utils";

interface FadeInProps extends ComponentPropsWithoutRef<"div"> {
  /** The theme's short, medium and long transition: 50, 150 and 250ms */
  duration?: "short" | "medium" | "long";
}

const DURATION_CLASSES = {
  short: "[animation:pg-fade-in_50ms_linear_backwards]",
  medium: "[animation:pg-fade-in_150ms_linear_backwards]",
  long: "[animation:pg-fade-in_250ms_linear_backwards]",
};

// `backwards`, not `forwards`: the end state is the element's own opacity,
// and an animation that keeps filling after it ends keeps the stacking
// context it made. `AppLazy` wraps the whole page in one, which puts
// everything inside it, Flow's `PortalAbove` among it, at level 0 under
// anything on `body` with a z-index (the layout shell's Sheets). Menus and
// dialogs portal to `body` through Radix, so they no longer sink, but a fill
// that stayed would still trap whatever else renders inside the page.
const FadeIn = forwardRef<HTMLDivElement, FadeInProps>(
  ({ duration = "short", className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(DURATION_CLASSES[duration], className)}
      {...props}
    />
  )
);

export default FadeIn;
