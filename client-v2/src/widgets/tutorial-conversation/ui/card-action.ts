/**
 * A card's actions, whatever their variant: one height and the heading face,
 * so a filled button and a grey one beside it line up. 40 px with a mouse, 44
 * px under a finger (the prototype's `ui/type.ts`, `f7d42bf2e`).
 */
export const ACTION =
  "h-10 gap-2 px-4 font-heading text-[0.9375rem] font-medium pointer-coarse:h-11";

/** The filled one brightens on hover instead of fading toward the card */
export const ACTION_FILL = "hover:bg-(--accent-fill-hover)";

/** The action beside it: a grey fill, no border, the text a step under */
export const ACTION_SOFT =
  "border-0 bg-foreground/10 text-foreground/90 shadow-none hover:bg-foreground/15 hover:text-foreground";

/**
 * A card's action on a phone, 48 px under the thumb. The coarse pointer height
 * is named again because `ACTION`'s 44 px would otherwise win over it.
 */
export const PHONE_CTA = "max-md:h-12 max-md:pointer-coarse:h-12";
