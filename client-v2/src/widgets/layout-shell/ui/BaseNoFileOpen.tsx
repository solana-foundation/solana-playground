import { FileCode } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";

export interface BaseNoFileOpenProps {
  /** Opens the Files column, or the Files page on a phone */
  onShowFiles: () => void;
}

/**
 * What the editor shows with every tab closed (Spec 11, "No file open"): the
 * project stays open, and the one way on is to pick a file from Files.
 */
const BaseNoFileOpen = ({ onShowFiles }: BaseNoFileOpenProps) => (
  <Empty className="h-full">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FileCode aria-hidden />
      </EmptyMedia>
      <EmptyTitle role="heading" aria-level={2}>
        No file open
      </EmptyTitle>
    </EmptyHeader>
    <EmptyContent>
      <Button type="button" variant="outline" onClick={onShowFiles}>
        Show files
      </Button>
    </EmptyContent>
  </Empty>
);

export default BaseNoFileOpen;
