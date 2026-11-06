import { createContext, useContext } from "react";

import type { Viewport } from "@/shared/lib/hooks/use-viewport";

/**
 * Whether the cards are drawn for the phone layout, below the tutorial
 * frame's width: no way to type code, no key hints, rows and buttons sized
 * for a finger. `tablet` is the band from 768 to 1023 px, where the chat is
 * 640 px wide and a card's main button sizes to its label rather than the
 * card's width.
 */
export interface PhoneLayout {
  phone: boolean;
  tablet: boolean;
}

const DESKTOP: PhoneLayout = { phone: false, tablet: false };

/** The phone layout of a viewport: anything under the frame's width */
export const phoneLayoutOf = (viewport: Viewport): PhoneLayout => ({
  phone: viewport !== "wide",
  tablet: viewport === "compact",
});

/** Provided by `TutorialConversation`; a card drawn outside it is the desktop's */
export const PhoneLayoutContext = createContext<PhoneLayout>(DESKTOP);

export const usePhone = (): PhoneLayout => useContext(PhoneLayoutContext);

/**
 * A card's main action's width on the phone layout: the card's full width
 * under the thumb, or on a tablet at least 240 px and sized to its label
 */
export const phoneCtaWidth = ({ phone, tablet }: PhoneLayout) => {
  if (!phone) return undefined;
  return tablet ? "min-w-60" : "w-full";
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/ui/phone", () => {
    it("reads the phone layout off every viewport under the frame's width", () => {
      expect(phoneLayoutOf("wide")).toEqual({ phone: false, tablet: false });
      expect(phoneLayoutOf("compact")).toEqual({ phone: true, tablet: true });
      expect(phoneLayoutOf("phone")).toEqual({ phone: true, tablet: false });
    });

    it("widens a card's action to the card on a phone, and to 240 px on a tablet", () => {
      expect(phoneCtaWidth(phoneLayoutOf("wide"))).toBeUndefined();
      expect(phoneCtaWidth(phoneLayoutOf("phone"))).toBe("w-full");
      expect(phoneCtaWidth(phoneLayoutOf("compact"))).toBe("min-w-60");
    });
  });
}
