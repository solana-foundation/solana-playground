import { ArrowUpRight } from "lucide-react";

import type { AirdropRefusal } from "@/shared/lib/faucet-limit";
import { refusalHeadline } from "@/shared/lib/faucet-limit";
import { Button } from "@/shared/ui/button";

import { fundFor } from "../model/receiver";

export interface FaucetRefusedToastProps {
  /** The web faucet, prefilled */
  href: string;
  /** The wallet the faucet refused */
  address: string;
  /** What the faucet refused for: its limit, or anything else */
  refusal: AirdropRefusal;
}

/**
 * What the wallet menu's Airdrop says when the faucet refuses, for its limit
 * or anything else. The terminal prints it too, but under Home no terminal
 * shows, and the click seemed to do nothing (Natalia, 10 Nov). The link is
 * the web faucet with the wallet and amount filled in; under it, Send from
 * your wallet opens the Fund dialog, which outlives the toast. It is left out
 * when the dialog would fund another wallet, as of when the toast showed: a
 * wallet switch while it shows is not read again, and the dialog then names
 * the new one.
 */
const FaucetRefusedToast = ({
  href,
  address,
  refusal,
}: FaucetRefusedToastProps) => {
  const fund = fundFor("faucet-toast")(address);
  return (
    <span className="flex flex-col gap-1">
      <strong>{refusalHeadline(refusal)}.</strong>
      <span>
        Sign in to the web faucet with GitHub and confirm the airdrop. Your
        address is filled in.
      </span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 font-label text-foreground underline underline-offset-2"
      >
        Open the web faucet
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      </a>
      {fund && (
        <Button
          variant="link"
          className="h-auto w-fit p-0 font-label text-foreground underline underline-offset-2"
          onClick={fund}
        >
          Send from your wallet
        </Button>
      )}
    </span>
  );
};

export default FaucetRefusedToast;
