import type { FC } from "react";
import { useState } from "react";

import type { LessonStep } from "./types";
import { BaseReader } from "./BaseReader";
import type { ReaderBody } from "./BaseReader";
import { useAsyncEffect } from "../../../hooks";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("lessons:reader");

interface ReaderProps {
  step: LessonStep;
  /** "Step 2 of 4" */
  position: string;
  /** The band's criterion line, so the page and the band agree */
  criterion: string;
  /**
   * Whether "Mark as read" is the step's edge right now (an attestation
   * kind, cursor at the frontier) -- then the proof sits where the
   * reading ends rather than in the band behind the page
   */
  offersAttest: boolean;
  /** Fired once the page content actually loads -- the record's `opened`
   * fact must not rest on a page the learner never saw */
  onLoaded: () => void;
  onClose: () => void;
  onAttest: () => void;
}

/**
 * The lesson page, over the editor.
 *
 * Reading is deliberately not a stepper stage: it is not part of the dev
 * loop, and making it one would put a surface into the rotation whose
 * job is to hide the code. The page says where you are (the eyebrow)
 * and where you go next (the footer), so closing it is never a leap
 * into the unknown.
 */
const Reader: FC<React.PropsWithChildren<ReaderProps>> = ({
  step,
  position,
  criterion,
  offersAttest,
  onLoaded,
  onClose,
  onAttest,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useAsyncEffect(async () => {
    const { readPage } = step;
    if (!readPage) return;

    // Fire the load without awaiting it here, so this effect's own
    // promise settles immediately and its cleanup (below) is wired up
    // before the load can finish. `live` is then checked before either
    // state update, so a step closed mid-load never touches state after
    // this component has unmounted.
    let live = true;
    (async () => {
      let page: string;
      try {
        page = await readPage();
      } catch (e) {
        // Pages are bundled, so a rejection is a broken chunk or build,
        // not content; a step with no page never gets here (`kind: "none"`)
        log.error(e, { report: true });
        if (live) setFailed(true);
        return;
      }
      if (!live) return;
      setContent(page);
      try {
        onLoaded();
      } catch (e) {
        // The store failed to record the opening; the page itself is fine,
        // so the learner keeps reading and the team hears of the store
        log.error(e, { report: true });
      }
    })();

    return () => {
      live = false;
    };
  }, [step]);

  let body: ReaderBody = { kind: "loading" };
  if (failed) body = { kind: "failed" };
  else if (!step.readPage) body = { kind: "none" };
  else if (content !== null) body = { kind: "page", markdown: content };

  return (
    <BaseReader
      title={step.objective}
      position={position}
      criterion={criterion}
      body={body}
      footer={
        offersAttest
          ? { kind: "attest", onClick: onAttest }
          : { kind: "back", onClick: onClose }
      }
      onClose={onClose}
    />
  );
};

export default Reader;
