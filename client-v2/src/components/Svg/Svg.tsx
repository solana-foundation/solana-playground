import { ComponentPropsWithoutRef, forwardRef } from "react";

import { PgTheme, ThemeColor } from "../../utils";
import { cn } from "@/shared/lib/utils";

export interface SvgProps extends ComponentPropsWithoutRef<"svg"> {
  color?: ThemeColor;
  rotate?: "90deg" | "180deg" | "270deg";
}

const ROTATE_CLASSES = {
  "90deg": "rotate-90",
  "180deg": "rotate-180",
  "270deg": "rotate-[270deg]",
};

/** `<svg>` with the playground's defaults: inline, sized and coloured from props */
const Svg = forwardRef<SVGSVGElement, SvgProps>(
  ({ children, color, rotate, className, style, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/Svg"
      stroke="currentColor"
      fill="currentColor"
      strokeWidth="0"
      width="1em"
      height="1em"
      // Preflight makes an svg a block in the middle of the line; it was
      // inline on the baseline
      className={cn(
        "inline align-baseline [transition:color_50ms_linear]",
        rotate && ROTATE_CLASSES[rotate],
        className
      )}
      style={color ? { color: PgTheme.getColor(color), ...style } : style}
      {...props}
    >
      {children}
    </svg>
  )
);

export default Svg;
