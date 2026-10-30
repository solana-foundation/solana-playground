import { CircleAlert, ExternalLink } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";
import type { FundingFailure } from "@/commands/deploy/run";
import { formatSol, networkName, shortKey } from "../model/format";

/** Solana's web faucet; it serves devnet and testnet */
export const WEB_FAUCET_URL = "https://faucet.solana.com";

export interface BaseNotEnoughSolProps {
  cluster: string | null;
  reason: FundingFailure;
  /** Lamports the wallet holds */
  balance: number;
  /** Lamports the deploy needs */
  needed: number;
  address: string;
  /** What the airdrop said when it refused */
  cause: string | null;
  onRetry: () => void;
  onSignIn: () => void;
}

const reasonLine = (reason: FundingFailure, network: string) => {
  const lines: Record<FundingFailure, string> = {
    signed_out: `Sign in with GitHub to request ${network} SOL.`,
    no_faucet: "This network has no faucet. Send SOL to the wallet below.",
    airdrop_failed: "The faucet did not send SOL.",
  };
  return lines[reason];
};

/** The deploy stopped because the paying wallet holds too little SOL */
const BaseNotEnoughSol = (p: BaseNotEnoughSolProps) => {
  const network = networkName(p.cluster);
  const hasWebFaucet = p.cluster === "devnet" || p.cluster === "testnet";

  return (
    <Callout variant="error" role="alert" aria-label="Not enough SOL">
      <CircleAlert />
      <CalloutTitle>Not enough {network} SOL</CalloutTitle>
      <CalloutDescription className="flex flex-col gap-2">
        <span>
          This deploy needs {formatSol(p.needed)} SOL. The wallet has{" "}
          {formatSol(p.balance)} SOL.
        </span>
        <span>
          {reasonLine(p.reason, network)}
          {p.cause && <span className="text-subtle"> {p.cause}</span>}
        </span>
        <span className="flex items-center gap-2 rounded-lg bg-surface-base px-3 py-1.5">
          <span className="text-caption text-subtle">Wallet</span>
          <code className="font-mono text-code" title={p.address}>
            {shortKey(p.address)}
          </code>
          <CopyButton
            value={p.address}
            label="Copy the wallet address"
            className="ml-auto"
            onError={reportButtonFailure("copy the wallet address")}
          />
        </span>
        <span className="flex flex-wrap gap-2">
          {p.reason === "signed_out" ? (
            <Button size="sm" onClick={p.onSignIn}>
              Sign in with GitHub
            </Button>
          ) : (
            <Button size="sm" onClick={p.onRetry}>
              Try again
            </Button>
          )}
          {hasWebFaucet && (
            <Button size="sm" variant="outline" asChild>
              <a
                href={WEB_FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open faucet
                <ExternalLink data-icon="inline-end" />
              </a>
            </Button>
          )}
        </span>
      </CalloutDescription>
    </Callout>
  );
};

export default BaseNotEnoughSol;
