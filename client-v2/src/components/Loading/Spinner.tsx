import { ComponentPropsWithoutRef, CSSProperties, FC, forwardRef } from "react";

import { PgView } from "../../utils";
import { cn } from "@/shared/lib/utils";

interface SpinnerWithBgProps extends SpinnerProps {
  loading: boolean;
  className?: string;
}

export const SpinnerWithBg: FC<React.PropsWithChildren<SpinnerWithBgProps>> = ({
  loading,
  className,
  children,
  ...spinnerProps
}) => (
  <div
    className={cn(
      "relative h-full w-full",
      "after:absolute after:inset-0 after:z-[-1] after:h-full after:w-full after:bg-transparent after:transition-all after:duration-150 after:ease-linear after:content-['']",
      "[&>.spinner]:hidden",
      // `loading` is also toggled on the element from outside, so the look
      // follows the class rather than the prop
      "[&.loading]:after:z-[1] [&.loading]:after:bg-[var(--backdrop)] [&.loading]:after:backdrop-blur-[12px]",
      "[&.loading>.spinner]:absolute [&.loading>.spinner]:inset-0 [&.loading>.spinner]:z-[2] [&.loading>.spinner]:m-auto [&.loading>.spinner]:block",
      className,
      loading && PgView.classNames.LOADING
    )}
  >
    <Spinner className="spinner" {...spinnerProps} />
    {children}
  </div>
);

interface SpinnerProps extends ComponentPropsWithoutRef<"div"> {
  size?: string;
}

/** The ring is the element's `::after`, centered on the nearest positioned ancestor */
export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  ({ size = "1rem", className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "after:absolute after:inset-0 after:m-auto after:h-[var(--spinner-size)] after:w-[var(--spinner-size)] after:rounded-full after:border-4 after:border-transparent after:border-t-primary after:border-r-primary after:content-['']",
        "after:[animation:pg-spin_0.5s_linear_infinite]",
        className
      )}
      style={{ "--spinner-size": size, ...style } as CSSProperties}
      {...props}
    />
  )
);
