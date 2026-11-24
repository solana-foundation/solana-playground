import { ComponentPropsWithoutRef, forwardRef } from "react";
import { Link as RouterLink } from "react-router";

import { isSameOrigin } from "@/shared/lib/same-origin";
import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";

export interface LinkProps extends ComponentPropsWithoutRef<"a"> {
  href: RoutePath;
}

const WRAPPER_CLASSES = cn(
  "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
  "[&>*]:[transition:color_50ms_linear] [&>*:hover]:text-[var(--text-primary)]"
);

const TEXT_CLASSES =
  "border-b border-transparent text-primary-ink [transition:border-bottom-color_50ms_linear] hover:border-primary-ink [&_svg]:ml-1";

const Link = forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  // `Markdown` component may set `props.children` to an array
  const isWrapper =
    typeof props.children !== "string" && !Array.isArray(props.children);
  const className = cn(
    isWrapper ? WRAPPER_CLASSES : TEXT_CLASSES,
    props.className
  );

  // A leading slash is not enough: `//host` and `/\host` start with one yet
  // name another site, so the URL parser confirms the origin
  if (props.href.startsWith("/") && isSameOrigin(props.href)) {
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

      {!isWrapper && (
        <Icon
          name="external"
          size={16}
          className="inline-block align-[-0.2em]"
        />
      )}
    </a>
  );
});

export default Link;
