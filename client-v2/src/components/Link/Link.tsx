import { ComponentPropsWithoutRef, forwardRef } from "react";
import { Link as RouterLink } from "react-router-dom";

import { External } from "../Icons";
import { cn } from "@/shared/lib/utils";

export interface LinkProps extends ComponentPropsWithoutRef<"a"> {
  href: RoutePath;
}

const WRAPPER_CLASSES = cn(
  "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  "[&>*]:[transition:color_50ms_linear] [&>*:hover]:text-[var(--text-primary)]"
);

const TEXT_CLASSES =
  "border-b border-transparent text-primary [transition:border-bottom-color_50ms_linear] hover:border-primary [&_svg]:ml-1";

const Link = forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  // `Markdown` component may set `props.children` to an array
  const isWrapper =
    typeof props.children !== "string" && !Array.isArray(props.children);
  const className = cn(
    isWrapper ? WRAPPER_CLASSES : TEXT_CLASSES,
    props.className
  );

  if (props.href.startsWith("/")) {
    return (
      <RouterLink ref={ref} to={props.href} {...props} className={className} />
    );
  }

  return (
    <a
      ref={ref}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
      className={className}
    >
      {props.children}

      {!isWrapper && <External />}
    </a>
  );
});

export default Link;
