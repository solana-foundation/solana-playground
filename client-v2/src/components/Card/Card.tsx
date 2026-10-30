import {
  ComponentPropsWithoutRef,
  FC,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/shared/lib/utils";

interface CardProps extends ComponentPropsWithoutRef<"div"> {}

const Card: FC<React.PropsWithChildren<CardProps>> = ({
  className,
  ...props
}) => {
  const [isClickable, setIsClickable] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (props.onClick) return setIsClickable(true);

    if (!ref.current) return;

    const { parentElement } = ref.current;
    if (!parentElement) return;

    const isAnchorElement = parentElement.nodeName === "A";
    if (!isAnchorElement) return;

    const anchorElement = parentElement as HTMLAnchorElement;
    const hasHref = anchorElement.hasAttribute("href");
    setIsClickable(hasHref);
  }, [props.onClick]);

  const Card = (
    <div
      ref={ref}
      className={cn(
        "border border-[color-mix(in_srgb,var(--border)_39%,transparent)] bg-surface-base p-4 text-[var(--text-primary)]",
        "rounded-[12px] transition-all duration-150 ease-linear",
        className
      )}
      {...props}
    />
  );

  if (isClickable) {
    return (
      <div
        className={cn(
          "relative p-1 [transform-style:preserve-3d] transition-transform duration-150 ease-linear",
          // The gradient frame behind the card, shown on hover
          "after:absolute after:inset-0 after:m-auto after:h-full after:w-full after:rounded-[12px] after:opacity-0",
          "after:transition-opacity after:duration-150 after:ease-linear after:content-['']",
          "after:[transform:translateZ(-1px)] after:bg-[linear-gradient(45deg,var(--primary),var(--track-brand))]",
          "[&>div]:overflow-hidden",
          "hover:cursor-pointer hover:[transform:translateY(-0.5rem)] hover:[&>div]:bg-surface-hover hover:after:opacity-100"
        )}
      >
        {Card}
      </div>
    );
  }
  return Card;
};

export default Card;
