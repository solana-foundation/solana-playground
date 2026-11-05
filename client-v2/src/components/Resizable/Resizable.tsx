import {
  Enable,
  Resizable as ReResizable,
  ResizableProps as ReResizableProps,
} from "re-resizable";
import { forwardRef } from "react";

import { cn } from "@/shared/lib/utils";

type ResizableProps = Omit<ReResizableProps, "enable"> & {
  enable?: Enable | "top" | "right" | "bottom" | "left";
};

const Resizable = forwardRef<ReResizable, ResizableProps>((props, ref) => (
  <ReResizable
    ref={ref}
    {...{
      ...props,
      className: cn(
        "[transition-duration:250ms] [transition-property:height,width] [transition-timing-function:linear]",
        props.className
      ),
      enable: transformEnable(props.enable),
      onResizeStart: (ev, dir, element) => {
        // Having a transition makes resizing experience laggy. To solve, we
        // disable the transition when resizing starts, and re-enable it
        // after resizing stops.
        element.style.transitionDuration = "0s";
        props.onResizeStart?.(ev, dir, element);
      },
      onResizeStop: (ev, dir, element, delta) => {
        // Setting to empty string restores the default value
        element.style.transitionDuration = "";
        props.onResizeStop?.(ev, dir, element, delta);
      },
    }}
  />
));

const transformEnable = (
  enable: ResizableProps["enable"]
): ReResizableProps["enable"] => {
  if (!enable || typeof enable === "object") return enable;

  const KEYS: Array<keyof Enable> = [
    "bottom",
    "bottomLeft",
    "bottomRight",
    "left",
    "right",
    "top",
    "topLeft",
    "topRight",
  ];
  const ALL_FALSE = Object.values(KEYS).reduce((acc, cur) => {
    acc[cur] = false;
    return acc;
  }, {} as Enable);

  switch (enable) {
    case "bottom":
      return { ...ALL_FALSE, bottom: true };
    case "left":
      return { ...ALL_FALSE, left: true };
    case "right":
      return { ...ALL_FALSE, right: true };
    case "top":
      return { ...ALL_FALSE, top: true };
  }
};

export default Resizable;
