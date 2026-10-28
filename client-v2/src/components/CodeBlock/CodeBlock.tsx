import { useState } from "react";

import { CopyButton } from "@/shared/ui/copy-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { highlight } from "./highlight";
import { PgTheme, resolveTextMateTheme } from "../../utils";
import { resolveColor } from "../../shared/lib/css-color";
import { useAsyncEffect, useDifferentBackground } from "../../hooks";
import { usePgTheme } from "@/shared/lib/hooks/use-pg-theme";

export interface CodeBlockProps {
  /** Code */
  children: string;
  /** Language or alias */
  lang?: string;
}

const CodeBlock = ({ lang, children: code, ...props }: CodeBlockProps) => {
  const wrapperRef = useDifferentBackground();
  const copyButtonWrapperRef = useDifferentBackground();

  return (
    <div
      ref={wrapperRef}
      className="group relative rounded-[12px] [&_pre]:pg-scrollbar [&_pre]:overflow-auto [&_pre]:rounded-[12px] [&_pre]:font-pg-code [&_pre]:text-[0.8125rem]"
      {...props}
    >
      <div
        ref={copyButtonWrapperRef}
        className="absolute top-2 right-4 rounded-[12px] opacity-0 shadow-panel transition-opacity duration-50 ease-linear group-hover:opacity-100"
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
