import type { FC } from "react";
import styled from "styled-components";

import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { CircleXIcon } from "lucide-react";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
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
  <Wrapper>
    <Callout variant="error" className="w-fit">
      <CircleXIcon />
      <CalloutDescription>
        {text ?? `URL path not found: ${PgRouter.location.pathname}`}
      </CalloutDescription>
    </Callout>
    <AsyncButton
      variant="ghost"
      onClick={() => PgRouter.navigate(navigate?.path)}
      onError={reportButtonFailure("open the page")}
    >
      {navigate?.name ?? "Go home"}
    </AsyncButton>
  </Wrapper>
);

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 1rem;
`;

export default NotFound;
