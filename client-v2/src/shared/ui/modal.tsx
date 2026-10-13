import * as React from "react";
import { XIcon } from "lucide-react";
import { cn } from "cn";
import { Dialog as DialogPrimitive } from "radix-ui";

/* The product's dialog. On a desk, a card on the dimmed stage: bg2, a
   stronger edge, 16 corners, the title on the left in the headline face.
   On a phone, a page of its own, with a 60px bar and its buttons pinned to
   the foot. wide is the gallery's. */

function Modal(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="modal" {...props} />;
}

function ModalTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>
) {
  return <DialogPrimitive.Trigger data-slot="modal-trigger" {...props} />;
}

function ModalClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="modal-close" {...props} />;
}

function ModalContent({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: "default" | "wide";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="modal-overlay"
        className="fixed inset-0 z-50 bg-backdrop data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Content
        data-slot="modal-content"
        data-size={size}
        className={cn(
          "fixed z-50 flex flex-col bg-surface-panel text-foreground outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          "md:top-1/2 md:left-1/2 md:max-h-[calc(100dvh-4rem)] md:w-[min(36rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:border-border-strong md:shadow-modal md:data-open:zoom-in-95 md:data-[size=wide]:w-[min(64rem,90vw)]",
          "max-md:inset-0 max-md:h-dvh",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function ModalHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-header"
      className={cn(
        "flex items-start gap-3 px-6 pt-6 pb-2 max-md:h-phone-bar max-md:shrink-0 max-md:items-center max-md:border-b max-md:border-border max-md:px-4 max-md:py-0",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
      <DialogPrimitive.Close
        aria-label="Close"
        className="-mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:m-0 max-md:size-11"
      >
        <XIcon className="size-4" />
      </DialogPrimitive.Close>
    </div>
  );
}

function ModalTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="modal-title"
      className={cn(
        "font-heading text-[1.1875rem] leading-snug font-headline text-foreground",
        className
      )}
      {...props}
    />
  );
}

function ModalDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="modal-description"
      className={cn("text-caption font-read text-muted-foreground", className)}
      {...props}
    />
  );
}

function ModalBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-body"
      className={cn(
        "min-h-0 flex-1 overflow-auto px-6 py-4 max-md:px-4",
        className
      )}
      {...props}
    />
  );
}

function ModalFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="modal-footer"
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 px-6 pt-2 pb-6 max-md:sticky max-md:bottom-0 max-md:border-t max-md:border-border max-md:bg-surface-panel max-md:px-4 max-md:py-3 max-md:*:flex-1",
        className
      )}
      {...props}
    />
  );
}

export {
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
};
