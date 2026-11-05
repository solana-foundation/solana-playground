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

interface StartOverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tutorial's name, in the question */
  name: string;
  /** Steps passed so far, which the question names */
  passed?: number;
  /** Starts over; the dialog stays open, its button busy, until it settles */
  onConfirm: () => Promise<void>;
}

/** What starting over clears, in the prototype's words */
const startOverText = (passed: number) => {
  if (passed === 0) {
    return "Your progress and the code written so far will be cleared.";
  }
  const steps =
    passed === 1 ? "Your passed step" : `Your ${passed} passed steps`;
  return `${steps} and the code you applied will be cleared.`;
};

/** Starting over clears progress, so it asks first, as the prototype does */
const StartOverDialog = ({
  open,
  onOpenChange,
  name,
  passed = 0,
  onConfirm,
}: StartOverDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-sm" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Start {name} over?</DialogTitle>
        <DialogDescription>{startOverText(passed)}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <AsyncButton
          variant="destructive"
          onClick={async () => {
            await onConfirm();
            onOpenChange(false);
          }}
          onError={reportButtonFailure("start over")}
        >
          Start over
        </AsyncButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default StartOverDialog;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-frame/ui/StartOverDialog", () => {
    it("names what starting over clears, by the steps passed", () => {
      expect(startOverText(0)).toBe(
        "Your progress and the code written so far will be cleared."
      );
      expect(startOverText(1)).toBe(
        "Your passed step and the code you applied will be cleared."
      );
      expect(startOverText(3)).toBe(
        "Your 3 passed steps and the code you applied will be cleared."
      );
    });
  });
}
