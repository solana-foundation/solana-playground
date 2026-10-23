import type { FC } from "react";
import { useRef } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import Markdown from "../../../components/Markdown";
import { SpinnerWithBg } from "../../../components/Loading";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogTitle } from "@/shared/ui/dialog";

export type ReaderBody =
  | { kind: "loading" }
  | { kind: "page"; markdown: string }
  | { kind: "failed" }
  | { kind: "none" };

export type ReaderFooterKind = "attest" | "back";

/** The footer's one way on: attesting is the primary, going back is not */
const FOOTER: Record<
  ReaderFooterKind,
  { label: string; variant: "default" | "outline" }
> = {
  attest: { label: "Mark as read", variant: "default" },
  back: { label: "Back to the code", variant: "outline" },
};

export interface BaseReaderProps {
  /** The step objective; also the dialog's accessible name */
  title: string;
  /** "Step 2 of 4" */
  position: string;
  /** The band's criterion line, so the page and the band agree */
  criterion: string;
  body: ReaderBody;
  /** The one way on: "Mark as read" (`attest`) or "Back to the code" */
  footer: { kind: ReaderFooterKind; onClick: () => void };
  onClose: () => void;
}

/**
 * The lesson page as the design system's Dialog, non-modal and drawn in
 * place over the stage rather than portalled over the whole screen: the
 * rest of the layout stays live, so outside clicks are not dismissals.
 * Radix supplies Escape and focus on open. Its non-modal Content restores
 * focus on close only to a trigger, and this dialog has none, so
 * `onCloseAutoFocus` gives focus back to the opener by hand.
 */
export const BaseReader: FC<BaseReaderProps> = ({
  title,
  position,
  criterion,
  body,
  footer,
  onClose,
}) => {
  const opener = useRef<Element | null>(null);
  return (
    <Dialog open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Content
        data-slot="dialog-content"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement;
        }}
        onCloseAutoFocus={() => {
          // Radix's non-modal content cancels FocusScope's own restore in
          // favour of a trigger, and this dialog has none
          if (opener.current instanceof HTMLElement) opener.current.focus();
        }}
        className="absolute inset-0 z-[2] flex flex-col bg-card text-card-foreground outline-none"
      >
        <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs tracking-wider text-muted-foreground uppercase">
              {position}
            </span>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close the page">
              <XIcon />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <ReaderBodyView body={body} />
        </div>
        {/* Always visible under the page: what proves this step, and the one
          way on. Esc and the close button still work. */}
        <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
          <span className="text-xs text-muted-foreground">{criterion}</span>
          <Button
            type="button"
            variant={FOOTER[footer.kind].variant}
            onClick={footer.onClick}
          >
            {FOOTER[footer.kind].label}
          </Button>
        </div>
      </DialogPrimitive.Content>
    </Dialog>
  );
};

const ReaderBodyView: FC<{ body: ReaderBody }> = ({ body }) => {
  if (body.kind === "failed") {
    return (
      <p className="text-muted-foreground">
        This page could not be loaded. The step is unaffected -- prose is not
        what verifies it.
      </p>
    );
  }
  if (body.kind === "none") {
    return (
      <p className="text-muted-foreground">This step has no page to read.</p>
    );
  }
  if (body.kind === "loading") return <SpinnerWithBg loading size="2rem" />;
  return <Markdown>{body.markdown}</Markdown>;
};
