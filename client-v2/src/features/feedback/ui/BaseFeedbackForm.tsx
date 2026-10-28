import { useRef } from "react";
import type { CSSProperties, FormEvent, RefObject } from "react";
import { ExternalLink } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { brandButtonVariants } from "@/shared/ui/brand-button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/shared/ui/modal";
import { Textarea } from "@/shared/ui/textarea";
import { GITHUB_LINKS } from "../lib/github-links";
import type { GithubLink } from "../lib/github-links";
import type { FeedbackDraft, SendStatus } from "../model/use-feedback-form";
import { BaseStarRating } from "./BaseStarRating";

/** Sentry drops an oversized event, and breadcrumbs add to its size */
export const MESSAGE_MAX_LENGTH = 4096;
/** An X handle is at most 15 characters, plus an optional @ */
export const CONTACT_MAX_LENGTH = 16;

export interface BaseFeedbackFormProps {
  open: boolean;
  /** `failed` shows its alert inside the modal, where the user is reading, not in a toast that times out */
  send: SendStatus;
  /** Held outside, so a closed form gets it back */
  draft: FeedbackDraft;
  onDraftChange: (draft: FeedbackDraft) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onGithub: (link: GithubLink) => void;
  /** The modal opens from a menu item, not a trigger of its own, so focus goes here on close */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** The modal portals outside the app wrapper that sets the font, so it is given here */
  font?: CSSProperties;
}

/** The feedback modal: a dialog on a wide screen, a page of its own on a phone */
export const BaseFeedbackForm = ({
  open,
  send,
  draft,
  onDraftChange,
  onOpenChange,
  onSubmit,
  onGithub,
  returnFocusTo,
  font,
}: BaseFeedbackFormProps) => {
  const sending = send === "sending";
  const message = useRef<HTMLTextAreaElement>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // `required` accepts a message of only spaces; refuse it as the browser refuses an empty one
    if (!draft.message.trim()) {
      message.current?.setCustomValidity("Write your feedback first");
      message.current?.reportValidity();
      return;
    }
    onSubmit();
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        style={font}
        // The modal would focus its first button, the close cross; the message is what the user came to write
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          message.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
        <ModalHeader>
          <ModalTitle>Give feedback</ModalTitle>
          <ModalDescription>
            Something missing, or an idea to share? Tell us below.
          </ModalDescription>
        </ModalHeader>
        <form onSubmit={submit} className="contents">
          <ModalBody className="flex flex-col gap-4">
            <BaseStarRating
              value={draft.rating}
              onChange={(rating) => onDraftChange({ ...draft, rating })}
              disabled={sending}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-message">Feedback</Label>
              <Textarea
                ref={message}
                id="feedback-message"
                name="message"
                required
                maxLength={MESSAGE_MAX_LENGTH}
                rows={5}
                value={draft.message}
                onChange={(event) => {
                  event.target.setCustomValidity("");
                  onDraftChange({ ...draft, message: event.target.value });
                }}
                // A send clears the draft when it succeeds, so text typed meanwhile would be lost
                readOnly={sending}
                className="resize-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-contact">
                X handle{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="feedback-contact"
                name="contact"
                maxLength={CONTACT_MAX_LENGTH}
                value={draft.contact}
                onChange={(event) =>
                  onDraftChange({ ...draft, contact: event.target.value })
                }
                readOnly={sending}
              />
              <p className="text-xs text-muted-foreground">
                So we can reach you if we have a question
              </p>
            </div>
            {send === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                Could not send feedback. Try again, or use the GitHub links
                below.
              </p>
            )}
          </ModalBody>
          <ModalFooter className="justify-between">
            <p className="text-xs text-muted-foreground">
              Prefer GitHub?{" "}
              <GithubAnchor link="idea" onGithub={onGithub}>
                Suggest an idea
              </GithubAnchor>{" "}
              or{" "}
              <GithubAnchor link="bug" onGithub={onGithub}>
                report a bug
              </GithubAnchor>
            </p>
            <AsyncButton
              type="submit"
              loading={sending}
              onError={reportButtonFailure("send your feedback")}
              className={brandButtonVariants({ variant: "accent" })}
            >
              Submit
            </AsyncButton>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
};

const GithubAnchor = ({
  link,
  onGithub,
  children,
}: {
  link: GithubLink;
  onGithub: (link: GithubLink) => void;
  children: string;
}) => (
  <a
    href={GITHUB_LINKS[link]}
    target="_blank"
    rel="noopener noreferrer"
    onClick={() => onGithub(link)}
    className="text-primary hover:underline"
  >
    {children}
    <ExternalLink aria-hidden="true" className="ml-0.5 inline size-3" />
  </a>
);
