import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

interface BaseSignOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Signs out; the dialog stays open, its button busy, until it settles */
  onConfirm: () => Promise<void>;
}

/** Asked in a dialog, not in the menu: the menu closes on the click that would confirm */
const BaseSignOutDialog = ({
  open,
  onOpenChange,
  onConfirm,
}: BaseSignOutDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>Sign out of Playground?</DialogTitle>
        {/* Sign-out removes from this browser what the server confirms it
            holds (`relinquish` in effects/session); the rest stays */}
        <DialogDescription>
          Projects saved to your account leave this browser. Anything not saved
          stays here.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <AsyncButton
          variant="destructive"
          onClick={onConfirm}
          onError={reportButtonFailure("sign out")}
        >
          Sign out
        </AsyncButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default BaseSignOutDialog;
