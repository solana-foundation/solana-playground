import { useState } from "react";
import styled, { css, useTheme } from "styled-components";

import { CopyButton } from "@/shared/ui/copy-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { highlight } from "./highlight";
import { PgTheme, resolveTextMateTheme } from "../../utils";
import { resolveColor } from "../../shared/lib/css-color";
import { useAsyncEffect, useDifferentBackground } from "../../hooks";

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
    <Wrapper ref={wrapperRef} {...props}>
      <CopyButtonWrapper ref={copyButtonWrapperRef}>
        <CopyButton value={code} onError={reportButtonFailure("copy")} />
      </CopyButtonWrapper>

      <Code lang={lang}>{code}</Code>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    position: relative;
    border-radius: ${theme.default.borderRadius};

    & pre {
      border-radius: ${theme.default.borderRadius};
      font-family: ${theme.font.code.family};
      font-size: ${theme.font.code.size.medium};
      overflow: auto;

      ${PgTheme.getScrollbarCSS()};
    }

    & > :first-child {
      opacity: 0;
      transition: opacity ${theme.default.transition.duration.short}
        ${theme.default.transition.type};
    }

    &:hover > :first-child {
      opacity: 1;
    }
  `}
`;

const CopyButtonWrapper = styled.div`
  ${({ theme }) => css`
    position: absolute;
    top: 0.5rem;
    right: 1rem;
    border-radius: ${theme.default.borderRadius};
    box-shadow: ${theme.default.boxShadow};
  `}
`;

const Code = ({ children, lang }: CodeBlockProps) => {
  const [html, setHtml] = useState("");

  const theme = useTheme();

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
