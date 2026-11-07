import type { ReactNode } from "react";

/** How many of the address's last characters its copy control holds on to */
const TAIL = 4;

/**
 * A wallet address in full, in mono, for the "Not enough devnet SOL" cards:
 * on one line where it fits (11 px fits the desktop chat's card with its copy
 * control), broken anywhere where it does not, and the copy control
 * (`children`) right after the last character, never on a line alone
 */
const WalletAddress = ({
  address,
  children,
}: {
  address: string;
  children: ReactNode;
}) => (
  <span className="min-w-0 font-mono text-[0.6875rem] break-all text-foreground">
    {address.slice(0, -TAIL)}
    <span className="whitespace-nowrap">
      {address.slice(-TAIL)}
      {children}
    </span>
  </span>
);

export default WalletAddress;
