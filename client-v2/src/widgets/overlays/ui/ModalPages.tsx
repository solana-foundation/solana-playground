import { useCallback, useRef, useState } from "react";
import type { FC } from "react";

import { overlayTelemetry } from "../model/telemetry";
import { ModalOpenReportContext } from "./modal-layer";

export type ModalPageProps = { setPage: (page: ModalPage) => void };

/** A page of `ModalPages`, made with `modalPage` so its props are checked */
export type ModalPage = {
  Component: FC<any>;
  props: object;
};

/**
 * One page of a dialog: the component and its props. The props are required
 * exactly when the component has required props of its own.
 */
export const modalPage = <P extends object>(
  Component: FC<P & ModalPageProps>,
  ...[props]: {} extends P ? [props?: P] : [props: P]
): ModalPage => ({ Component, props: props ?? {} });

/**
 * A dialog of several pages. Each page renders its own `ModalFrame` and moves
 * to another with `setPage`; the dialog stays open throughout, and is
 * reported as opened once, under `name`.
 */
export const ModalPages = ({
  name,
  defaultPage,
}: {
  /** Telemetry name, kebab-case, never user content */
  name: string;
  defaultPage: ModalPage;
}) => {
  const [page, setPage] = useState<ModalPage>(defaultPage);
  const reported = useRef(false);
  const reportOpened = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    overlayTelemetry.track("overlay_modal_opened", { name });
  }, [name]);
  return (
    <ModalOpenReportContext.Provider value={reportOpened}>
      <page.Component {...page.props} setPage={setPage} />
    </ModalOpenReportContext.Provider>
  );
};
