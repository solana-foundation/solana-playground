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

/** Whether an option is the one the composer shows: the default by its provider, a keyed one by provider and model id */
const isShown = (model: ModelShown, option: ModelOption) => {
  if (model.kind === "default") return option.provider === "default";
  if (model.kind === "keyed") {
    return option.provider === model.provider && option.model === model.model;
  }
  return false;
};

/** The composer's model button: opens the model menu, or Connect a model when there is nothing to send to */
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
      <DropdownMenuTrigger asChild disabled={disabled}>
        <ComposerModel disabled={disabled}>{model.label}</ComposerModel>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
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
              <MenuItemText>
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
