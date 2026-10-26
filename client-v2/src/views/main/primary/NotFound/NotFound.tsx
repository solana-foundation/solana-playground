import type { FC } from "react";

import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { CircleXIcon } from "lucide-react";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Empty, EmptyContent } from "@/shared/ui/empty";
import { PgRouter } from "../../../../utils";

interface NotFoundProps {
  text?: string;
  navigate?: {
    name: string;
    path: RoutePath;
  };
}

const NotFound: FC<React.PropsWithChildren<NotFoundProps>> = ({
  text,
  navigate,
}) => (
  <Empty>
    <Callout variant="error" className="w-fit">
      <CircleXIcon />
      <CalloutDescription className="wrap-anywhere">
        {text ?? `URL path not found: ${PgRouter.location.pathname}`}
      </CalloutDescription>
    </Callout>
    <EmptyContent>
      <AsyncButton
        variant="ghost"
        onClick={() => PgRouter.navigate(navigate?.path)}
        onError={reportButtonFailure("open the page")}
      >
        {navigate?.name ?? "Go home"}
      </AsyncButton>
    </EmptyContent>
  </Empty>
);

export default NotFound;
