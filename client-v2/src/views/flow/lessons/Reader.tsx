import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import type { LessonStep } from "./types";
import Markdown from "../../../components/Markdown";
import { SpinnerWithBg } from "../../../components/Loading";
import { useAsyncEffect, useKeybind } from "../../../hooks";

interface ReaderProps {
  step: LessonStep;
  /** "Step 2 of 4" */
  position: string;
  /** The band's criterion line, so the sheet and the band agree */
  criterion: string;
  /**
   * Whether "Mark as read" is the step's edge right now (an attestation
   * kind, cursor at the frontier) -- then the proof sits where the
   * reading ends rather than in the band behind the sheet
   */
  offersAttest: boolean;
  /** Fired once the page content actually loads -- the record's `opened`
   * fact must not rest on a page the learner never saw */
  onLoaded: () => void;
  onClose: () => void;
  onAttest: () => void;
}

/**
 * The lesson page, over the editor.
 *
 * Reading is deliberately not a stepper stage: it is not part of the dev
 * loop, and making it one would put a surface into the rotation whose
 * job is to hide the code. The sheet says where you are (the eyebrow)
 * and where you go next (the footer), so closing it is never a leap
 * into the unknown.
 */
const Reader: FC<React.PropsWithChildren<ReaderProps>> = ({
  step,
  position,
  criterion,
  offersAttest,
  onLoaded,
  onClose,
  onAttest,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useAsyncEffect(async () => {
    const { readPage } = step;
    if (!readPage) return;

    // Fire the load without awaiting it here, so this effect's own
    // promise settles immediately and its cleanup (below) is wired up
    // before the load can finish. `live` is then checked before either
    // state update, so a step closed mid-load never touches state after
    // this component has unmounted.
    let live = true;
    (async () => {
      try {
        const page = await readPage();
        if (live) {
          setContent(page);
          onLoaded();
        }
      } catch (e) {
        console.error("lesson page failed to load", e);
        if (live) setFailed(true);
      }
    })();

    return () => {
      live = false;
    };
  }, [step]);

  useKeybind("Escape", onClose);

  // Move focus into the sheet on open, and give it back on close. This
  // is the half of dialog behaviour that carries real value without a
  // focus trap: `aria-modal` is deliberately not claimed below, since
  // nothing here makes the background inert.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  return (
    <Sheet role="dialog" aria-label={step.objective}>
      <Bar>
        <Heading>
          <Eyebrow>{position}</Eyebrow>
          <Title>{step.objective}</Title>
        </Heading>
        <Close
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close the page"
        >
          &times;
        </Close>
      </Bar>
      <Body>
        {failed ? (
          <Failure>
            This page could not be loaded. The step is unaffected -- prose is
            not what verifies it.
          </Failure>
        ) : !step.readPage ? (
          <Failure>This step has no page to read.</Failure>
        ) : content === null ? (
          <SpinnerWithBg loading size="2rem" />
        ) : (
          <Markdown>{content}</Markdown>
        )}
      </Body>
      {/* Always visible under the page: what proves this step, and the
          one way on. Esc and the close button still work. */}
      <Footer>
        <Criterion>{criterion}</Criterion>
        {offersAttest ? (
          <FooterPrimary type="button" onClick={onAttest}>
            Mark as read
          </FooterPrimary>
        ) : (
          <FooterAction type="button" onClick={onClose}>
            Back to the code
          </FooterAction>
        )}
      </Footer>
    </Sheet>
  );
};

export default Reader;

const Sheet = styled.div`
  ${({ theme }) => css`
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: ${theme.colors.default.bgSecondary};
  `}
`;

const Bar = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid ${theme.colors.default.border};
  `}
`;

const Heading = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
`;

// The band's eyebrow, repeated here so the sheet says where you are
// without the band having to show through it
const Eyebrow = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.small};
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Title = styled.span`
  ${({ theme }) => css`
    font-family: ${theme.font.other.family};
    font-weight: 600;
    color: ${theme.colors.default.textPrimary};
  `}
`;

const Close = styled.button`
  ${({ theme }) => css`
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    border-radius: ${theme.default.borderRadius};
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;

    &:hover {
      background: ${theme.colors.default.bgPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
    }
  `}
`;

const Body = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
`;

const Failure = styled.p`
  color: ${({ theme }) => theme.colors.default.textSecondary};
`;

const Footer = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid ${theme.colors.default.border};
  `}
`;

const Criterion = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

// The band's secondary and primary, in the same shapes, so the two
// surfaces read as one family
const FooterAction = styled.button`
  ${({ theme }) => css`
    flex-shrink: 0;
    padding: 0.375rem 0.75rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 9999px;
    background: transparent;
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    cursor: pointer;

    &:hover {
      border-color: ${theme.colors.default.primary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

const FooterPrimary = styled(FooterAction)`
  ${({ theme }) => css`
    border-color: transparent;
    background: ${theme.colors.default.primary};
  `}
`;
