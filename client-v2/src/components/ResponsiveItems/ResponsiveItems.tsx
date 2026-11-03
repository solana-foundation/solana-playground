import { FC, useEffect, useRef, useState } from "react";

import { PgCommon } from "../../utils";

interface ResponsiveItemsProps {
  minItemWidth: string;
  maxItems: number;
  gap: string;
}

const ResponsiveItems: FC<React.PropsWithChildren<ResponsiveItemsProps>> = (
  props
) => {
  const [itemCount, setItemCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const gap = PgCommon.convertToPx(props.gap);
    const widthPoints = Array.from<number>({ length: props.maxItems })
      .fill(PgCommon.convertToPx(props.minItemWidth))
      .map((mw, i) => (i + 1) * mw + i * gap)
      .reverse();

    const handle = () => {
      const { width } = el.getBoundingClientRect();
      for (const [i, widthPoint] of Object.entries(widthPoints)) {
        if (widthPoint > width) continue;

        setItemCount(widthPoints.length - +i);
        break;
      }
    };
    handle();

    window.addEventListener("resize", handle);
    el.addEventListener("resize", handle);

    // Check on interval whether the width has changed because `resize` events
    // do not always trigger for some reason
    let { width: prevWidth } = el.getBoundingClientRect();
    const intervalId = PgCommon.setIntervalOnFocus(() => {
      const { width } = el.getBoundingClientRect();
      if (prevWidth === width) return;

      prevWidth = width;
      handle();
    }, 1000);

    return () => {
      window.removeEventListener("resize", handle);
      el.removeEventListener("resize", handle);
      clearInterval(intervalId);
    };
  }, [props.minItemWidth, props.gap, props.maxItems]);

  return (
    <div
      ref={ref}
      className="grid h-fit w-full"
      style={{
        gridTemplateColumns: `repeat(${itemCount}, 1fr)`,
        gap: props.gap,
      }}
    >
      {props.children}
    </div>
  );
};

export default ResponsiveItems;
