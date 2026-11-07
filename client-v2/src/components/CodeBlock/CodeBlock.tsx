import { useState } from "react";

import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { CopyButton } from "@/shared/ui/copy-button";

import { useAsyncEffect, useDifferentBackground } from "../../hooks";
import { resolveColor } from "../../shared/lib/css-color";
import { PgTheme, resolveTextMateTheme } from "../../utils";
import { highlight } from "./highlight";

export interface CodeBlockProps {
  /** Code */
  children: string;
  /** Language or alias */
  lang?: string;
}

const CodeBlock = ({ lang, children: code, ...props }: CodeBlockProps) => {
  const wrapperRef = useDifferentBackground();
  const copyButtonWrapperRef = useDifferentBackground();

  // The horizontal scrollbar's height is always kept: in Chromium and Safari
  // `pg-scrollbar` draws a classic bar that takes room, so one that came in as
  // a streamed line outgrew the block moved everything below it (HOO-2694).
  // The track is transparent, so the room shows as padding until there is a
  // thumb. Inside Markdown, `Markdown.css` sets the same.
  return (
    <div
      ref={wrapperRef}
      className="group relative rounded-[12px] [&_pre]:pg-scrollbar [&_pre]:overflow-x-scroll [&_pre]:overflow-y-hidden [&_pre]:rounded-[12px] [&_pre]:font-pg-code [&_pre]:text-[0.8125rem]"
      {...props}
    >
      <div
        ref={copyButtonWrapperRef}
        className="absolute top-2 right-4 rounded-[12px] opacity-0 shadow-panel transition-opacity duration-50 ease-linear group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <CopyButton value={code} onError={reportButtonFailure("copy")} />
      </div>

      <Code lang={lang}>{code}</Code>
    </div>
  );
};

const Code = ({ children, lang }: CodeBlockProps) => {
  const [html, setHtml] = useState("");

  const theme = usePgTheme();

  useAsyncEffect(async () => {
    if (lang) {
      const highlightedHtml = await highlight(
        children,
        lang,
        resolveTextMateTheme(
          PgTheme.convertToTextMateTheme(theme),
          resolveColor
        )
      );
      setHtml(highlightedHtml);
    } else {
      setHtml("");
    }
  }, [children, lang, theme]);

  if (!html) return <pre>{children}</pre>;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

export default CodeBlock;
