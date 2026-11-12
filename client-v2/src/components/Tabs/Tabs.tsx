import { WalletIcon } from "lucide-react";
import { SetStateAction, useCallback } from "react";
import { createPortal } from "react-dom";

import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { isEditable } from "@/shared/lib/is-editable";
import { Button } from "@/shared/ui/button";
import { useEditorHeadHost } from "@/widgets/layout-shell";

import {
  useExplorer,
  useKeybind,
  useRenderOnChange,
  useWallet,
} from "../../hooks";
import { PgExplorer, PgView, PgWallet } from "../../utils";
import Dnd from "../Dnd";
import { BaseEditorTabs } from "./BaseEditorTabs";
import Tab from "./Tab";

export const Tabs = () => {
  // Without this, tabs flicker after reorder
  useRenderOnChange(PgExplorer.onDidSetTabs);

  const explorer = useExplorer();

  const setItems = useCallback((action: SetStateAction<string[]>) => {
    const newTabs =
      typeof action === "function"
        ? action(PgExplorer.tabs as string[])
        : action;
    PgExplorer.setTabs(newTabs);
  }, []);

  // Close the current tab with keybind. Pressed in a field other than the
  // editor (the assistant's composer, a rename), the key belongs to the field.
  useKeybind(
    "Alt+W",
    (ev) => {
      const target = ev.target as Element | null;
      if (isEditable(target) && !target?.closest(".monaco-editor")) {
        return false;
      }
      if (PgExplorer.currentFilePath) {
        PgExplorer.closeFile(PgExplorer.currentFilePath);
      }
    },
    []
  );

  // A phone has no tab row: the code's head names the open file and opens
  // the others (`BasePhonePager`'s file picker), as the prototype draws it.
  // The row's wallet toggle goes with it; the account menu opens the wallet
  const phone = useViewport() === "phone";
  // From 768 px the row sits in the frame's editor head, over the files
  // column and the stage; it stays mounted here, so its contexts are the
  // stage's. With no head (a phone returns above; Home, a unit test) it
  // draws in place.
  const host = useEditorHeadHost();
  if (phone || !explorer.tabs.length) return null;

  const row = (
    <BaseEditorTabs
      id={PgView.ids.TABS}
      current={explorer.currentFilePath ?? undefined}
      end={<Wallet />}
    >
      <Dnd.Sortable
        items={explorer.tabs as string[]}
        setItems={setItems}
        Item={Tab}
        getItemProps={(path, index) => ({ path, index })}
        strategy="horizontal"
      />
    </BaseEditorTabs>
  );
  return host ? createPortal(row, host) : row;
};

const Wallet = () => {
  const wallet = useWallet();
  if (!wallet) return null;

  return (
    <div className="flex items-center">
      <Button
        onClick={() => (PgWallet.show = !PgWallet.show)}
        variant="ghost"
        size="sm"
        className="rounded-r-none bg-background"
      >
        {/* Greyed at rest, full strength while the button is hovered */}
        <WalletIcon className="mr-1.5 size-3.5 text-muted-foreground group-hover/button:text-foreground" />
        Wallet
      </Button>
    </div>
  );
};
