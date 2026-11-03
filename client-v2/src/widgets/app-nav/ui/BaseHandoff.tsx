import { Check, Copy, Monitor, Share } from "lucide-react";
import { Fragment, useEffect, useState } from "react";

import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";
import { SidebarMenuButton } from "@/shared/ui/sidebar";
import { GithubMark } from "@/shared/lib/github-mark";

export const HANDOFF_TITLE = "Continue on a computer";

/** How long "Copied" stays before the button reads "Copy link" again */
const COPIED_MS = 2000;

/** Who the sheet speaks to: what moves to the computer depends on it */
export type HandoffAccount =
  | { status: "signed-in"; login: string }
  | {
      status: "signed-out";
      /** A sign-in is under way: its button waits */
      signingIn: boolean;
      /** Why the last sign-in failed, in the user's words; null if it did not */
      error: string | null;
    };

export interface BaseHandoffProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The address to open on the computer, whole */
  link: string;
  account: HandoffAccount;
  onSignIn: () => void;
  /**
   * Puts the link on the clipboard: true once it is there, false when the
   * clipboard refused (and the caller has told the user)
   */
  onCopy: () => Promise<boolean>;
  /** Hands the link to the browser's share sheet; null where there is none */
  onShare: (() => Promise<void>) | null;
}

/**
 * The link whole, with a break offered after each slash; the well's
 * `wrap-anywhere` breaks a part longer than the line only as a last resort
 */
const Wrapped = ({ link }: { link: string }) => (
  <>
    {link.split("/").map((part, i) => (
      <Fragment key={i}>
        {i > 0 && (
          <>
            /<wbr />
          </>
        )}
        {part}
      </Fragment>
    ))}
  </>
);

/**
 * The phone's way out for work a phone does poorly, such as typing code: a
 * row on the menu page and the sheet it opens, in the shape of the lesson's
 * "Write it yourself on a computer" sheet (Almaz's prototype), so the phone
 * has one look for it. Signed in, account sync carries the project and the
 * sheet gives the link; signed out, it says the project stays here and
 * offers only the sign-in, since the link would find nothing on a computer.
 */
const BaseHandoff = ({
  open,
  onOpenChange,
  link,
  account,
  onSignIn,
  onCopy,
  onShare,
}: BaseHandoffProps) => {
  const [copied, setCopied] = useState(false);
  // A sheet opened again starts from "Copy link", whatever the last one said
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => setCopied(await onCopy());

  return (
    <>
      {/* The menu's own row, so it reads as one of the items and not as a
          project; `BaseAppNav` gives it a group of its own */}
      <SidebarMenuButton
        data-testid="handoff-open"
        onClick={() => onOpenChange(true)}
      >
        <Monitor strokeWidth={1.75} aria-hidden />
        <span>{HANDOFF_TITLE}</span>
      </SidebarMenuButton>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[82dvh]">
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <DrawerHeader className="items-start text-left">
              <span className="mb-2 flex size-12 items-center justify-center rounded-panel bg-surface-raised text-muted-foreground">
                <Monitor strokeWidth={1.75} className="size-6" aria-hidden />
              </span>
              <DrawerTitle className="font-heading text-title! font-normal!">
                {HANDOFF_TITLE}
              </DrawerTitle>
            </DrawerHeader>
            {/* One rhythm: 16 px between blocks, 12 px between buttons */}
            <div className="flex flex-col gap-4 px-4">
              {/* text-body needs the ! here: cn drops it next to a colour
                  class and the stock 14 px comes back */}
              <DrawerDescription className="text-body! font-read text-pretty text-muted-foreground">
                {account.status === "signed-in"
                  ? `Your projects are saved to your account. Open this link on a computer and sign in with GitHub as @${account.login}: this project is in your list there.`
                  : "This project is saved on this phone only. Sign in with GitHub to keep it in your account, then open this link on a computer and sign in there too."}
              </DrawerDescription>
              {account.status === "signed-out" ? (
                <SignIn account={account} onSignIn={onSignIn} />
              ) : (
                // Signed in only: signed out, the computer would open the
                // link without the project, which is on this phone alone
                <div className="flex flex-col gap-3">
                  <p
                    data-testid="handoff-link"
                    className="rounded-control border border-border bg-surface-well px-3 py-3 font-mono text-code wrap-anywhere text-foreground select-all"
                  >
                    <Wrapped link={link} />
                  </p>
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      className={SHEET_BUTTON}
                      onClick={copy}
                    >
                      {copied ? (
                        <Check
                          strokeWidth={2}
                          className="size-4 text-success"
                          aria-hidden
                        />
                      ) : (
                        <Copy
                          strokeWidth={1.75}
                          className="size-4"
                          aria-hidden
                        />
                      )}
                      {/* Announced as it changes, so a screen reader hears it worked */}
                      <span aria-live="polite">
                        {copied ? "Copied" : "Copy link"}
                      </span>
                    </Button>
                    {onShare && (
                      <Button
                        variant="secondary"
                        className={SHEET_BUTTON}
                        onClick={() => void onShare()}
                      >
                        <Share
                          strokeWidth={1.75}
                          className="size-4"
                          aria-hidden
                        />
                        Share
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* pt-1 over the scroller's pb-2 keeps the 12 px between buttons;
              the pb-2 stays so the last button's focus ring is not clipped */}
          <DrawerFooter className="shrink-0 pt-1 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {/* It only closes the sheet, so it is the quiet one, not a
                second call to action */}
            <Button
              variant="ghost"
              className="h-target self-center rounded-full px-4 text-control text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              Stay on the phone
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
};

/**
 * The sheet's buttons share the phone's touch target (`--target`, 48 px)
 * and the sign-in's pill, the brand button's own radius, so the sheet has one
 */
const SHEET_BUTTON = "h-target flex-1 gap-2 rounded-full text-control";

/** Signed out, the sheet's one action: the sign-in, and why the last one failed */
const SignIn = ({
  account,
  onSignIn,
}: {
  account: Extract<HandoffAccount, { status: "signed-out" }>;
  onSignIn: () => void;
}) => (
  <div className="flex flex-col gap-2">
    <BrandButton
      className="h-target w-full"
      disabled={account.signingIn}
      onClick={onSignIn}
    >
      {/* The mark every GitHub sign-in in the product carries */}
      <GithubMark />
      Sign in with GitHub
    </BrandButton>
    {account.error && (
      <p role="alert" className="text-caption font-read text-destructive">
        {account.error}
      </p>
    )}
  </div>
);

export default BaseHandoff;
