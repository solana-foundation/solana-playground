import { SetStateAction, useCallback } from "react";

import { BaseEditorTabs } from "./BaseEditorTabs";

import Tab from "./Tab";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import Dnd from "../Dnd";
import Img from "../Img";
import { PgExplorer, PgView, PgWallet } from "../../utils";
import {
  useExplorer,
  useKeybind,
  useRenderOnChange,
  useWallet,
} from "../../hooks";

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

  // Close the current tab with keybind
  useKeybind(
    "Alt+W",
    () => {
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
  if (phone || !explorer.tabs.length) return null;

  return (
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
};

const Wallet = () => {
  const wallet = useWallet();
  if (!wallet) return null;

  return (
    <div
      className={cn(
        "flex items-center",
        // The picture is greyed at rest and full strength on hover, light
        // or dark
        "[&>button_img]:mr-1.5 [&>button_img]:invert-50",
        "[&>button:hover_img]:invert-0 dark:[&>button:hover_img]:invert-100"
      )}
    >
      <Button
        onClick={() => (PgWallet.show = !PgWallet.show)}
        variant="ghost"
        size="sm"
        className="rounded-r-none bg-background"
      >
        {/* The picture is 400 px, and the design system's Button sizes only
            an `svg` */}
        <Img
          src="/icons/sidebar/wallet.png"
          alt="Wallet"
          className="size-3.5"
        />
        Wallet
      </Button>
    </div>
  );
};
