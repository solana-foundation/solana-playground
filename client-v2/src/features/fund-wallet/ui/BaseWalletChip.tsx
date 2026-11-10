import { ArrowUpRight, Wallet } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { shortAddress } from "@/shared/lib/short-address";
import { shortKey } from "@/shared/lib/short-key";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/ui/copy-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Separator } from "@/shared/ui/separator";
import { Spinner } from "@/shared/ui/spinner";
import { Tag } from "@/shared/ui/tag";

/**
 * Where asking the faucet stands: `away` while the web faucet is open in
 * another tab, until the balance rises
 */
export type AirdropState = "idle" | "asking" | "refused" | "away" | "received";

export interface BaseWalletChipProps {
  /** The deploying wallet's address */
  address: string;
  /** In SOL; absent while it is read */
  balance?: number;
  /** As `PgConnection.cluster` names it; absent before it is read */
  cluster?: string;
  /** The cluster has a faucet: Get SOL and the web faucet show only then */
  faucet: boolean;
  /** What one airdrop asks for, in SOL */
  airdropSol: number;
  /** The web faucet, filled in with the address and amount */
  faucetHref: string;
  /** Steps through the web faucet, shown once the faucet refused */
  faucetSteps: string[];
  state: AirdropState;
  /** What `received` adds, in SOL; omitted when the rise is unknown */
  received?: number;
  /** A public faucet asks for a GitHub sign-in first, and nobody is in */
  signInFirst: boolean;
  onOpenChange?: (open: boolean) => void;
  onAirdrop: () => void;
  onOpenFaucet: () => void;
  onFund: () => void;
}

const fmt = (sol: number) => `${Number(sol.toFixed(4))} SOL`;

const clusterName = (cluster: string) =>
  cluster === "mainnet-beta"
    ? "Mainnet"
    : cluster.charAt(0).toUpperCase() + cluster.slice(1);

/**
 * The deploying wallet at the console bar's end: address and balance, there
 * for everyone, signed in or not, next to the builds and deploys it pays for
 * (Sergey and Natalia, 10 Nov). Its popover is two blocks: the wallet, then
 * topping it up with one main button per state. An airdrop says how it went
 * here, not only in the terminal, which may be folded; a refusal spells out
 * the web faucet, and the balance rising ends the wait on its own.
 */
const BaseWalletChip = ({
  address,
  balance,
  cluster,
  faucet,
  airdropSol,
  faucetHref,
  faucetSteps,
  state,
  received,
  signInFirst,
  onOpenChange,
  onAirdrop,
  onOpenFaucet,
  onFund,
}: BaseWalletChipProps) => {
  const short = shortAddress(address);
  const shown = balance === undefined ? "…" : fmt(balance);
  const empty = balance === 0;
  const twoBelow = state === "refused" || state === "away";
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-wallet-chip
          aria-label={`Wallet ${short}${
            cluster ? ` on ${clusterName(cluster)}` : ""
          }, ${shown}`}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wallet aria-hidden="true" className="size-3.5" />
          <span className="font-mono">{short}</span>
          <span aria-hidden="true">·</span>
          <span className={cn("tabular-nums", empty && "text-warning")}>
            {shown}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-72 gap-0 p-0"
      >
        {/* The wallet: what it is, how much it holds, its address. The
            network is a tag, since it's a state; mainnet's is yellow */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[0.8125rem] font-act text-foreground">
              Playground wallet
            </span>
            {cluster && (
              <Tag variant={cluster === "mainnet-beta" ? "warning" : "neutral"}>
                {clusterName(cluster)}
              </Tag>
            )}
          </div>
          <p className="mt-3 text-2xl leading-none font-act tabular-nums text-foreground">
            {shown}
          </p>
          <div className="mt-1.5 flex h-4 items-center gap-0.5">
            <span className="font-mono text-[0.75rem] text-muted-foreground">
              {shortKey(address)}
            </span>
            <CopyButton
              value={address}
              label="Copy address"
              className="-my-1"
              onError={reportButtonFailure("copy the address")}
            />
          </div>
        </div>
        <Separator />

        {/* Topping it up: one main action per state */}
        <div className="flex flex-col gap-3 p-4">
          {state === "refused" && (
            <>
              <p className="text-[0.8125rem] font-act text-foreground">
                The faucet is at its limit
              </p>
              <ol
                aria-label="Get SOL from the web faucet"
                className="flex flex-col gap-1.5 text-[0.75rem] leading-4 text-foreground/80"
              >
                {faucetSteps.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="w-3 shrink-0 text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </>
          )}
          {state === "away" && (
            <p
              role="status"
              className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground"
            >
              <Spinner className="size-3.5" />
              Waiting for SOL from the web faucet…
            </p>
          )}
          {state === "received" && (
            <p role="status" className="text-[0.8125rem] text-success">
              {received
                ? `Got ${fmt(received)}. You're ready to deploy`
                : "Airdrop landed. You're ready to deploy"}
            </p>
          )}

          {faucet && (state === "idle" || state === "asking") && (
            <div className="flex flex-col gap-1.5">
              <Button
                className="w-full"
                disabled={state === "asking"}
                onClick={onAirdrop}
              >
                {state === "asking" ? (
                  <>
                    <Spinner className="size-3.5" />
                    Asking the faucet…
                  </>
                ) : (
                  `Get ${airdropSol} ${cluster ? `${cluster} ` : ""}SOL`
                )}
              </Button>
              {signInFirst && state === "idle" && (
                <p className="text-center text-[0.75rem] text-muted-foreground">
                  Asks you to sign in with GitHub first
                </p>
              )}
            </div>
          )}
          {state === "refused" && (
            <Button asChild className="w-full">
              <a
                href={faucetHref}
                target="_blank"
                rel="noreferrer"
                onClick={onOpenFaucet}
              >
                Open the web faucet
                <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
          )}

          {/* The other ways, as real buttons under the main one: half width
              side by side, or full width alone */}
          {state !== "received" && (
            <div className={cn("grid gap-2", twoBelow && "grid-cols-2")}>
              {state === "refused" && (
                <Button variant="secondary" size="sm" onClick={onAirdrop}>
                  Try again
                </Button>
              )}
              {state === "away" && (
                <Button asChild variant="secondary" size="sm">
                  <a href={faucetHref} target="_blank" rel="noreferrer">
                    Open it again
                  </a>
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={onFund}>
                {twoBelow ? "Use your wallet" : "Send from your wallet"}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default BaseWalletChip;
