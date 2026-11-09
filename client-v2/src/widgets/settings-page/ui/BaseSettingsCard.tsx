import type { ReactNode } from "react";

interface BaseSettingsCardProps {
  /** A small title over the card, when a section holds more than one */
  title?: string;
  children: ReactNode;
}

/** A group of rows on one quiet card, hairlines between them */
const BaseSettingsCard = ({ title, children }: BaseSettingsCardProps) => (
  <div className="flex flex-col gap-2">
    {title && (
      // A quiet label, so the section's own title and line stay the only
      // block of text above the cards
      <h3 className="px-1 text-xs font-act text-muted-foreground">{title}</h3>
    )}
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-panel">
      {children}
    </div>
  </div>
);

export default BaseSettingsCard;
