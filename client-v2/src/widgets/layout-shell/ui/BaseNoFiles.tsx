import { FilePlus } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/ui/empty";

export interface BaseNoFilesProps {
  /** Shows Files and starts a new file there */
  onAddFile: () => Promise<void>;
  /** Opens New project's templates */
  onStartProject: () => void;
}

/**
 * What the editor shows when the project has no file at all (Spec 08's
 * EMPTY-13), in No file open's place and look: Show files would open an
 * empty column, so the way on is to add a file or start from a template.
 */
const BaseNoFiles = ({ onAddFile, onStartProject }: BaseNoFilesProps) => (
  // Spaced by group: the icon 12 px over the title, the title and its line
  // a tight pair (4 px), the actions set off from them (24 px)
  // Below 768 px the actions pin to the foot, full width, the primary
  // nearest the thumb, as StageEmpty's do (Spec 08, EMPTY-13)
  <Empty className="relative h-full gap-6">
    <EmptyHeader className="gap-1">
      <EmptyMedia variant="icon" className="mb-2">
        <FilePlus aria-hidden />
      </EmptyMedia>
      {/* A clear step above the line, as the catalog's no-match title */}
      <EmptyTitle
        role="heading"
        aria-level={2}
        className="text-lg leading-tight text-foreground"
      >
        This project has no files
      </EmptyTitle>
      <EmptyDescription className="font-read">
        Add a file to start, or start from a template.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent className="flex-row flex-wrap justify-center max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:max-w-none max-md:flex-col-reverse max-md:flex-nowrap max-md:items-stretch max-md:gap-3 max-md:px-4 max-md:pb-4">
      {/* A finger's 44 on a touch screen, as No file open's button is;
          48 on a phone, where they sit at the foot as StageEmpty's pill does */}
      <AsyncButton
        className="pointer-coarse:h-11 pointer-coarse:px-5 max-md:h-12"
        onClick={onAddFile}
        onError={reportButtonFailure("add a file")}
      >
        Add a file
      </AsyncButton>
      <Button
        type="button"
        variant="outline"
        className="pointer-coarse:h-11 pointer-coarse:px-5 max-md:h-12"
        onClick={onStartProject}
      >
        Start a project
      </Button>
    </EmptyContent>
  </Empty>
);

export default BaseNoFiles;
