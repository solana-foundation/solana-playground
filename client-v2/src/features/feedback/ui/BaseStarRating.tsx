import { useId } from "react";
import { cn } from "@/shared/lib/utils";
import { Star } from "lucide-react";

import type { Rating } from "../model/provider";

const STARS: Rating[] = [1, 2, 3, 4, 5];

export interface BaseStarRatingProps {
  value?: Rating;
  onChange: (rating: Rating) => void;
  disabled?: boolean;
}

/** Five native radios, so the browser gives arrow keys and a single tab stop */
export const BaseStarRating = ({
  value,
  onChange,
  disabled,
}: BaseStarRatingProps) => {
  // Radios sharing a name form one group, so each form gets its own
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label="Rating"
      className="flex items-center justify-center gap-1"
    >
      {STARS.map((star) => (
        <label key={star} className="cursor-pointer p-1">
          <input
            type="radio"
            name={name}
            value={star}
            aria-label={`${star} of ${STARS.length} stars`}
            checked={value === star}
            disabled={disabled}
            onChange={() => onChange(star)}
            className="peer sr-only"
          />
          <Star
            aria-hidden="true"
            className={cn(
              "size-8 rounded-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
              value && star <= value
                ? "fill-primary text-primary"
                : "fill-surface-raised text-surface-raised"
            )}
          />
        </label>
      ))}
    </div>
  );
};
