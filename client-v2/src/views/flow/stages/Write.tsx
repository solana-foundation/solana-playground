import { useEffect, useState } from "react";

import { RunCallout } from "@/features/docs-link";

import Primary from "../../../app/Panels/Main/Primary";
import { PgFlow } from "../state/stage";

/**
 * The write stage hosts the upstream `Primary` panel, which is what `PgView`
 * targets for the Home page, `EditorWithTabs`, tutorial pages and share
 * pages. Mounting `EditorWithTabs` directly here would break every route
 * that isn't an open workspace. A project with no program gets the run's
 * callout above it: where the project came from, then how its run ended.
 */
const Write = () => {
  const [hasProgram, setHasProgram] = useState(PgFlow.state.hasProgram);
  useEffect(
    () =>
      PgFlow.onDidChange((state) => setHasProgram(state.hasProgram)).dispose,
    []
  );

  return (
    <>
      {!hasProgram && (
        <div className="px-3 pt-2">
          <RunCallout />
        </div>
      )}
      <Primary />
    </>
  );
};

export default Write;
