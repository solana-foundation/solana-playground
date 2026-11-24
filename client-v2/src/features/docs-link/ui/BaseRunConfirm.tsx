import { TriangleAlert } from "lucide-react";
import type { FC } from "react";
import { useRef } from "react";

import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from "@/shared/ui/code-block";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/shared/ui/modal";

import { countHidden, linesOf, partsOf } from "../lib/hidden-chars";
import type { DocsLink } from "../lib/link";

export interface BaseRunConfirmProps {
  /** The link whose code is about to run for the first time, or none */
  link?: Pick<DocsLink, "name" | "code" | "from">;
  /** A phone draws the modal frame's foot: no Cancel, Run across it */
  isPhone?: boolean;
  onRun: () => void;
  /** Cancel, the close button, Escape and a click outside */
  onCancel: () => void;
}

/**
 * The foot's buttons as `BaseModalFrame` draws a brand submit. Copied rather
 * than built on that frame, which is a widget this feature cannot import.
 */
const DESK_CANCEL =
  "h-10 rounded-full px-4 font-heading text-[0.9375rem] font-act";
const DESK_RUN = "px-5";
const PHONE_RUN = "h-12 rounded-xl text-control";

const hostOf = (from: string) => new URL(from).hostname;

/**
 * Asked before the first Run of code a docs link opened. A link is anyone's
 * to write, so the dialog shows its code and says the source is only what the
 * link claims. Cancel takes the focus, so Enter runs nothing.
 */
const BaseRunConfirm: FC<BaseRunConfirmProps> = ({
  link,
  isPhone = false,
  onRun,
  onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const hidden = link ? countHidden(link.code) : 0;
  return (
    <Modal open={!!link} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      {link && (
        <ModalContent
          id="client-run-confirm"
          size="wide"
          onOpenAutoFocus={(event) => {
            if (!cancelRef.current) return;
            event.preventDefault();
            cancelRef.current.focus();
          }}
        >
          <ModalHeader className="md:pb-4">
            <ModalTitle>Run code from a link?</ModalTitle>
          </ModalHeader>
          {/* The header holds the title alone: on a phone it is a 60 px bar */}
          <ModalBody className="md:pt-5">
            <ModalDescription className="mb-4">
              {link.from
                ? `The link says this code comes from ${hostOf(
                    link.from
                  )}. Playground can't check that.`
                : "Playground can't check where this code came from."}{" "}
              It runs with your Playground wallet and can sign transactions with
              it. Read it before you run it.
            </ModalDescription>
            {hidden > 0 && (
              <Callout variant="warning" role="alert" className="mb-4">
                <TriangleAlert />
                <CalloutTitle>
                  {hidden === 1
                    ? "1 hidden or direction-changing character"
                    : `${hidden} hidden or direction-changing characters`}
                </CalloutTitle>
                <CalloutDescription>
                  They can make code read differently from what runs, so each is
                  shown as its code, such as U+202E.
                </CalloutDescription>
              </Callout>
            )}
            <CodeBlock>
              <CodeBlockHeader>
                <CodeBlockTitle>{link.name}</CodeBlockTitle>
              </CodeBlockHeader>
              <CodeBlockContent className="max-h-[50dvh] overflow-y-auto">
                {linesOf(link.code).map((line, index) => (
                  // Wrapped, so a crafted line cannot hide its end past the
                  // right edge: at spaces first, inside a word only when it
                  // cannot fit, continuing under the code, not the gutter
                  <CodeBlockLine
                    // eslint-disable-next-line react/no-array-index-key -- a line has no identity beyond its place in the file
                    key={index}
                    className="-indent-9 pl-9 whitespace-pre-wrap [overflow-wrap:anywhere]"
                  >
                    {partsOf(line).map((part, at) =>
                      "hidden" in part ? (
                        <mark
                          // eslint-disable-next-line react/no-array-index-key -- a part has no identity beyond its place in the line
                          key={at}
                          className="rounded bg-destructive/20 px-0.5 text-destructive"
                        >
                          {part.hidden}
                        </mark>
                      ) : (
                        part.text
                      )
                    )}
                  </CodeBlockLine>
                ))}
              </CodeBlockContent>
            </CodeBlock>
          </ModalBody>
          <ModalFooter>
            {!isPhone && (
              <Button
                ref={cancelRef}
                type="button"
                variant="ghost"
                className={DESK_CANCEL}
                onClick={onCancel}
              >
                Cancel
              </Button>
            )}
            <BrandButton
              type="button"
              variant={isPhone ? "accent" : "ring"}
              className={isPhone ? PHONE_RUN : DESK_RUN}
              onClick={onRun}
            >
              Run
            </BrandButton>
          </ModalFooter>
        </ModalContent>
      )}
    </Modal>
  );
};

export default BaseRunConfirm;
