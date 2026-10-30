import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export interface BaseStaleBuildDialogProps {
  open: boolean;
  /** `true` deploys the last successful build; closing the dialog is `false` */
  onAnswer: (deploy: boolean) => void;
}

/** Asked before a deploy whose last build failed */
const BaseStaleBuildDialog = ({
  open,
  onAnswer,
}: BaseStaleBuildDialogProps) => (
  <Dialog open={open} onOpenChange={(next) => !next && onAnswer(false)}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Your last build failed</DialogTitle>
        <DialogDescription>
          Deploy the last successful build? It does not include your latest
          changes.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => onAnswer(false)}>
          Cancel
        </Button>
        <Button onClick={() => onAnswer(true)}>Deploy last build</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default BaseStaleBuildDialog;
