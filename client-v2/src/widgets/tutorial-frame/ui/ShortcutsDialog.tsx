import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Kbd } from "@/shared/ui/kbd";

import { SHORTCUT_GROUPS, shortcutsFor } from "../model/shortcuts";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shows ⌘ and ⌥ for Ctrl and Alt */
  mac: boolean;
}

/**
 * Every key of a tutorial, from the chat head's ⋯ menu, in three groups as
 * the prototype's `ChatColumn` at `f7d42bf2e` sets them: what you do in the
 * lesson, the panels, and moving between steps. Without rules nine alike
 * rows ran together; the groups give the eye a place to rest, 16 apart, each
 * under a small grey name. Rows are 32, the words in the text's colour and
 * size so they lead the key caps, and the dialog is 320 wide so a short name
 * is not far from its keys.
 */
const ShortcutsDialog = ({ open, onOpenChange, mac }: ShortcutsDialogProps) => {
  const shortcuts = shortcutsFor(mac);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-80!" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group} aria-label={group}>
              <h3 className="mb-1 text-[0.75rem] leading-4 text-subtle">
                {group}
              </h3>
              <dl className="flex flex-col">
                {shortcuts
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <div
                      key={s.what}
                      className="flex h-8 items-center justify-between gap-4"
                    >
                      <dt className="text-[0.875rem] leading-[1.125rem] text-foreground/80">
                        {s.what}
                      </dt>
                      <dd className="flex gap-1">
                        {s.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShortcutsDialog;
