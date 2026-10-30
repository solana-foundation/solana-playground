import { ComposerModel } from "@/shared/ui/composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { MenuItemDescription, MenuItemText } from "@/shared/ui/menu-extras";
import type { ModelOption, ModelShown } from "../model/choice";
import { OverflowTooltip } from "./OverflowTooltip";

/** Whether an option is the one the composer shows: the default by its provider, a keyed one by provider and model id */
const isShown = (model: ModelShown, option: ModelOption) => {
  if (model.kind === "default") return option.provider === "default";
  if (model.kind === "keyed") {
    return option.provider === model.provider && option.model === model.model;
  }
  return false;
};

/**
 * The composer's model button: opens the model menu, or Connect a model when
 * there is nothing to send to. At most 12rem wide, so a long model id ends in
 * "…" rather than pushing Effort and Send out of the box; the cut name shows
 * whole in a tooltip and in the menu.
 */
export function BaseModelMenu({
  model,
  options,
  onPick,
  onConnect,
  disabled,
}: {
  model: ModelShown;
  options: ModelOption[];
  onPick(o: ModelOption): void;
  onConnect(): void;
  disabled: boolean;
}) {
  if (model.kind === "checking") {
    // Takes the place of the label the probe is about to settle, so the
    // button does not first offer to connect and then rename itself
    return (
      <ComposerModel disabled aria-label="Checking the model…">
        <span aria-hidden="true">…</span>
      </ComposerModel>
    );
  }
  if (model.kind === "none") {
    return (
      <ComposerModel onClick={onConnect} disabled={disabled}>
        Connect a model
      </ComposerModel>
    );
  }
  const current = options.findIndex((option) => isShown(model, option));
  return (
    <DropdownMenu>
      {/* The menu's trigger outside the tooltip's: its `data-state` (open,
          closed) is the one the button keeps */}
      <DropdownMenuTrigger asChild disabled={disabled}>
        <OverflowTooltip label={model.label}>
          {/* Its own slot named again: both triggers pass theirs down, and
              the design system's name for the button would be lost */}
          <ComposerModel
            data-slot="composer-model"
            disabled={disabled}
            className="max-w-48 min-w-0"
          >
            <span data-overflow="" className="truncate">
              {model.label}
            </span>
          </ComposerModel>
        </OverflowTooltip>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-w-[min(20rem,calc(100vw-2rem))] min-w-56"
      >
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current < 0 ? "" : String(current)}
          onValueChange={(index) => {
            const picked = options[Number(index)];
            if (picked) onPick(picked);
          }}
        >
          {options.map((option, index) => (
            <DropdownMenuRadioItem
              key={`${option.provider}:${option.model ?? ""}`}
              value={String(index)}
            >
              {/* A model id has no spaces: it breaks anywhere rather than
                  widening the menu past the screen */}
              <MenuItemText className="[overflow-wrap:anywhere]">
                {option.label}
                {option.provider === "default" && (
                  <MenuItemDescription>no key needed</MenuItemDescription>
                )}
              </MenuItemText>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onConnect}>
          <MenuItemText>Connect with a key…</MenuItemText>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
