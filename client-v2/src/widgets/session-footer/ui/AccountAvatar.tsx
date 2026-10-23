import { CircleUserRound } from "lucide-react";
import { cn } from "@/shared/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";

interface AccountAvatarProps {
  image: string | null;
  /** A feedback send is in flight: a halo pulses behind the avatar */
  sending: boolean;
  className?: string;
}

/** The account's avatar, or a user icon; the halo says a send is still going */
const AccountAvatar = ({ image, sending, className }: AccountAvatarProps) => (
  <span className="relative inline-flex shrink-0">
    {sending && (
      <span
        aria-hidden="true"
        data-slot="feedback-pulse"
        className="pointer-events-none absolute -inset-1 rounded-full bg-primary/40 motion-safe:animate-ping"
      />
    )}
    <Avatar className={cn("size-6", className)}>
      <AvatarImage src={image ?? undefined} alt="" />
      <AvatarFallback className="bg-transparent">
        <CircleUserRound aria-hidden />
      </AvatarFallback>
    </Avatar>
  </span>
);

export default AccountAvatar;
