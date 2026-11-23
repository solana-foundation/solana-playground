import { Button } from "@/shared/ui/button";

/** Where "Privacy policy" opens, in a new tab */
export const PRIVACY_POLICY_URL = "https://solana.com/privacy-policy";

interface BaseConsentBannerProps {
  onDecline: () => void;
  onAllow: () => void;
}

/**
 * The question Playground asks a visitor once, at the foot of the window
 * (`analytics-consent`). It only draws: the choice is stored and tracked by
 * `ConsentBanner`. The look is a first pass, until the banner is designed.
 */
export const BaseConsentBanner = ({
  onDecline,
  onAllow,
}: BaseConsentBannerProps) => (
  <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-4">
    <div
      role="region"
      aria-label="Analytics consent"
      className="pointer-events-auto mx-auto flex max-w-160 flex-col gap-3 rounded-xl border border-border bg-popover p-4 font-sans text-popover-foreground shadow-lg sm:flex-row sm:items-center sm:gap-4"
    >
      <p className="flex-1 text-caption">
        Playground uses Google Analytics to see which features people use. Allow
        it?{" "}
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground underline underline-offset-2"
        >
          Privacy policy
        </a>
      </p>
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" onClick={onDecline}>
          Decline
        </Button>
        <Button onClick={onAllow}>Allow</Button>
      </div>
    </div>
  </div>
);
