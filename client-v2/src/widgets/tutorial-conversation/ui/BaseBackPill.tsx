import { ArrowDown } from "lucide-react";

import { Button } from "@/shared/ui/button";

export interface BaseBackPillProps {
  /** "Back to step 3", or "Back to the start" before Start */
  label: string;
  onClick: () => void;
}

/** Floats above the feed's foot while the live card is off screen, or the feed is on another step */
const BaseBackPill = ({ label, onClick }: BaseBackPillProps) => (
  <Button
    variant="outline"
    size="xs"
    onClick={onClick}
    className="absolute bottom-3 left-1/2 z-10 h-7 -translate-x-1/2 animate-menu-in gap-1.5 rounded-full border-border-strong bg-surface-raised pr-3 pl-2.5 text-[0.75rem] font-act shadow-panel"
  >
    <ArrowDown aria-hidden="true" className="size-3.5" />
    {label}
  </Button>
);

export default BaseBackPill;
