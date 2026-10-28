import { FC, useState } from "react";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";

import FilePicker from "../../../../../components/FilePicker";
import Input from "../../../../../components/Input";
import Link from "../../../../../components/Link";
import { ModalFrame, ModalPages, modalPage } from "@/widgets/overlays";
import type { ModalPageProps } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { PgCommon, PgExplorer, PgRouter, PgShare } from "../../../../../utils";
import { createLogger } from "@/shared/lib/logger";
import { CopyButton } from "@/shared/ui/copy-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const log = createLogger("explorer:share");

export const Share = () => (
  <ModalPages name="share" defaultPage={modalPage(Default)} />
);

type DefaultProps = ModalPageProps;

const Default: FC<React.PropsWithChildren<DefaultProps>> = ({ setPage }) => {
  const [filePaths, setFilePaths] = useState(() =>
    Object.keys(PgExplorer.files).filter(
      (path) => PgExplorer.getItemTypeFromPath(path).file
    )
  );

  const share = async () => {
    try {
      const shareId = await PgCommon.transition(PgShare.new(filePaths));
      setPage(modalPage(SuccessPage, { shareId }));
    } catch (e: any) {
      // The error page tells the user; the team hears of it here
      log.error(e, { report: true });
      setPage(modalPage(ErrorPage, { message: e.message }));
    }
  };

  return (
    <ModalFrame
      name="share"
      title
      buttonProps={{
        text: "Share",
        onSubmit: share,
        disabled: !filePaths.length,
        noCloseOnSubmit: true,
      }}
    >
      <div className="mb-4">Select the files you'd like to share.</div>

      <FilePicker
        path={PgExplorer.getProjectRootPath()}
        filePaths={filePaths}
        setFilePaths={setFilePaths}
      />
    </ModalFrame>
  );
};

interface ErrorPageProps {
  message: string;
}

const ErrorPage: FC<React.PropsWithChildren<ErrorPageProps>> = ({
  message,
}) => (
  <ModalFrame name="share" title buttonProps={{ text: "Continue" }}>
    <Callout variant="error">
      <CircleXIcon />
      <CalloutDescription>Share error: {message}</CalloutDescription>
    </Callout>
  </ModalFrame>
);

interface SuccessPageProps {
  shareId: string;
}

const SuccessPage: FC<React.PropsWithChildren<SuccessPageProps>> = ({
  shareId,
}) => {
  const shareLink = PgRouter.getPathUrl(shareId);

  return (
    <ModalFrame name="share" title buttonProps={{ text: "Continue" }}>
      <div className="min-w-[24rem]">
        <Callout variant="success">
          <CircleCheckIcon />
          <CalloutDescription>
            Successfully shared the project.
          </CalloutDescription>
        </Callout>

        <div className="mt-4 flex items-center">
          <Input value={shareLink} readOnly />
          <CopyButton
            type="button"
            value={shareLink}
            onError={reportButtonFailure("copy")}
          />
        </div>
        <div className="mt-3 ml-1 flex justify-start">
          <Link href={shareLink}>Go to the link</Link>
        </div>
      </div>
    </ModalFrame>
  );
};
