import { ArrowUpRight } from "lucide-react";

/**
 * What the wallet menu's Airdrop says when the faucet is at its limit. The
 * terminal prints it too, but under Home no terminal shows, and the click
 * seemed to do nothing (Natalia, 10 Nov). The link is the web faucet with
 * the wallet and amount filled in.
 */
const FaucetRefusedToast = ({ href }: { href: string }) => (
  <span className="flex flex-col gap-1">
    <strong>The faucet is at its limit.</strong>
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
  </span>
);

export default FaucetRefusedToast;
