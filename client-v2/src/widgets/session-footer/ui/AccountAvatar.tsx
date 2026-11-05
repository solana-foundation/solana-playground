import { CircleUserRound } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";

interface AccountAvatarProps {
  image: string | undefined;
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
    {/* The photo's ring goes with the photo: the glyph has a circle of its own */}
    <Avatar
      className={cn(
        "size-6 has-[[data-slot=avatar-fallback]]:after:hidden",
        className
      )}
    >
      <AvatarImage src={image} alt="" />
      {/* Signed out: the user glyph as the avatar's own outline, as wide as
          a photo would be, with no disc behind it */}
      <AvatarFallback className="bg-transparent text-muted-foreground [&>svg]:size-full [&>svg]:stroke-[1.5]">
        <CircleUserRound aria-hidden />
      </AvatarFallback>
    </Avatar>
  </span>
);

export default AccountAvatar;
