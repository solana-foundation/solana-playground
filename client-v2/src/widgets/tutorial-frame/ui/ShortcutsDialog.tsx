import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Kbd } from "@/shared/ui/kbd";
import { shortcutsFor } from "../model/shortcuts";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shows ⌘ and ⌥ for Ctrl and Alt */
  mac: boolean;
}

/** Every key of a tutorial in one list, from the chat head's ⋯ menu */
const ShortcutsDialog = ({ open, onOpenChange, mac }: ShortcutsDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
      </DialogHeader>
      <dl className="flex flex-col">
        {shortcutsFor(mac).map((s) => (
          <div
            key={s.what}
            className="flex h-9 items-center justify-between gap-4 border-t border-border text-[0.8125rem] first:border-t-0"
          >
            <dt className="text-muted-foreground">{s.what}</dt>
            <dd className="flex gap-1">
              {s.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </DialogContent>
  </Dialog>
);

export default ShortcutsDialog;
