import type { FC } from "react";

import { Button } from "@/shared/ui/button";
import {
  StageEmpty,
  StageEmptyDescription,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";

export interface BaseBrokenLinkProps {
  /** Where "Back to the docs" goes */
  backHref: string;
  onHome: () => void;
}

/** What a docs link that does not decode opens instead of a project */
const BaseBrokenLink: FC<BaseBrokenLinkProps> = ({ backHref, onHome }) => (
  <StageEmpty id="docs-link-broken">
    <StageEmptyTitle>This link is broken</StageEmptyTitle>
    <StageEmptyDescription>
      Playground couldn't read the code in this link. It may have been cut off
      when it was copied. Open the page in the docs again and use its Open in
      Playground button.
    </StageEmptyDescription>
    <div className="mt-4 flex gap-2">
      <Button id="docs-link-back" asChild>
        <a href={backHref}>Back to the docs</a>
      </Button>
      <Button id="docs-link-home" variant="outline" onClick={onHome}>
        Go to Home
      </Button>
    </div>
  </StageEmpty>
);

export default BaseBrokenLink;
