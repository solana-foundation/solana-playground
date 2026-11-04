import { ArrowLeft, ChevronDown, X } from "lucide-react";
import {
  Dispatch,
  FC,
  type JSX,
  ReactNode,
  SetStateAction,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Spinner } from "@/shared/ui/spinner";

import { useKeybind, useOnClickOutside } from "../../hooks";
import { Arrayable, Getable, PgCommon } from "../../utils";
import type { InputProps } from "../Input";

const log = createLogger("components:search-bar");

export interface SearchBarProps extends InputProps {
  items?: Item[] | null;
  initialSelectedItems?: Arrayable<Item>;
  showSearchOnMount?: boolean;
  labelToSelectOnPaste?: string;
  restoreIfNotSelected?: boolean;
  /**
   * The item, by label, that gets a button of its own in the field instead
   * of a row in the list: Interact's Random, one press and no menu. The
   * button says its label: an icon this small read as the Copy beside it.
   */
  inlineItem?: { label: string };
  /** Drawn last inside the field, after its own buttons: Interact's Copy */
  endAddon?: ReactNode;
  onSearch?: (ev: { input: InputProps["value"]; item: NormalizedItem }) => void;
  filter?: (args: {
    input: InputProps["value"];
    item: NormalizedItem;
    items: NormalizedItem[];
  }) => boolean;
  setSelectedItems?: Dispatch<SetStateAction<NormalizedItem[]>>;
}

export type NormalizedItem = Exclude<Item, string> & { isSelected?: boolean };
type Item = string | (CommonItemProps & (NestableItem | DropdownableItem));

type CommonItemProps = {
  label: string;
  matches?: Array<string | RegExp> | ((value: string) => boolean);
  onlyShowIfValid?: boolean;
  closeButton?: boolean;
  element?: ReactNode;
  onSelect?: (item: Item) => void;
};

type NestableItem = {
  value?: string | ((value: string) => string) | { current: true };
  data?: any;
  items?: Getable<Item[]> | (() => Promise<Item[]>) | null;
  DropdownComponent?: never;
};

type DropdownableItem = {
  value?: never;
  data?: never;
  items?: never;
  DropdownComponent: (props: DropdownProps) => JSX.Element;
};

export type DropdownProps = {
  search: (item: Item) => void;
};

const SearchBar: FC<React.PropsWithChildren<SearchBarProps>> = ({
  items: allItems,
  initialSelectedItems,
  showSearchOnMount,
  labelToSelectOnPaste,
  restoreIfNotSelected,
  inlineItem: inline,
  endAddon,
  onSearch,
  filter,
  setSelectedItems: _setSelectedItems,
  onClick,
  onPaste,
  onChange,
  error,
  setError,
  validator,
  ...props
}) => {
  const inlineLabel = inline?.label;
  const inlineItem = inlineLabel
    ? allItems?.find((item) => normalizeItem(item).label === inlineLabel)
    : undefined;
  const items = useMemo(
    () =>
      inlineLabel
        ? allItems?.filter((item) => normalizeItem(item).label !== inlineLabel)
        : allItems,
    [allItems, inlineLabel]
  );
  // A field with nothing to pick (Account's address, an Interact number whose
  // one pick is its inline Random) is a plain textbox. An item shown only
  // when the input is valid (Custom) echoes what was typed: not a pick.
  const offersPicks = !!items?.some(
    (item) => !normalizeItem(item).onlyShowIfValid
  );
  // A field with items gets a chevron and one without gets no icon, so a
  // value field does not read as a search box
  const showsChevron = offersPicks;

  const inputRef = useRef<HTMLInputElement>(null);
  const lastValue = useRef(props.value);
  const setInputValue = (value: string, opts?: { focus: boolean }) => {
    const input = inputRef.current!;
    PgCommon.changeInputValue(input, value);

    // Last value should only be updated when `setInputValue` function runs and
    // not when `onChange` callback runs because we want to restore to the last
    // value SearchBar set (a pick or a clear) when the user leaves the field.
    lastValue.current = value;

    if (opts?.focus) input.focus();
  };
  const getItemValue = (item: NormalizedItem) => {
    const currentValue = inputRef.current?.value ?? props.value;
    return item.value !== undefined
      ? typeof item.value === "string"
        ? item.value
        : typeof item.value === "function"
        ? item.value(currentValue)
        : currentValue
      : item.label;
  };

  // What the validator last said. A caller that passes `setError` holds the
  // error itself and its `error` alone is shown, so it can also clear it; the
  // legacy `Input` behaved the same way.
  const [validationError, setValidationError] = useState<InputError>(null);
  const shownError = setError ? error : validationError || error;

  /** Whether the validator accepts `value`; one that throws rejects it */
  const isValid = (value: string) => {
    try {
      return validator?.(value);
    } catch (e) {
      // A throw is the validator's way of saying "invalid, and here is why";
      // the why is shown by `onChange`, the list only needs the answer
      log.debug("The validator rejected a value by throwing", {
        context: { message: e instanceof Error ? e.message : String(e) },
      });
      return false;
    }
  };

  const [isVisible, setIsVisible] = useState(showSearchOnMount);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const reset = () => {
    // Hide search results
    setIsVisible(false);

    // Reset back to the original items
    setItemState({ items, isInSubSearch: false });

    // Reset the input to its last saved value. A plain textbox keeps what
    // was typed: there is no list it could have been picked from.
    if (restoreIfNotSelected && offersPicks) setInputValue(lastValue.current);
  };
  /** Opens the list, if the field has one */
  const openList = () => {
    if (offersPicks) setIsVisible(true);
  };
  useKeybind("Escape", () => {
    if (document.activeElement === inputRef.current) reset();
  });

  const [itemState, setItemState] = useState<{
    items: typeof items;
    isInSubSearch: boolean;
    closeButton?: boolean;
    Component?: (props: DropdownProps) => JSX.Element;
  }>({
    items,
    isInSubSearch: false,
  });
  const [selectedItems, setSelectedItems] = useState<{
    pending: NormalizedItem[];
    completed: NormalizedItem[];
  }>({
    pending: [],
    completed: PgCommon.toArray(initialSelectedItems ?? []).map(normalizeItem),
  });
  const selectedItemRef = useRef<HTMLDivElement>(null);

  // Sync changes
  useEffect(() => {
    setItemState((prevState) => {
      if (prevState.isInSubSearch) return prevState;
      return { ...prevState, items };
    });
  }, [items]);
  useEffect(() => {
    _setSelectedItems?.(selectedItems.completed);
  }, [selectedItems, _setSelectedItems]);

  const normalizedItems =
    isVisible &&
    itemState.items?.map(normalizeItem).map((item) => {
      const isSelected = selectedItems.completed.some((selectedItem) => {
        return selectedItem.label === item.label;
      });

      return { ...item, isSelected };
    });
  const filteredItems = normalizedItems
    ? filter
      ? normalizedItems.filter((item) =>
          filter({
            input: props.value,
            item,
            items: normalizedItems,
          })
        )
      : normalizedItems.filter((item) => {
          if (item.onlyShowIfValid) {
            return isValid(getItemValue(item));
          }

          // Show all options if the input is valid
          if (isValid(props.value)) return true;

          if (typeof item.matches === "function") {
            return item.matches(props.value);
          }

          const matches = item.matches ?? [item.label];
          const lowerCaseValue = props.value.toLowerCase();
          return matches.some((match) => {
            return typeof match === "string"
              ? match.toLowerCase().includes(lowerCaseValue)
              : match.test(lowerCaseValue);
          });
        })
    : null;

  const [loading, setLoading] = useState(false);
  const searchCommon = async (_item: Item) => {
    const item = normalizeItem(_item);

    let isInSubSearch = false;
    let isCompleted = false;

    if (item.items) {
      setLoading(true);
      try {
        setItemState({
          items: await PgCommon.callIfNeeded(item.items),
          isInSubSearch: true,
          closeButton: item.closeButton,
        });
        isInSubSearch = true;
      } catch (e) {
        reportButtonFailure(`load ${item.label}`)(e);
        return;
      } finally {
        setLoading(false);
      }

      setInputValue("", { focus: true });
    } else if (item.DropdownComponent) {
      setItemState({
        items: null,
        isInSubSearch: true,
        closeButton: item.closeButton,
        Component: item.DropdownComponent,
      });
      isInSubSearch = true;
    } else {
      setInputValue(getItemValue(item));
      isCompleted = true;
    }

    item.onSelect?.(item);

    if (isCompleted) {
      setSelectedItems((prevSelected) => {
        if (!prevSelected.pending.length)
          return { ...prevSelected, completed: [item] };
        return { completed: [...prevSelected.pending, item], pending: [] };
      });
      onSearch?.({ input: props.value, item });
    } else {
      setSelectedItems((prevSelected) => ({
        ...prevSelected,
        pending: [item],
      }));
    }

    if (isInSubSearch) {
      setKeyboardSelectionIndex(null);
      selectedItemRef.current?.scrollIntoView({ block: "center" });
    } else reset();
  };
  /** `searchCommon` from a click or a key, its failure told to the user */
  const pick = (item: Item) => {
    searchCommon(item).catch(
      reportButtonFailure(`pick ${normalizeItem(item).label}`)
    );
  };
  const searchTopResult = () => {
    if (filteredItems && keyboardSelectionIndex !== null) {
      const selectedItem = filteredItems.at(keyboardSelectionIndex);
      if (selectedItem) pick(selectedItem);
    } else openList();
  };
  useKeybind("Enter", {
    handle: () => {
      if (document.activeElement === inputRef.current) searchTopResult();
    },
    opts: { noPreventDefault: true },
  });

  // Keyboard navigation
  const [keyboardSelectionIndex, setKeyboardSelectionIndex] = useState<
    number | null
  >(null);

  // Handle the keyboard selection index
  useEffect(() => {
    if (!filteredItems) {
      // No `filteredItems` means no item list is shown (closed, or a custom
      // page), so there is nothing to select
      setKeyboardSelectionIndex(null);
    } else if (keyboardSelectionIndex === null) {
      // If the selection index was set to `null`, it means the dropdown has
      // just got mounted, therefore, either set the selection index to the
      // actual selected item, or if the selected item doesn't exist, select
      // the first item
      const index = filteredItems.findIndex((item) => item.isSelected);
      setKeyboardSelectionIndex(index === -1 ? 0 : index);
    } else {
      // If there is a selection, check whether the selected item exists in the
      // `filteredItems`, if it doesn't exist, select the first item
      const keyboardSelectedItem = filteredItems.at(keyboardSelectionIndex);
      if (!keyboardSelectedItem) setKeyboardSelectionIndex(0);
    }
  }, [filteredItems, keyboardSelectionIndex]);

  useKeybind(
    [
      {
        keybind: "ArrowDown",
        handle: () => {
          if (!filteredItems?.length) {
            if (document.activeElement === inputRef.current) openList();
            return;
          }

          setKeyboardSelectionIndex((i) => {
            if (i === null || !filteredItems.length) return null;
            if (i === filteredItems.length - 1) return 0;
            return i + 1;
          });
        },
      },
      {
        keybind: "ArrowUp",
        handle: () => {
          if (!filteredItems?.length) {
            if (document.activeElement === inputRef.current) openList();
            return;
          }

          setKeyboardSelectionIndex((i) => {
            if (i === null || !filteredItems.length) return null;
            if (i === 0) return filteredItems.length - 1;
            return i - 1;
          });
        },
      },
    ],
    [filteredItems?.length]
  );

  // Close on outside click. The list renders in a portal, outside the
  // wrapper, so a press in this field's own list is not outside.
  const listId = useId();
  useOnClickOutside(
    wrapperRef,
    reset,
    isVisible && !itemState.closeButton,
    `[data-search-bar-list="${listId}"]`
  );

  const isOpen = !!(filteredItems || itemState.Component);
  // The list renders in a portal on `body`, so it would outlive a field the
  // layout takes away while keeping it mounted: off the page under Home, or
  // `inert` under a page such as Tutorials. Close it when that happens.
  useEffect(() => {
    const input = inputRef.current;
    if (!isOpen || !input) return;

    const closeIfGone = () => {
      if (!input.isConnected || input.closest("[inert]")) reset();
    };
    const visibility = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) reset();
    });
    visibility.observe(input);
    const inertness = new MutationObserver(closeIfGone);
    inertness.observe(document.body, {
      attributes: true,
      attributeFilter: ["inert"],
      subtree: true,
    });
    return () => {
      visibility.disconnect();
      inertness.disconnect();
    };
    // `reset` is rebuilt every render; the observers only need the open state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const highlighted =
    keyboardSelectionIndex === null
      ? ""
      : filteredItems?.at(keyboardSelectionIndex)?.label ?? "";

  return (
    <div ref={wrapperRef} className="w-full">
      {typeof shownError === "string" && shownError && (
        <p className="mb-2 text-xs text-destructive">{shownError}</p>
      )}

      <Popover open={isOpen}>
        <PopoverAnchor>
          <InputGroup>
            <InputGroupInput
              ref={inputRef}
              role={offersPicks ? "combobox" : undefined}
              aria-expanded={offersPicks ? isOpen : undefined}
              aria-autocomplete={offersPicks ? "list" : undefined}
              aria-invalid={shownError ? true : undefined}
              autoComplete="off"
              autoFocus={showSearchOnMount}
              onClick={(ev) => {
                onClick?.(ev);
                openList();
              }}
              onChange={(ev) => {
                let err: InputError = null;
                if (validator) {
                  try {
                    if (validator(ev.target.value) === false) err = true;
                  } catch (e) {
                    // The message is the error the field shows
                    err = (e instanceof Error && e.message) || true;
                  }
                }
                setValidationError(err);
                setError?.(err);

                onChange?.(ev);
              }}
              onPaste={(ev) => {
                onPaste?.(ev);

                // Default to the pasted text if the label to select is not specified
                const clipboardText = ev.clipboardData.getData("text");

                // Search `itemState.items`, not `filteredItems` or
                // `normalizedItems`: those are empty while the list is closed
                // (`isVisible` false), and a paste can come before it opens.
                const item = itemState.items?.find((candidate) => {
                  const { label } = normalizeItem(candidate);
                  return (
                    label === labelToSelectOnPaste || label === clipboardText
                  );
                });
                if (item) {
                  // `item.value` can be an empty string because it's not updated as
                  // soon as `onPaste` executes.
                  if (typeof item === "object") item.value ||= clipboardText;

                  // Include a timeout otherwise the pasted text is appended to the
                  // value we set instead of overriding it
                  setTimeout(() => pick(item));
                }
              }}
              {...props}
            />

            {(props.value || inlineItem || showsChevron || endAddon) && (
              <InputGroupAddon align="inline-end">
                {props.value && (
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Clear search"
                    onClick={() => {
                      setInputValue("", { focus: true });
                      setSelectedItems({ completed: [], pending: [] });
                      openList();
                    }}
                  >
                    <X />
                  </InputGroupButton>
                )}
                {inline && inlineItem && (
                  <InputGroupButton
                    size="xs"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      // The inline pick stands alone: a nested choice left
                      // open (Arguments, Accounts) is dropped, not completed
                      // by it
                      if (itemState.isInSubSearch) {
                        setItemState({ items, isInSubSearch: false });
                      }
                      setSelectedItems((prevSelected) => ({
                        ...prevSelected,
                        pending: [],
                      }));
                      pick(inlineItem);
                    }}
                  >
                    {inline.label}
                  </InputGroupButton>
                )}
                {showsChevron && (
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Show options"
                    // The field is the tab stop and ArrowDown opens the list
                    // from it, as in a combobox; the chevron is for the mouse
                    tabIndex={-1}
                    onClick={() => {
                      if (isOpen) {
                        reset();
                        return;
                      }
                      // Focus goes back to the field so typing filters and
                      // the arrow keys and Enter act there
                      inputRef.current?.focus();
                      setIsVisible(true);
                    }}
                  >
                    <ChevronDown
                      className={cn(
                        "size-4 text-muted-foreground transition-transform duration-150",
                        isOpen && "rotate-180"
                      )}
                    />
                  </InputGroupButton>
                )}
                {endAddon}
              </InputGroupAddon>
            )}
          </InputGroup>
        </PopoverAnchor>

        <PopoverContent
          data-search-bar-list={listId}
          align="start"
          // A custom page (FromSeed's) can be taller than the room left
          className="relative max-h-(--radix-popover-content-available-height) w-(--radix-popover-trigger-width) gap-0 overflow-y-auto p-1"
          // Focus stays in the field: typing filters, and the arrow keys and
          // Enter act from there through `useKeybind`
          onOpenAutoFocus={(ev) => ev.preventDefault()}
          onCloseAutoFocus={(ev) => ev.preventDefault()}
          // The open state is SearchBar's (`isOpen`): Escape and a press
          // outside go through `reset` (`useKeybind`, `useOnClickOutside`),
          // which also restores the last value, so Radix's own dismissal is off
          onEscapeKeyDown={(ev) => ev.preventDefault()}
          onInteractOutside={(ev) => ev.preventDefault()}
        >
          {itemState.isInSubSearch && (
            <div className="flex items-center justify-between pb-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                onClick={() => {
                  setItemState({ items, isInSubSearch: false });
                  setSelectedItems((prevSelected) => ({
                    ...prevSelected,
                    pending: [],
                  }));
                  inputRef.current?.focus();
                }}
              >
                <ArrowLeft />
              </Button>

              {itemState.closeButton && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close"
                  onClick={reset}
                >
                  <X />
                </Button>
              )}
            </div>
          )}

          {itemState.Component ? (
            <itemState.Component search={pick} />
          ) : (
            <Command
              shouldFilter={false}
              value={highlighted}
              onValueChange={(label) => {
                const index = filteredItems
                  ? filteredItems.findIndex((item) => item.label === label)
                  : -1;
                if (index !== -1) setKeyboardSelectionIndex(index);
              }}
              className="rounded-md! p-0"
            >
              <CommandList className="max-h-60">
                <CommandEmpty className="py-2">No match</CommandEmpty>
                {filteredItems?.map((item) => (
                  <CommandItem
                    key={item.label}
                    ref={item.isSelected ? selectedItemRef : null}
                    value={item.label}
                    data-checked={item.isSelected}
                    onSelect={() => pick(item)}
                  >
                    {item.element ?? item.label}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          )}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-popover/80">
              <Spinner />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};

const normalizeItem = (item: Item): NormalizedItem => {
  return typeof item === "object" ? item : { label: item };
};

type InputError = InputProps["error"];

export default SearchBar;
