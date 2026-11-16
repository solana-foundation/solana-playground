import "./Markdown.css";

import { FC, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { ImageAddress } from "@/shared/lib/image-address";
import { isSameOrigin } from "@/shared/lib/same-origin";
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
  /**
   * Take the font and the text color from the parent, so the text reads as
   * the prose around it does (the tutorial feed's assistant turns)
   */
  inheritFont?: boolean;
  /** Root for the `src` prop (defaults to the current path) */
  rootSrc?: string;
  /** Whether to support URL hashes `<URL>#<HASH>` */
  linkable?: boolean;
  /**
   * Give every heading the id its text gets on GitHub and the docs sites
   * (`rehype-slug`), with no prefix, so a `page#section` address written for
   * the original finds the same heading here. A tutorial's doc page turns it
   * on; `linkable` has its own, prefixed ids and wins where both are set,
   * for the h1 to h3 that `Header` renders
   */
  headingIds?: boolean;
}

/** react-markdown 9 passes one child where 8 passed an array. */
const first = <T,>(v: T | T[]) => (Array.isArray(v) ? v[0] : v);

const Markdown: FC<React.PropsWithChildren<MarkdownProps>> = ({
  rootSrc,
  linkable,
  headingIds,
  codeFontOnly,
  inheritFont,
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
      className={cn(
        "pg-markdown",
        codeFontOnly && "pg-markdown-code-font",
        inheritFont && "pg-markdown-inherit-font"
      )}
      remarkPlugins={[remarkGfm]}
      rehypePlugins={headingIds ? [rehypeSlug] : []}
      components={{
        /** Links */
        a: (linkProps) => <Link {...(linkProps as unknown as LinkProps)} />,

        /**
         * Images. This component loads only images from the app's own
         * origin: an assistant reply or an imported tutorial may come from
         * outside the app, and an image from another host would be fetched,
         * address and all, with no click. Both the address as written and
         * the one the page loads are checked. Any other image shows as text,
         * and so does one whose address react-markdown's `urlTransform`
         * cleared (`data:`, for one). The raw-address check is what turns
         * the schemes it keeps, such as `mailto:`, into text.
         */
        img: ({ src, alt, ...imgProps }) => {
          if (!src) return <ImageAddress alt={alt} />;

          const resolved = src.startsWith("/")
            ? src
            : PgCommon.joinPaths(rootSrc ?? PgRouter.location.pathname, src);
          if (!isSameOrigin(src) || !isSameOrigin(resolved)) {
            return <ImageAddress src={src} alt={alt} />;
          }

          return <Img {...imgProps} alt={alt} src={resolved} />;
        },

        /** Code blocks */
        pre: (preProps) => {
          const codeProps = first((preProps as any).children).props;
          const lang = codeProps.className?.split("-")?.at(1);
          // A fence with no lines yet (an answer mid-stream) has no child
          const code = first(codeProps.children) ?? "";

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
