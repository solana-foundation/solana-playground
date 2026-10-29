import type { Effort } from "../../../views/sidebar/assistant/model/types";
import { EFFORT_LABELS } from "../../../views/sidebar/assistant/model/labels";
import type { EffortChoice } from "../model/choice";
import { ComposerEffort } from "@/shared/ui/composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** Picks how hard the model thinks, from the levels its provider offers */
export function BaseEffortMenu({
  effort,
  onChange,
  disabled,
}: {
  effort: EffortChoice;
  onChange(e: Effort): void;
  disabled: boolean;
}) {
  const { value, ladder } = effort;
  // A level the ladder lacks has no honest place on it, so show nothing
  if (!ladder.includes(value)) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <ComposerEffort
          value={ladder.indexOf(value) + 1}
          max={ladder.length}
          label={EFFORT_LABELS[value]}
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const picked = ladder.find((level) => level === next);
            if (picked) onChange(picked);
          }}
        >
          {ladder.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>
              {EFFORT_LABELS[level]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
