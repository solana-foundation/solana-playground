import { useEffect, useState } from "react";

import type { AccountView } from "@/entities/tutorial";
import type { AccountOnCard, Press } from "@/features/tutorial-conversation";

import { heapOf, playerNow } from "../model/account-card";
import BaseMemoryCard from "./BaseMemoryCard";
import BasePlayerCard from "./BasePlayerCard";

type Player = Extract<AccountView, { kind: "player" }>;

/** The player now, ticking once a second while energy is on its way back */
const LivePlayer = ({
  view,
  reading,
  className,
}: AccountOnCard & { view: Player; className?: string }) => {
  const [now, setNow] = useState(() => Date.now());
  const { energy, wood, nextMs } = playerNow({ view, reading, now });
  const isComing = nextMs !== undefined;
  // A new reading starts from its own time, not the last tick's
  useEffect(() => setNow(Date.now()), [reading]);
  useEffect(() => {
    if (!isComing) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isComing]);
  return (
    <BasePlayerCard
      address={reading.address}
      energy={energy}
      max={view.max}
      wood={wood}
      nextMs={nextMs}
      className={className}
    />
  );
};

export interface BaseAccountViewProps {
  account: AccountOnCard;
  /** The card's presses, which say whether the last read ran out of heap */
  presses?: readonly Press[];
  /** Draw the heap: an act card does, a result card only says the size */
  heap?: boolean;
  /** As the run left it, not as it is now: a result card is a record */
  still?: boolean;
  className?: string;
}

/** The account a lesson is about, as its view says to draw it */
const BaseAccountView = ({
  account: { view, reading },
  presses = [],
  heap = false,
  still = false,
  className,
}: BaseAccountViewProps) => {
  if (view.kind === "player" && still) {
    const { energy, wood } = playerNow({
      view: { ...view, refill: undefined },
      reading,
      now: 0,
    });
    return (
      <BasePlayerCard
        address={reading.address}
        energy={energy}
        max={view.max}
        wood={wood}
        className={className}
      />
    );
  }
  return view.kind === "player" ? (
    <LivePlayer view={view} reading={reading} className={className} />
  ) : (
    <BaseMemoryCard
      address={reading.address}
      size={reading.size}
      capacity={view.capacity}
      heap={heap ? heapOf({ view, reading, presses }) : undefined}
      zero={view.zero ?? false}
      className={className}
    />
  );
};

export default BaseAccountView;
