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

interface BaseResetStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The file the card names, in the question */
  file: string;
  /** Restarts the step; only a confirmed Reset reaches it */
  onConfirm: () => void;
}

/**
 * Reset throws away the learner's own lines, so it asks first, as Start over
 * does in the frame's head (`StartOverDialog`, another widget's)
 */
const BaseResetStepDialog = ({
  open,
  onOpenChange,
  file,
  onConfirm,
}: BaseResetStepDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-sm" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Reset {file} to this step&apos;s start?</DialogTitle>
        <DialogDescription>
          The lines you added go, and this step plays again from its start.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          variant="destructive"
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          Reset
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default BaseResetStepDialog;
