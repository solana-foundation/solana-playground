import "./Markdown.css";

import { FC, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/utils";
import { Icon } from "@/shared/ui/icon";

import { PgCommon, PgRouter } from "../../utils";
import CodeBlock from "../CodeBlock";
import Img from "../Img";
import Link, { LinkProps } from "../Link";

interface MarkdownProps {
  /** Markdown string */
  children: string;
  /** Make all fonts the code font */
  codeFontOnly?: boolean;
  /** Root for the `src` prop (defaults to the current path) */
  rootSrc?: string;
  /** Whether to support URL hashes `<URL>#<HASH>` */
  linkable?: boolean;
}

/** react-markdown 9 passes one child where 8 passed an array. */
const first = <T,>(v: T | T[]) => (Array.isArray(v) ? v[0] : v);

const Markdown: FC<React.PropsWithChildren<MarkdownProps>> = ({
  rootSrc,
  linkable,
  codeFontOnly,
  ...props
}) => {
  // Scroll to section if it's linkable
  useEffect(() => {
    if (!linkable) return;

    /** Recursively try to find a parent vertically scrollable element. */
    const findParentScrollableElement = (
      element: HTMLElement | null
    ): HTMLElement | null => {
      if (!element) return null;
      if (element.scrollHeight > element.clientHeight) return element;
      return findParentScrollableElement(element.parentElement);
    };

    const { dispose } = PgRouter.onDidChangeHash((hash) => {
      if (!hash) return;

      const el = document.getElementById(
        HEADER_ELEMENT_ID_PREFIX + hash.substring(1)
      );
      if (!el) return;

      setTimeout(() => {
        const scrollableEl = findParentScrollableElement(el);
        if (!scrollableEl) return;

        scrollableEl.scrollTo({
          top: el.getBoundingClientRect().top + scrollableEl.scrollTop,
          behavior: "smooth",
        });
      });
    });
    return dispose;
  }, [linkable]);

  return (
    <ReactMarkdown
      className={cn("pg-markdown", codeFontOnly && "pg-markdown-code-font")}
      remarkPlugins={[remarkGfm]}
      components={{
        /** Links */
        a: (linkProps) => <Link {...(linkProps as unknown as LinkProps)} />,

        /** Images */
        img: (imgProps) => {
          return (
            <Img
              {...imgProps}
              src={
                imgProps.src && !imgProps.src.startsWith("/")
                  ? PgCommon.joinPaths(
                      rootSrc ?? PgRouter.location.pathname,
                      imgProps.src
                    )
                  : imgProps.src
              }
            />
          );
        },

        /** Code blocks */
        pre: (preProps) => {
          const codeProps = first((preProps as any).children).props;
          const lang = codeProps.className?.split("-")?.at(1);
          const code = first(codeProps.children);

          return <CodeBlock lang={lang}>{code}</CodeBlock>;
        },

        /** Section headers */
        h1: (headerProps) => (
          <Header element="h1" linkable={linkable} {...headerProps} />
        ),
        h2: (headerProps) => (
          <Header element="h2" linkable={linkable} {...headerProps} />
        ),
        h3: (headerProps) => (
          <Header element="h3" linkable={linkable} {...headerProps} />
        ),
      }}
      {...props}
    />
  );
};

type HeaderProps = {
  element: "h1" | "h2" | "h3";
} & Pick<MarkdownProps, "linkable">;

const Header: FC<React.PropsWithChildren<HeaderProps>> = ({
  element: H,
  linkable,
  ...rest
}) => {
  if (!linkable) return <H {...rest} />;

  const hash = PgCommon.toKebabFromTitle(first(rest.children) as string);

  return (
    <div
      onClick={() => (PgRouter.location.hash = hash)}
      className="relative cursor-pointer [&>:first-child]:absolute [&>:first-child]:top-0 [&>:first-child]:bottom-0 [&>:first-child]:-left-6 [&>:first-child]:my-auto [&>:first-child]:opacity-0 [&>:first-child]:transition-opacity [&>:first-child]:duration-50 [&>:first-child]:ease-linear [&:hover>:first-child]:opacity-100"
    >
      <Icon name="link" size={16} />
      <H {...rest} id={HEADER_ELEMENT_ID_PREFIX + hash} />
    </div>
  );
};

const HEADER_ELEMENT_ID_PREFIX = "md";

export default Markdown;
