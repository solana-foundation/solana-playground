import { DEVNET_FAUCET_SOL, webFaucetSteps } from "@/shared/lib/faucet";
import { cn } from "@/shared/lib/utils";

import { READ } from "./Prose";

/**
 * The web faucet in three steps, under a card that says the wallet is
 * short. The card's own Try again comes after, so the last step points to it
 */
const FaucetSteps = () => (
  <ol
    aria-label="Get devnet SOL from the web faucet"
    className="flex flex-col gap-1.5"
  >
    {webFaucetSteps(
      DEVNET_FAUCET_SOL,
      "Come back here and press Try again"
    ).map((step, i) => (
      <li key={step} className={cn("flex gap-2", READ)}>
        <span className="w-3 shrink-0 text-muted-foreground tabular-nums">
          {i + 1}
        </span>
        {step}
      </li>
    ))}
  </ol>
);

export default FaucetSteps;
